//! Almacén de claves (`keystore.json`).
//!
//! Cifrado por sobre (envelope encryption):
//!
//! ```text
//! contraseña ─Argon2id─▶ maestra ─HKDF("chronos/v1/key-wrap")─▶ KEK
//!                                 └HKDF("chronos/v1/backup")───▶ clave de copias
//! DEK (aleatoria, 256 bits) ──XChaCha20-Poly1305(KEK)──▶ wrapped_key  (en disco)
//! DEK ──▶ clave en bruto de SQLCipher
//! ```
//!
//! * La contraseña y la DEK nunca se escriben en claro.
//! * Cambiar la contraseña solo vuelve a envolver la DEK: no hay que
//!   recifrar la base de datos completa.
//! * Una contraseña incorrecta se detecta porque la etiqueta Poly1305 no
//!   verifica al desenvolver.

use crate::crypto::{
    aead,
    kdf::{self, KdfDescriptor, KdfParams},
    random, SecretKey, KEY_LEN,
};
use crate::error::{CoreError, Result};
use crate::fs_util::write_atomic;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::Path;
use zeroize::Zeroizing;

pub const KEYSTORE_FORMAT: &str = "chronos-keystore";
pub const KEYSTORE_VERSION: u32 = 1;
const WRAP_AAD_PREFIX: &str = "chronos-keystore/v1";

