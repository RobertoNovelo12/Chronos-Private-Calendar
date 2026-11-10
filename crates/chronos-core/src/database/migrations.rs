//! Migraciones versionadas con `PRAGMA user_version`.
//!
//! Cada migración se aplica en su propia transacción: o se aplica completa
//! (incluido el cambio de versión) o no se aplica nada.

use crate::error::{CoreError, Result};
use rusqlite::Connection;

struct Migration {
    version: i64,
    sql: &'static str,
}

const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        sql: include_str!("../../migrations/0001_init.sql"),
    },
    Migration {
        version: 2,
        sql: include_str!("../../migrations/0002_ical_uid.sql"),
    },
    Migration {
        version: 3,
        sql: include_str!("../../migrations/0003_task_uid.sql"),
    },
];

/// Versión de esquema que espera esta compilación.
pub const CURRENT_SCHEMA_VERSION: i64 = 3;

pub fn schema_version(conn: &Connection) -> Result<i64> {
    Ok(conn.query_row("PRAGMA user_version", [], |r| r.get(0))?)
}

pub fn migrate(conn: &mut Connection) -> Result<()> {
    let current = schema_version(conn)?;
    if current > CURRENT_SCHEMA_VERSION {
        return Err(CoreError::UnsupportedVersion(format!(
            "la base de datos usa el esquema {current}, creado por una versión más reciente de Chronos"
        )));
    }
    for m in MIGRATIONS.iter().filter(|m| m.version > current) {
        let tx = conn.transaction()?;
        tx.execute_batch(m.sql)?;
        tx.pragma_update(None, "user_version", m.version)?;
        tx.commit()?;
        tracing::info!(version = m.version, "migración aplicada");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_are_idempotent_and_create_all_tables() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate(&mut conn).unwrap();
        migrate(&mut conn).unwrap();
        assert_eq!(schema_version(&conn).unwrap(), CURRENT_SCHEMA_VERSION);
        for t in [
            "calendars",
            "events",
            "event_attendees",
            "event_reminders",
            "event_recurrences",
            "event_exceptions",
            "tasks",
            "labels",
            "event_labels",
            "settings",
            "backup_history",
        ] {
            let n: i64 = conn
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    [t],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(n, 1, "falta la tabla {t}");
        }
        let fk_errors: i64 = conn
            .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(fk_errors, 0);
    }

    /// Una base creada por una versión anterior (esquema 1, con datos) se
    /// actualiza sin perder nada: es lo que ocurre al instalar una versión nueva.
    #[test]
    fn upgrades_v1_database_preserving_data() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        conn.execute_batch(MIGRATIONS[0].sql).unwrap();
        conn.pragma_update(None, "user_version", 1).unwrap();
        conn.execute_batch(
            "INSERT INTO calendars (id,name,color,created_at,updated_at) VALUES ('c','Trabajo','#112233',0,0);
             INSERT INTO events (id,calendar_id,title,start_at,end_at,created_at,updated_at)
               VALUES ('e','c','Reunión anual',1000,2000,0,0);
             INSERT INTO event_reminders (id,event_id,offset_minutes,created_at) VALUES ('r','e',10,0);",
        )
        .unwrap();

        migrate(&mut conn).unwrap();

        assert_eq!(schema_version(&conn).unwrap(), CURRENT_SCHEMA_VERSION);
        let (title, uid): (String, Option<String>) = conn
            .query_row(
                "SELECT title, ical_uid FROM events WHERE id = 'e'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(title, "Reunión anual");
        assert_eq!(
            uid, None,
            "la columna nueva queda vacía en los eventos existentes"
        );
        let reminders: i64 = conn
            .query_row("SELECT count(*) FROM event_reminders", [], |r| r.get(0))
            .unwrap();
        assert_eq!(reminders, 1);
        let fk: i64 = conn
            .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(fk, 0);
    }

    #[test]
    fn refuses_newer_schema() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "user_version", CURRENT_SCHEMA_VERSION + 1)
            .unwrap();
        assert!(matches!(
            migrate(&mut conn),
            Err(CoreError::UnsupportedVersion(_))
        ));
    }

    #[test]
    fn constraints_reject_invalid_rows() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate(&mut conn).unwrap();
        // color no válido
        assert!(conn
            .execute(
                "INSERT INTO calendars (id,name,color,created_at,updated_at) VALUES ('a','x','rojo',0,0)",
                []
            )
            .is_err());
        conn.execute(
            "INSERT INTO calendars (id,name,color,created_at,updated_at) VALUES ('c','x','#112233',0,0)",
            [],
        )
        .unwrap();
        // fin anterior al inicio
        assert!(conn
            .execute(
                "INSERT INTO events (id,calendar_id,start_at,end_at,created_at,updated_at) VALUES ('e','c',10,5,0,0)",
                []
            )
            .is_err());
        // calendario inexistente
        assert!(conn
            .execute(
                "INSERT INTO events (id,calendar_id,start_at,end_at,created_at,updated_at) VALUES ('e','zz',1,5,0,0)",
                []
            )
            .is_err());
        // recordatorio sin propietario
        assert!(conn
            .execute(
                "INSERT INTO event_reminders (id,offset_minutes,created_at) VALUES ('r',10,0)",
                []
            )
            .is_err());
    }
}
