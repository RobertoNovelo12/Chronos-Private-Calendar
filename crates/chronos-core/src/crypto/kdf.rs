//! Derivación de claves.
//!
//! contraseña ──Argon2id(sal, m, t, p)──▶ clave maestra (32 B)
//! clave maestra ──HKDF-SHA256(info)──▶ subclaves independientes por propósito
//!
//! Una sola ejecución de Argon2id (la parte costosa) produce todas las claves
//! necesarias, y cada propósito usa una etiqueta `info` distinta para que las
//! subclaves sean criptográficamente independientes.

use super::{SecretKey, KEY_LEN};
use crate::error::{CoreError, Result};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use zeroize::Zeroizing;

/// Longitud de la sal de Argon2id.
pub const SALT_LEN: usize = 16;

/// Etiqueta HKDF de la clave que envuelve la clave de la base de datos.
pub const INFO_KEY_WRAP: &str = "chronos/v1/key-wrap";
/// Etiqueta HKDF de la clave de las copias de seguridad.
pub const INFO_BACKUP: &str = "chronos/v1/backup";

pub const ALGORITHM_ARGON2ID: &str = "argon2id";
/// Versión 0x13 (19) de Argon2.
pub const ARGON2_VERSION: u32 = 19;

/// Parámetros de coste de Argon2id.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct KdfParams {
    /// Memoria en KiB.
    pub m_cost_kib: u32,
    /// Iteraciones.
    pub t_cost: u32,
    /// Paralelismo.
    pub p_cost: u32,
}

impl KdfParams {
    /// Parámetros por defecto: 64 MiB, 3 iteraciones, 1 hilo. Superan la
    /// recomendación mínima de OWASP (19 MiB, t=2) y tardan del orden de
    /// medio segundo en un equipo de escritorio actual.
    pub const RECOMMENDED: KdfParams = KdfParams {
        m_cost_kib: 64 * 1024,
        t_cost: 3,
        p_cost: 1,
    };

    /// Parámetros reducidos para pruebas automáticas. No usar en producción.
    pub const FOR_TESTS: KdfParams = KdfParams {
        m_cost_kib: 8 * 1024,
        t_cost: 1,
        p_cost: 1,
    };

    /// Rechaza parámetros absurdos leídos de un archivo (evita que un archivo
    /// manipulado consuma toda la memoria o CPU del equipo).
    pub fn validate(&self) -> Result<()> {
        if !(8 * 1024..=2 * 1024 * 1024).contains(&self.m_cost_kib) {
            return Err(CoreError::Validation(
                "memoria de Argon2id fuera de rango".into(),
            ));
        }
        if !(1..=20).contains(&self.t_cost) {
            return Err(CoreError::Validation(
                "iteraciones de Argon2id fuera de rango".into(),
            ));
        }
        if !(1..=16).contains(&self.p_cost) {
            return Err(CoreError::Validation(
                "paralelismo de Argon2id fuera de rango".into(),
            ));
        }
        Ok(())
    }
}

/// Descripción serializable de una derivación (se guarda en el almacén de
/// claves y en la cabecera de cada copia). No contiene secretos.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct KdfDescriptor {
    pub algorithm: String,
    pub version: u32,
    pub m_cost_kib: u32,
    pub t_cost: u32,
    pub p_cost: u32,
    /// Sal en Base64.
    pub salt: String,
}

impl KdfDescriptor {
    pub fn new(params: KdfParams, salt: &[u8; SALT_LEN]) -> Self {
        KdfDescriptor {
            algorithm: ALGORITHM_ARGON2ID.to_string(),
            version: ARGON2_VERSION,
            m_cost_kib: params.m_cost_kib,
            t_cost: params.t_cost,
            p_cost: params.p_cost,
            salt: B64.encode(salt),
        }
    }

    /// Genera una sal nueva con el CSPRNG.
    pub fn generate(params: KdfParams) -> Result<Self> {
        let salt = super::random::bytes::<SALT_LEN>()?;
        Ok(Self::new(params, &salt))
    }

