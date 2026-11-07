//! Formato de archivo `.chronosbak` (versión 1). Ver `docs/BACKUP_FORMAT.md`.
//!
//! ```text
//! offset  tamaño  campo
//! 0       8       magia            "CHRNBKUP"
//! 8       2       versión formato  u16 little-endian (= 1)
//! 10      4       long. cabecera   u32 little-endian (H)
//! 14      H       cabecera JSON    UTF-8, sin datos del usuario
//! 14+H    N       texto cifrado    XChaCha20-Poly1305 (incluye etiqueta de 16 B)
//! 14+H+N  32      SHA-256          de todos los bytes anteriores
//! ```
//!
//! * AAD del cifrado = bytes [0, 14+H): la cabecera queda autenticada.
//! * El SHA-256 final permite detectar corrupción accidental SIN contraseña,
//!   y así distinguir "archivo dañado" de "contraseña incorrecta".

use crate::crypto::{aead, kdf::KdfDescriptor, SecretKey};
use crate::error::{CoreError, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

pub const MAGIC: &[u8; 8] = b"CHRNBKUP";
pub const FORMAT_VERSION: u16 = 1;
pub const FILE_EXTENSION: &str = "chronosbak";
const PREFIX_LEN: usize = 8 + 2 + 4;
const HASH_LEN: usize = 32;
const MAX_HEADER_LEN: usize = 64 * 1024;
/// Límite defensivo del tamaño de archivo (2 GiB).
pub const MAX_FILE_LEN: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CipherSection {
    pub algorithm: String,
    /// Base64
    pub nonce: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PayloadSection {
    /// "json": instantánea lógica de las tablas.
    pub encoding: String,
    pub compression: String,
}

/// Cabecera pública. Solo metadatos técnicos: nunca títulos, descripciones,
/// nombres de calendario ni recuentos de eventos.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BackupHeader {
    pub format_version: u16,
    /// RFC 3339, UTC.
    pub created_at: String,
    pub app_version: String,
    pub schema_version: i64,
    pub kdf: KdfDescriptor,
    /// Etiqueta HKDF usada sobre la clave maestra.
    pub hkdf_info: String,
    pub cipher: CipherSection,
    pub payload: PayloadSection,
}

/// Archivo analizado sin descifrar.
pub struct ParsedBackup<'a> {
    pub header: BackupHeader,
    aad: &'a [u8],
    ciphertext: &'a [u8],
    pub sha256: String,
}

impl BackupHeader {
    pub fn nonce(&self) -> Result<[u8; aead::NONCE_LEN]> {
        let raw = B64
            .decode(&self.cipher.nonce)
            .map_err(|_| CoreError::CorruptBackup("nonce mal codificado".into()))?;
        raw.try_into()
            .map_err(|_| CoreError::CorruptBackup("longitud de nonce no válida".into()))
    }

    fn validate(&self) -> Result<()> {
        if self.format_version != FORMAT_VERSION {
            return Err(CoreError::UnsupportedVersion(format!(
                "formato de copia {}",
                self.format_version
            )));
        }
        if self.cipher.algorithm != aead::ALGORITHM {
            return Err(CoreError::UnsupportedVersion(format!(
                "algoritmo de cifrado {}",
                self.cipher.algorithm
            )));
        }
        if self.hkdf_info != crate::crypto::kdf::INFO_BACKUP {
            return Err(CoreError::UnsupportedVersion(
                "etiqueta de derivación desconocida".into(),
            ));
        }
        if self.payload.encoding != "json" || self.payload.compression != "none" {
            return Err(CoreError::UnsupportedVersion(
                "codificación de contenido desconocida".into(),
            ));
        }
        self.kdf.validate()?;
        self.nonce()?;
        Ok(())
    }
}

/// Construye el archivo completo. `header.cipher.nonce` debe ser el nonce usado.
pub fn encode(header: &BackupHeader, key: &SecretKey, plaintext: &[u8]) -> Result<Vec<u8>> {
    header.validate()?;
    let header_json = serde_json::to_vec(header)?;
    if header_json.len() > MAX_HEADER_LEN {
        return Err(CoreError::Validation(
            "cabecera de copia demasiado grande".into(),
        ));
    }
    let mut out = Vec::with_capacity(PREFIX_LEN + header_json.len() + plaintext.len() + 64);
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&FORMAT_VERSION.to_le_bytes());
    out.extend_from_slice(&(header_json.len() as u32).to_le_bytes());
    out.extend_from_slice(&header_json);
    let ct = aead::seal(key, &header.nonce()?, &out, plaintext)?;
    out.extend_from_slice(&ct);
    let digest = Sha256::digest(&out);
    out.extend_from_slice(&digest);
    Ok(out)
}

/// Analiza la estructura y verifica el SHA-256 sin necesitar la contraseña.
pub fn parse(bytes: &[u8]) -> Result<ParsedBackup<'_>> {
    if bytes.len() < PREFIX_LEN + 2 + aead::TAG_LEN + HASH_LEN || &bytes[..8] != MAGIC {
        return Err(CoreError::CorruptBackup(
            "no es un archivo de copia de Chronos".into(),
        ));
    }
    let (body, stored_hash) = bytes.split_at(bytes.len() - HASH_LEN);
    let digest = Sha256::digest(body);
    if digest.as_slice() != stored_hash {
        return Err(CoreError::CorruptBackup(
            "la suma de verificación no coincide".into(),
        ));
    }
    let version = u16::from_le_bytes([bytes[8], bytes[9]]);
    if version != FORMAT_VERSION {
        return Err(CoreError::UnsupportedVersion(format!(
            "formato de copia {version}"
        )));
    }
    let header_len = u32::from_le_bytes([bytes[10], bytes[11], bytes[12], bytes[13]]) as usize;
    if header_len == 0
        || header_len > MAX_HEADER_LEN
        || PREFIX_LEN + header_len + aead::TAG_LEN > body.len()
    {
        return Err(CoreError::CorruptBackup(
            "longitud de cabecera no válida".into(),
        ));
    }
    let aad_end = PREFIX_LEN + header_len;
    let header: BackupHeader = serde_json::from_slice(&body[PREFIX_LEN..aad_end])
        .map_err(|_| CoreError::CorruptBackup("cabecera ilegible".into()))?;
    if header.format_version != version {
        return Err(CoreError::CorruptBackup(
            "versiones de formato inconsistentes".into(),
        ));
    }
    header.validate()?;
    Ok(ParsedBackup {
        header,
        aad: &body[..aad_end],
        ciphertext: &body[aad_end..],
        sha256: crate::crypto::to_hex(&digest),
    })
}

impl ParsedBackup<'_> {
    /// Descifra con la clave ya derivada. Un fallo aquí, con el SHA-256 correcto,
    /// significa contraseña incorrecta (o manipulación deliberada).
    pub fn decrypt(&self, key: &SecretKey) -> Result<Zeroizing<Vec<u8>>> {
        aead::open(key, &self.header.nonce()?, self.aad, self.ciphertext)
            .map_err(|_| CoreError::BackupAuthentication)
    }
}
