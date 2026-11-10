//! Apertura de la base de datos SQLite cifrada con SQLCipher.

pub mod migrations;

use crate::crypto::{to_hex_zeroizing, SecretKey};
use crate::error::{CoreError, Result};
use rusqlite::{Connection, ErrorCode, OpenFlags};
use std::path::Path;
use std::time::Duration;
use zeroize::Zeroizing;

/// Abre (o crea) la base de datos cifrada con la clave en bruto `key`
/// y la deja configurada y migrada.
///
/// La función se niega a continuar si la biblioteca SQLite enlazada no es
/// SQLCipher: así nunca se crea por error una base de datos sin cifrar.
pub fn open_encrypted(path: &Path, key: &SecretKey) -> Result<Connection> {
    let flags = OpenFlags::SQLITE_OPEN_READ_WRITE
        | OpenFlags::SQLITE_OPEN_CREATE
        | OpenFlags::SQLITE_OPEN_NO_MUTEX
        | OpenFlags::SQLITE_OPEN_URI;
    let mut conn = Connection::open_with_flags(path, flags)?;
    apply_key(&conn, key)?;
    ensure_sqlcipher(&conn)?;
    verify_key(&conn)?;
    configure(&conn)?;
    migrations::migrate(&mut conn)?;
    Ok(conn)
}

/// `PRAGMA key` con clave en bruto (`x'..'`): SQLCipher no aplica su propio
/// PBKDF2 porque la clave ya proviene de Argon2id + envoltura.
fn apply_key(conn: &Connection, key: &SecretKey) -> Result<()> {
    let hex = to_hex_zeroizing(key.as_ref());
    let mut stmt = Zeroizing::new(String::with_capacity(hex.len() + 24));
    stmt.push_str("PRAGMA key = \"x'");
    stmt.push_str(&hex);
    stmt.push_str("'\";");
    conn.execute_batch(&stmt)?;
    Ok(())
}

fn ensure_sqlcipher(conn: &Connection) -> Result<()> {
    let version: Option<String> = conn
        .query_row("PRAGMA cipher_version", [], |r| r.get(0))
        .ok();
    match version {
        Some(v) if !v.is_empty() => Ok(()),
        _ => Err(CoreError::Keystore(
            "la biblioteca SQLite no incluye SQLCipher; se aborta para no guardar datos sin cifrar"
                .into(),
        )),
    }
}

/// La primera lectura real falla con SQLITE_NOTADB si la clave no coincide.
fn verify_key(conn: &Connection) -> Result<()> {
    match conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| {
        r.get::<_, i64>(0)
    }) {
        Ok(_) => Ok(()),
        Err(rusqlite::Error::SqliteFailure(e, _)) if e.code == ErrorCode::NotADatabase => {
            Err(CoreError::InvalidPassword)
        }
        Err(e) => Err(e.into()),
    }
}

fn configure(conn: &Connection) -> Result<()> {
    conn.busy_timeout(Duration::from_secs(5))?;
    // Integridad referencial.
    conn.pragma_update(None, "foreign_keys", "ON")?;
    // Las tablas temporales viven en memoria: nunca se escriben en claro al disco.
    conn.pragma_update(None, "temp_store", "MEMORY")?;
    // WAL: escrituras atómicas y lecturas concurrentes. El WAL también está cifrado.
    let _mode: String = conn.query_row("PRAGMA journal_mode = WAL", [], |r| r.get(0))?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    // Al borrar, las páginas liberadas se sobrescriben con ceros.
    conn.pragma_update(None, "secure_delete", "ON")?;
    Ok(())
}

/// Bloque atómico anidable basado en `SAVEPOINT`.
///
/// A diferencia de `BEGIN`, funciona tanto en el nivel superior como dentro
/// de otra transacción (p. ej. una importación que crea miles de eventos,
/// cada uno atómico, dentro de una operación también atómica). Si no se llama
/// a [`Atomic::commit`], al liberarse deshace sus cambios.
pub struct Atomic<'c> {
    conn: &'c Connection,
    name: String,
    done: bool,
}

static SAVEPOINT_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

impl<'c> Atomic<'c> {
    pub fn begin(conn: &'c Connection) -> Result<Self> {
        let n = SAVEPOINT_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let name = format!("chronos_sp_{n}");
        conn.execute_batch(&format!("SAVEPOINT {name}"))?;
        Ok(Atomic {
            conn,
            name,
            done: false,
        })
    }

    pub fn commit(mut self) -> Result<()> {
        self.conn.execute_batch(&format!("RELEASE {}", self.name))?;
        self.done = true;
        Ok(())
    }
}

impl std::ops::Deref for Atomic<'_> {
    type Target = Connection;
    fn deref(&self) -> &Connection {
        self.conn
    }
}

impl Drop for Atomic<'_> {
    fn drop(&mut self) {
        if !self.done {
            let _ = self
                .conn
                .execute_batch(&format!("ROLLBACK TO {0}; RELEASE {0}", self.name));
        }
    }
}

/// Instante actual en milisegundos UTC.
pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::random;

    #[test]
    fn encrypted_database_rejects_wrong_key_and_is_not_plaintext() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.db");
        let key = random::secret_key().unwrap();
        {
            let conn = open_encrypted(&path, &key).unwrap();
            conn.execute(
                "INSERT INTO settings (key, value, updated_at) VALUES ('marcador', '\"SECRETO-VISIBLE\"', 0)",
                [],
            )
            .unwrap();
            // Fuerza el volcado del WAL al archivo principal.
            conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()))
                .unwrap();
        }
        let raw = std::fs::read(&path).unwrap();
        assert!(
            !raw.starts_with(b"SQLite format 3"),
            "la cabecera no debe ser la de SQLite en claro"
        );
        assert!(
            !raw.windows(15).any(|w| w == b"SECRETO-VISIBLE"),
            "los datos no deben aparecer en claro"
        );

        let wrong = random::secret_key().unwrap();
        assert!(matches!(
            open_encrypted(&path, &wrong),
            Err(CoreError::InvalidPassword)
        ));

        let conn = open_encrypted(&path, &key).unwrap();
        let v: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'marcador'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(v, "\"SECRETO-VISIBLE\"");
    }
}
