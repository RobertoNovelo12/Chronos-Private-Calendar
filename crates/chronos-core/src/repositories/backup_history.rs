//! Historial local de copias de seguridad.

use crate::backup::{BackupKind, BackupRecord};
use crate::error::Result;
use rusqlite::{params, Connection, Row};

fn from_row(r: &Row<'_>) -> rusqlite::Result<BackupRecord> {
    let kind: String = r.get(3)?;
    Ok(BackupRecord {
        id: r.get(0)?,
        file_name: r.get(1)?,
        file_path: r.get(2)?,
        kind: BackupKind::parse(&kind).unwrap_or(BackupKind::Manual),
        status: r.get(4)?,
        format_version: r.get(5)?,
        schema_version: r.get(6)?,
        size_bytes: r.get(7)?,
        sha256: r.get(8)?,
        error_code: r.get(9)?,
        created_at: r.get(10)?,
    })
}

pub fn insert(conn: &Connection, rec: &BackupRecord) -> Result<()> {
    conn.execute(
        "INSERT INTO backup_history
           (id, file_name, file_path, kind, status, format_version, schema_version, size_bytes, sha256, error_code, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            rec.id,
            rec.file_name,
            rec.file_path,
            rec.kind.as_str(),
            rec.status,
            rec.format_version,
            rec.schema_version,
            rec.size_bytes,
            rec.sha256,
            rec.error_code,
            rec.created_at
        ],
    )?;
    Ok(())
}

pub fn list(conn: &Connection, limit: u32) -> Result<Vec<BackupRecord>> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, file_name, file_path, kind, status, format_version, schema_version, size_bytes, sha256, error_code, created_at
         FROM backup_history ORDER BY created_at DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map([limit], from_row)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}
