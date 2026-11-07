//! Copias de seguridad locales cifradas: creación, inspección, verificación
//! y restauración transaccional.

pub mod format;
pub mod snapshot;

use crate::crypto::{aead, kdf::INFO_BACKUP};
use crate::database::{migrations::schema_version, now_ms};
use crate::error::{CoreError, Result};
use crate::fs_util::write_atomic;
use crate::repositories::backup_history;
use crate::security::BackupKey;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use chrono::Utc;
use format::{
    BackupHeader, CipherSection, PayloadSection, FILE_EXTENSION, FORMAT_VERSION, MAX_FILE_LEN,
};
use rusqlite::Connection;
use serde::Serialize;
use snapshot::Snapshot;
use std::path::{Path, PathBuf};
use uuid::Uuid;
use zeroize::Zeroizing;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BackupKind {
    Manual,
    Automatic,
    PreRestore,
    PreUpdate,
}

impl BackupKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            BackupKind::Manual => "manual",
            BackupKind::Automatic => "automatic",
            BackupKind::PreRestore => "pre_restore",
            BackupKind::PreUpdate => "pre_update",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "manual" => BackupKind::Manual,
            "automatic" => BackupKind::Automatic,
            "pre_restore" => BackupKind::PreRestore,
            "pre_update" => BackupKind::PreUpdate,
            _ => return None,
        })
    }
}

/// Entrada del historial de copias.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRecord {
    pub id: String,
    pub file_name: String,
    pub file_path: String,
    pub kind: BackupKind,
    pub status: String,
    pub format_version: i64,
    pub schema_version: i64,
    pub size_bytes: i64,
    pub sha256: String,
    pub error_code: Option<String>,
    pub created_at: i64,
}

/// Metadatos públicos de un archivo de copia (se obtienen sin contraseña).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub file_name: String,
    pub file_path: String,
    pub created_at: String,
    pub app_version: String,
    pub format_version: u16,
    pub schema_version: i64,
    pub size_bytes: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreReport {
    pub source: BackupInfo,
    pub pre_restore_backup: BackupRecord,
    pub restored_rows: usize,
}

fn unique_backup_path(dir: &Path, kind: BackupKind) -> PathBuf {
    let stamp = Utc::now().format("%Y%m%d-%H%M%S-%3f");
    let base = format!("chronos-{stamp}-{}", kind.as_str());
    let mut candidate = dir.join(format!("{base}.{FILE_EXTENSION}"));
    let mut n = 1;
    while candidate.exists() {
        candidate = dir.join(format!("{base}-{n}.{FILE_EXTENSION}"));
        n += 1;
    }
    candidate
}

/// Crea una copia cifrada en `dir` y la registra en el historial.
pub fn create_backup(
    conn: &Connection,
    key: &BackupKey,
    dir: &Path,
    kind: BackupKind,
) -> Result<BackupRecord> {
    std::fs::create_dir_all(dir)?;

    // Vista coherente de todas las tablas.
    let snap = {
        let tx = conn.unchecked_transaction()?;
        let snap = snapshot::export(&tx)?;
        tx.commit()?;
        snap
    };
    let plaintext = Zeroizing::new(serde_json::to_vec(&snap)?);
    drop(snap);

    let nonce = aead::random_nonce()?;
    let header = BackupHeader {
        format_version: FORMAT_VERSION,
        created_at: Utc::now().to_rfc3339(),
        app_version: crate::APP_VERSION.to_string(),
        schema_version: schema_version(conn)?,
        kdf: key.kdf.clone(),
        hkdf_info: INFO_BACKUP.to_string(),
        cipher: CipherSection {
            algorithm: aead::ALGORITHM.to_string(),
            nonce: B64.encode(nonce),
        },
        payload: PayloadSection {
            encoding: "json".into(),
            compression: "none".into(),
        },
    };
    let bytes = format::encode(&header, &key.key, &plaintext)?;
    let path = unique_backup_path(dir, kind);
    write_atomic(&path, &bytes)?;

    let parsed = format::parse(&bytes)?;
    let record = BackupRecord {
        id: Uuid::new_v4().to_string(),
        file_name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        file_path: path.to_string_lossy().into_owned(),
        kind,
        status: "ok".into(),
        format_version: FORMAT_VERSION as i64,
        schema_version: header.schema_version,
        size_bytes: bytes.len() as i64,
        sha256: parsed.sha256,
        error_code: None,
        created_at: now_ms(),
    };
    backup_history::insert(conn, &record)?;
    tracing::info!(
        kind = kind.as_str(),
        size = record.size_bytes,
        "copia de seguridad creada"
    );
    Ok(record)
}