pub const MIN_PASSWORD_CHARS: usize = 8;
pub const MAX_PASSWORD_BYTES: usize = 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WrappedKey {
    pub algorithm: String,
    /// Base64
    pub nonce: String,
    /// Base64 (DEK cifrada + etiqueta)
    pub ciphertext: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct KeystoreFile {
    pub format: String,
    pub version: u32,
    pub kdf: KdfDescriptor,
    pub wrapped_key: WrappedKey,
    pub created_at: String,
    pub updated_at: String,
}

/// Material de clave para cifrar copias de seguridad: la clave y la
/// descripción pública de cómo re-derivarla desde la contraseña.
pub struct BackupKey {
    pub key: SecretKey,
    pub kdf: KdfDescriptor,
}

impl BackupKey {
    /// Deriva una clave de copia a partir de una contraseña con sal nueva
    /// (para copias manuales protegidas con una contraseña distinta).
    pub fn from_password(password: &str, params: KdfParams) -> Result<Self> {
        validate_new_password(password)?;
        let kdf = KdfDescriptor::generate(params)?;
        let master = kdf.derive_master_key(password.as_bytes())?;
        Ok(BackupKey {
            key: kdf::derive_subkey(&master, kdf::INFO_BACKUP)?,
            kdf,
        })
    }

    /// Re-deriva la clave de una copia existente a partir de su cabecera.
    pub fn for_existing(password: &str, kdf: &KdfDescriptor) -> Result<SecretKey> {
        let master = kdf.derive_master_key(password.as_bytes())?;
        kdf::derive_subkey(&master, kdf::INFO_BACKUP)
    }
}

/// Claves disponibles mientras la aplicación está desbloqueada.
pub struct UnlockedKeys {
    pub database_key: SecretKey,
    pub backup: BackupKey,
}

/// Reglas mínimas para una contraseña nueva. Como no existe recuperación
/// (no hay servidor), se exige una longitud mínima razonable.
pub fn validate_new_password(password: &str) -> Result<()> {
    if password.chars().count() < MIN_PASSWORD_CHARS {
        return Err(CoreError::WeakPassword(format!(
            "debe tener al menos {MIN_PASSWORD_CHARS} caracteres"
        )));
    }
    if password.len() > MAX_PASSWORD_BYTES {
        return Err(CoreError::WeakPassword("es demasiado larga".into()));
    }
    if password.trim().is_empty() {
        return Err(CoreError::WeakPassword(
            "no puede estar formada solo por espacios".into(),
        ));
    }
    Ok(())
}

fn wrap_aad(kdf: &KdfDescriptor) -> Vec<u8> {
    format!("{WRAP_AAD_PREFIX}|{}", kdf.canonical()).into_bytes()
}

fn derive_keys(kdf: &KdfDescriptor, password: &str) -> Result<(SecretKey, SecretKey)> {
    let master = kdf.derive_master_key(password.as_bytes())?;
    let kek = kdf::derive_subkey(&master, kdf::INFO_KEY_WRAP)?;
    let backup = kdf::derive_subkey(&master, kdf::INFO_BACKUP)?;
    Ok((kek, backup))
}

fn wrap(kek: &SecretKey, kdf: &KdfDescriptor, dek: &SecretKey) -> Result<WrappedKey> {
    let nonce = aead::random_nonce()?;
    let ct = aead::seal(kek, &nonce, &wrap_aad(kdf), dek.as_ref())?;
    Ok(WrappedKey {
        algorithm: aead::ALGORITHM.to_string(),
        nonce: B64.encode(nonce),
        ciphertext: B64.encode(ct),
    })
}

impl KeystoreFile {
    /// Crea un almacén nuevo con una DEK aleatoria.
    pub fn create(password: &str, params: KdfParams) -> Result<(Self, UnlockedKeys)> {
        validate_new_password(password)?;
        let kdf = KdfDescriptor::generate(params)?;
        let (kek, backup_key) = derive_keys(&kdf, password)?;
        let dek = random::secret_key()?;
        let now = Utc::now().to_rfc3339();
        let file = KeystoreFile {
            format: KEYSTORE_FORMAT.to_string(),
            version: KEYSTORE_VERSION,
            wrapped_key: wrap(&kek, &kdf, &dek)?,
            kdf: kdf.clone(),
            created_at: now.clone(),
            updated_at: now,
        };
        Ok((
            file,
            UnlockedKeys {
                database_key: dek,
                backup: BackupKey {
                    key: backup_key,
                    kdf,
                },
            },
        ))
    }

    /// Desenvuelve la DEK con la contraseña.
    pub fn unlock(&self, password: &str) -> Result<UnlockedKeys> {
        self.validate()?;
        if password.len() > MAX_PASSWORD_BYTES {
            return Err(CoreError::InvalidPassword);
        }
        let (kek, backup_key) = derive_keys(&self.kdf, password)?;
        let nonce = decode_nonce(&self.wrapped_key.nonce)?;
        let ct = B64
            .decode(&self.wrapped_key.ciphertext)
            .map_err(|_| CoreError::Keystore("clave envuelta mal codificada".into()))?;
        let plain = aead::open(&kek, &nonce, &wrap_aad(&self.kdf), &ct)
            .map_err(|_| CoreError::InvalidPassword)?;
        if plain.len() != KEY_LEN {
            return Err(CoreError::Keystore("longitud de clave inesperada".into()));
        }
        let mut dek = Zeroizing::new([0u8; KEY_LEN]);
        dek.copy_from_slice(&plain);
        Ok(UnlockedKeys {
            database_key: dek,
            backup: BackupKey {
                key: backup_key,
                kdf: self.kdf.clone(),
            },
        })
    }

    /// Cambia la contraseña: verifica la actual y vuelve a envolver la misma
    /// DEK con una sal y una KEK nuevas.
    pub fn change_password(
        &self,
        current: &str,
        new: &str,
        params: KdfParams,
    ) -> Result<(Self, UnlockedKeys)> {
        validate_new_password(new)?;
        let unlocked = self.unlock(current)?;
        let kdf = KdfDescriptor::generate(params)?;
        let (kek, backup_key) = derive_keys(&kdf, new)?;
        let file = KeystoreFile {
            format: KEYSTORE_FORMAT.to_string(),
            version: KEYSTORE_VERSION,
            wrapped_key: wrap(&kek, &kdf, &unlocked.database_key)?,
            kdf: kdf.clone(),
            created_at: self.created_at.clone(),
            updated_at: Utc::now().to_rfc3339(),
        };
        Ok((
            file,
            UnlockedKeys {
                database_key: unlocked.database_key,
                backup: BackupKey {
                    key: backup_key,
                    kdf,
                },
            },
        ))
    }

    pub fn validate(&self) -> Result<()> {
        if self.format != KEYSTORE_FORMAT {
            return Err(CoreError::Keystore("formato desconocido".into()));
        }
        if self.version != KEYSTORE_VERSION {
            return Err(CoreError::UnsupportedVersion(format!(
                "almacén de claves versión {}",
                self.version
            )));
        }
        if self.wrapped_key.algorithm != aead::ALGORITHM {
            return Err(CoreError::UnsupportedVersion(
                "algoritmo de envoltura desconocido".into(),
            ));
        }
        self.kdf.validate()
    }

    pub fn load(path: &Path) -> Result<Self> {
        let bytes = std::fs::read(path)?;
        let file: KeystoreFile = serde_json::from_slice(&bytes).map_err(|_| {
            CoreError::Keystore("el archivo no es un almacén de claves válido".into())
        })?;
        file.validate()?;
        Ok(file)
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        let bytes = serde_json::to_vec_pretty(self)?;
        write_atomic(path, &bytes)
    }
}

fn decode_nonce(b64: &str) -> Result<[u8; aead::NONCE_LEN]> {
    let raw = B64
        .decode(b64)
        .map_err(|_| CoreError::Keystore("nonce mal codificado".into()))?;
    raw.try_into()
        .map_err(|_| CoreError::Keystore("longitud de nonce no válida".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_unlock_and_change_password() {
        let (ks, keys) = KeystoreFile::create("contraseña-segura", KdfParams::FOR_TESTS).unwrap();
        let again = ks.unlock("contraseña-segura").unwrap();
        assert_eq!(*keys.database_key, *again.database_key);
        assert_eq!(*keys.backup.key, *again.backup.key);

        assert!(matches!(
            ks.unlock("otra-contraseña"),
            Err(CoreError::InvalidPassword)
        ));

        let (ks2, keys2) = ks
            .change_password(
                "contraseña-segura",
                "nueva-contraseña",
                KdfParams::FOR_TESTS,
            )
            .unwrap();
        // La DEK se conserva; la clave de copias cambia con la contraseña.
        assert_eq!(*keys.database_key, *keys2.database_key);
        assert_ne!(*keys.backup.key, *keys2.backup.key);
        assert!(matches!(
            ks2.unlock("contraseña-segura"),
            Err(CoreError::InvalidPassword)
        ));
        assert!(ks2.unlock("nueva-contraseña").is_ok());
    }

    #[test]
    fn rejects_short_password_and_wrong_current() {
        assert!(matches!(
            KeystoreFile::create("corta", KdfParams::FOR_TESTS),
            Err(CoreError::WeakPassword(_))
        ));
        let (ks, _) = KeystoreFile::create("contraseña-segura", KdfParams::FOR_TESTS).unwrap();
        assert!(matches!(
            ks.change_password("incorrecta!!", "nueva-contraseña", KdfParams::FOR_TESTS),
            Err(CoreError::InvalidPassword)
        ));
    }

    #[test]
    fn tampered_kdf_parameters_are_detected() {
        let (mut ks, _) = KeystoreFile::create("contraseña-segura", KdfParams::FOR_TESTS).unwrap();
        ks.kdf.t_cost += 1;
        assert!(ks.unlock("contraseña-segura").is_err());
    }

    #[test]
    fn save_and_load_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("keystore.json");
        let (ks, _) = KeystoreFile::create("contraseña-segura", KdfParams::FOR_TESTS).unwrap();
        ks.save(&path).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(!text.contains("contraseña-segura"));
        let loaded = KeystoreFile::load(&path).unwrap();
        assert!(loaded.unlock("contraseña-segura").is_ok());
    }
}