    pub fn params(&self) -> KdfParams {
        KdfParams {
            m_cost_kib: self.m_cost_kib,
            t_cost: self.t_cost,
            p_cost: self.p_cost,
        }
    }

    pub fn salt_bytes(&self) -> Result<Vec<u8>> {
        let salt = B64
            .decode(&self.salt)
            .map_err(|_| CoreError::Validation("sal mal codificada".into()))?;
        if salt.len() < 8 || salt.len() > 64 {
            return Err(CoreError::Validation("longitud de sal no válida".into()));
        }
        Ok(salt)
    }

    /// Comprueba algoritmo, versión y parámetros.
    pub fn validate(&self) -> Result<()> {
        if self.algorithm != ALGORITHM_ARGON2ID {
            return Err(CoreError::UnsupportedVersion(format!(
                "algoritmo de derivación desconocido: {}",
                self.algorithm
            )));
        }
        if self.version != ARGON2_VERSION {
            return Err(CoreError::UnsupportedVersion(
                "versión de Argon2 no soportada".into(),
            ));
        }
        self.params().validate()?;
        self.salt_bytes()?;
        Ok(())
    }

    /// Representación canónica para usar como datos asociados (AAD).
    pub fn canonical(&self) -> String {
        format!(
            "{}|{}|{}|{}|{}|{}",
            self.algorithm, self.version, self.m_cost_kib, self.t_cost, self.p_cost, self.salt
        )
    }

    /// Deriva la clave maestra a partir de la contraseña.
    pub fn derive_master_key(&self, password: &[u8]) -> Result<SecretKey> {
        self.validate()?;
        let salt = self.salt_bytes()?;
        derive_master_key(password, &salt, &self.params())
    }
}

/// Argon2id(contraseña, sal) → 32 bytes.
pub fn derive_master_key(password: &[u8], salt: &[u8], params: &KdfParams) -> Result<SecretKey> {
    params.validate()?;
    let argon_params = Params::new(
        params.m_cost_kib,
        params.t_cost,
        params.p_cost,
        Some(KEY_LEN),
    )
    .map_err(|_| CoreError::Crypto)?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, argon_params);
    let mut out = Zeroizing::new([0u8; KEY_LEN]);
    argon
        .hash_password_into(password, salt, out.as_mut())
        .map_err(|_| CoreError::Crypto)?;
    Ok(out)
}

/// HKDF-SHA256(clave maestra, info) → subclave de 32 bytes.
pub fn derive_subkey(master: &SecretKey, info: &str) -> Result<SecretKey> {
    let hk = Hkdf::<Sha256>::new(None, master.as_ref());
    let mut out = Zeroizing::new([0u8; KEY_LEN]);
    hk.expand(info.as_bytes(), out.as_mut())
        .map_err(|_| CoreError::Crypto)?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_inputs_same_key_and_distinct_subkeys() {
        let d = KdfDescriptor::new(KdfParams::FOR_TESTS, &[7u8; SALT_LEN]);
        let a = d.derive_master_key(b"correct horse").unwrap();
        let b = d.derive_master_key(b"correct horse").unwrap();
        assert_eq!(*a, *b);
        let c = d.derive_master_key(b"correct horsf").unwrap();
        assert_ne!(*a, *c);

        let wrap = derive_subkey(&a, INFO_KEY_WRAP).unwrap();
        let backup = derive_subkey(&a, INFO_BACKUP).unwrap();
        assert_ne!(*wrap, *backup);
        assert_ne!(*wrap, *a);
    }

    #[test]
    fn rejects_hostile_parameters() {
        let mut d = KdfDescriptor::new(KdfParams::FOR_TESTS, &[1u8; SALT_LEN]);
        d.m_cost_kib = u32::MAX;
        assert!(d.validate().is_err());
        let mut d = KdfDescriptor::new(KdfParams::FOR_TESTS, &[1u8; SALT_LEN]);
        d.algorithm = "pbkdf2".into();
        assert!(matches!(
            d.validate(),
            Err(CoreError::UnsupportedVersion(_))
        ));
    }
}