fn read_backup_file(path: &Path) -> Result<Vec<u8>> {
    let meta = std::fs::metadata(path)?;
    if !meta.is_file() {
        return Err(CoreError::CorruptBackup("la ruta no es un archivo".into()));
    }
    if meta.len() > MAX_FILE_LEN {
        return Err(CoreError::CorruptBackup("archivo demasiado grande".into()));
    }
    Ok(std::fs::read(path)?)
}

fn info_from(path: &Path, size: usize, header: &BackupHeader, sha256: String) -> BackupInfo {
    BackupInfo {
        file_name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        file_path: path.to_string_lossy().into_owned(),
        created_at: header.created_at.clone(),
        app_version: header.app_version.clone(),
        format_version: header.format_version,
        schema_version: header.schema_version,
        size_bytes: size as u64,
        sha256,
    }
}

/// Lee los metadatos y comprueba la integridad estructural (SHA-256) sin contraseña.
pub fn inspect_backup(path: &Path) -> Result<BackupInfo> {
    let bytes = read_backup_file(path)?;
    let parsed = format::parse(&bytes)?;
    Ok(info_from(
        path,
        bytes.len(),
        &parsed.header,
        parsed.sha256.clone(),
    ))
}

fn decrypt_snapshot(bytes: &[u8], password: &str) -> Result<(BackupHeader, String, Snapshot)> {
    let parsed = format::parse(bytes)?;
    let key = BackupKey::for_existing(password, &parsed.header.kdf)?;
    let plain = parsed.decrypt(&key)?;
    let snap: Snapshot = serde_json::from_slice(&plain)
        .map_err(|_| CoreError::CorruptBackup("contenido descifrado ilegible".into()))?;
    Ok((parsed.header, parsed.sha256, snap))
}

/// Verificación completa: integridad, contraseña y legibilidad del contenido.
pub fn verify_backup(path: &Path, password: &str) -> Result<BackupInfo> {
    let bytes = read_backup_file(path)?;
    let (header, sha, _snap) = decrypt_snapshot(&bytes, password)?;
    Ok(info_from(path, bytes.len(), &header, sha))
}

/// Restaura una copia, reemplazando TODOS los datos actuales.
///
/// 1. Exige `confirm_overwrite == true`.
/// 2. Verifica y descifra la copia por completo antes de tocar nada.
/// 3. Crea una copia `pre_restore` del estado actual (si falla, se aborta).
/// 4. Sustituye los datos en una única transacción (todo o nada).
pub fn restore_backup(
    conn: &mut Connection,
    session_key: &BackupKey,
    backup_dir: &Path,
    path: &Path,
    password: &str,
    confirm_overwrite: bool,
) -> Result<RestoreReport> {
    if !confirm_overwrite {
        return Err(CoreError::ConfirmationRequired);
    }
    let bytes = read_backup_file(path)?;
    let (header, sha, snap) = decrypt_snapshot(&bytes, password)?;
    snapshot::validate(conn, &snap)?;
    let source = info_from(path, bytes.len(), &header, sha);
    drop(bytes);

    let pre = create_backup(conn, session_key, backup_dir, BackupKind::PreRestore)?;

    let tx = conn.transaction()?;
    let restored_rows = snapshot::replace_all(&tx, &snap)?;
    tx.commit()?;
    tracing::info!(rows = restored_rows, "restauración completada");
    Ok(RestoreReport {
        source,
        pre_restore_backup: pre,
        restored_rows,
    })
}

/// Historial de copias registrado en este equipo.
pub fn history(conn: &Connection, limit: u32) -> Result<Vec<BackupRecord>> {
    backup_history::list(conn, limit)
}
