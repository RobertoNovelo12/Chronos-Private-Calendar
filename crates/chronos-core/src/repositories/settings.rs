//! Preferencias guardadas en la base cifrada (tabla `settings`, valores JSON).

use crate::database::now_ms;
use crate::error::Result;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

/// Mostrar título y ubicación en las notificaciones del sistema.
pub const NOTIFICATIONS_SHOW_DETAILS: &str = "notifications.show_details";

pub fn get(conn: &Connection, key: &str) -> Result<Option<Value>> {
    let raw: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
            r.get(0)
        })
        .optional()?;
    Ok(match raw {
        Some(s) => Some(serde_json::from_str(&s)?),
        None => None,
    })
}

pub fn set(conn: &Connection, key: &str, value: &Value) -> Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, serde_json::to_string(value)?, now_ms()],
    )?;
    Ok(())
}

pub fn get_bool(conn: &Connection, key: &str, default: bool) -> Result<bool> {
    Ok(get(conn, key)?.and_then(|v| v.as_bool()).unwrap_or(default))
}

/// Frecuencia de las copias automáticas: "off", "daily" o "weekly".
pub const BACKUPS_AUTO: &str = "backups.auto";
/// Cuántas copias automáticas se conservan.
pub const BACKUPS_KEEP: &str = "backups.keep";
/// Carpeta de las copias (propia de este equipo: no viaja en las copias).
pub const BACKUPS_DIR: &str = "local.backups.dir";
/// Versión de la app que abrió por última vez la base (copia previa a actualizar).
pub const LOCAL_APP_VERSION: &str = "local.app_version";

pub fn get_string(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(get(conn, key)?.and_then(|v| v.as_str().map(String::from)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::migrate;

    #[test]
    fn roundtrip() {
        let mut c = Connection::open_in_memory().unwrap();
        migrate(&mut c).unwrap();
        assert!(get_bool(&c, NOTIFICATIONS_SHOW_DETAILS, true).unwrap());
        set(&c, NOTIFICATIONS_SHOW_DETAILS, &Value::Bool(false)).unwrap();
        assert!(!get_bool(&c, NOTIFICATIONS_SHOW_DETAILS, true).unwrap());
        set(&c, NOTIFICATIONS_SHOW_DETAILS, &Value::Bool(true)).unwrap();
        assert!(get_bool(&c, NOTIFICATIONS_SHOW_DETAILS, false).unwrap());
    }
}
