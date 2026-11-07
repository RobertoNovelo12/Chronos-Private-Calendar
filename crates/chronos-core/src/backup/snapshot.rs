//! Instantánea lógica de la base de datos (contenido de las copias).
//!
//! Se exporta tabla por tabla en un orden compatible con las claves foráneas.
//! No se copia el archivo SQLite: así la copia es independiente de la clave
//! de la base de datos y nunca se escribe una versión en claro en disco.

use crate::database::migrations::{schema_version, CURRENT_SCHEMA_VERSION};
use crate::error::{CoreError, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params_from_iter, Connection, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value as JsonValue};
use std::collections::{BTreeMap, HashSet};

/// Tablas con datos del usuario, en orden de dependencias (padres primero).
/// `backup_history` queda fuera: describe archivos de este equipo.
pub const DATA_TABLES: &[&str] = &[
    "calendars",
    "labels",
    "events",
    "event_recurrences",
    "event_exceptions",
    "event_attendees",
    "tasks",
    "event_reminders",
    "event_labels",
    "settings",
];

/// Prefijo de ajustes propios del equipo que no viajan en la copia.
pub const LOCAL_SETTINGS_PREFIX: &str = "local.";

#[derive(Debug, Serialize, Deserialize)]
pub struct TableDump {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<JsonValue>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Snapshot {
    pub schema_version: i64,
    pub tables: BTreeMap<String, TableDump>,
}

impl Snapshot {
    pub fn total_rows(&self) -> usize {
        self.tables.values().map(|t| t.rows.len()).sum()
    }
}

fn table_columns(conn: &Connection, table: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT name FROM pragma_table_info('{table}') ORDER BY cid"
    ))?;
    let cols = stmt.query_map([], |r| r.get::<_, String>(0))?;
    Ok(cols.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn to_json(v: ValueRef<'_>) -> JsonValue {
    match v {
        ValueRef::Null => JsonValue::Null,
        ValueRef::Integer(i) => JsonValue::from(i),
        ValueRef::Real(f) => serde_json::Number::from_f64(f)
            .map(JsonValue::Number)
            .unwrap_or(JsonValue::Null),
        ValueRef::Text(t) => JsonValue::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => {
            let mut m = Map::new();
            m.insert("$blob".into(), JsonValue::String(B64.encode(b)));
            JsonValue::Object(m)
        }
    }
}

fn from_json(v: &JsonValue) -> Result<SqlValue> {
    Ok(match v {
        JsonValue::Null => SqlValue::Null,
        JsonValue::Bool(b) => SqlValue::Integer(*b as i64),
        JsonValue::Number(n) => match n.as_i64() {
            Some(i) => SqlValue::Integer(i),
            None => SqlValue::Real(
                n.as_f64()
                    .ok_or_else(|| CoreError::CorruptBackup("número no válido".into()))?,
            ),
        },
        JsonValue::String(s) => SqlValue::Text(s.clone()),
        JsonValue::Object(m) => match m.get("$blob") {
            Some(JsonValue::String(b)) => SqlValue::Blob(
                B64.decode(b)
                    .map_err(|_| CoreError::CorruptBackup("binario mal codificado".into()))?,
            ),
            _ => {
                return Err(CoreError::CorruptBackup(
                    "valor de celda no reconocido".into(),
                ))
            }
        },
        JsonValue::Array(_) => {
            return Err(CoreError::CorruptBackup(
                "valor de celda no reconocido".into(),
            ))
        }
    })
}

/// Exporta todas las tablas de datos. Debe ejecutarse dentro de una
/// transacción de lectura para obtener una vista coherente.
pub fn export(conn: &Connection) -> Result<Snapshot> {
    let mut tables = BTreeMap::new();
    for table in DATA_TABLES {
        let columns = table_columns(conn, table)?;
        let filter = if *table == "settings" {
            format!(" WHERE key NOT LIKE '{LOCAL_SETTINGS_PREFIX}%'")
        } else {
            String::new()
        };
        let mut stmt = conn.prepare(&format!("SELECT * FROM {table}{filter}"))?;
        let n = columns.len();
        let rows = stmt.query_map([], |r| {
            let mut row = Vec::with_capacity(n);
            for i in 0..n {
                row.push(to_json(r.get_ref(i)?));
            }
            Ok(row)
        })?;
        let rows = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        tables.insert((*table).to_string(), TableDump { columns, rows });
    }
    Ok(Snapshot {
        schema_version: schema_version(conn)?,
        tables,
    })
}

/// Comprueba que la instantánea es compatible con el esquema actual.
pub fn validate(conn: &Connection, snap: &Snapshot) -> Result<()> {
    if snap.schema_version > CURRENT_SCHEMA_VERSION {
        return Err(CoreError::UnsupportedVersion(
            "la copia procede de una versión más reciente de Chronos".into(),
        ));
    }
    for (name, dump) in &snap.tables {
        if !DATA_TABLES.contains(&name.as_str()) {
            return Err(CoreError::CorruptBackup(
                "la copia contiene una tabla desconocida".into(),
            ));
        }
        let current: HashSet<String> = table_columns(conn, name)?.into_iter().collect();
        if dump.columns.iter().any(|c| !current.contains(c)) {
            return Err(CoreError::CorruptBackup(
                "la copia contiene columnas desconocidas".into(),
            ));
        }
        if dump.rows.iter().any(|r| r.len() != dump.columns.len()) {
            return Err(CoreError::CorruptBackup(
                "fila con número de columnas incorrecto".into(),
            ));
        }
    }
    Ok(())
}

/// Sustituye todos los datos por los de la instantánea dentro de `tx`.
/// Si algo falla, la transacción se descarta y los datos actuales quedan intactos.
pub fn replace_all(tx: &Transaction<'_>, snap: &Snapshot) -> Result<usize> {
    validate(tx, snap)?;
    // Las FK se comprueban al confirmar (permite autoreferencias en `events`).
    tx.pragma_update(None, "defer_foreign_keys", "ON")?;
    for table in DATA_TABLES.iter().rev() {
        if *table == "settings" {
            tx.execute(
                &format!("DELETE FROM settings WHERE key NOT LIKE '{LOCAL_SETTINGS_PREFIX}%'"),
                [],
            )?;
        } else {
            tx.execute(&format!("DELETE FROM {table}"), [])?;
        }
    }
    let mut inserted = 0usize;
    for table in DATA_TABLES {
        let Some(dump) = snap.tables.get(*table) else {
            continue;
        };
        if dump.rows.is_empty() {
            continue;
        }
        // Los nombres de columna ya se validaron contra el esquema actual.
        let cols = dump.columns.join(", ");
        let marks = vec!["?"; dump.columns.len()].join(", ");
        let verb = if *table == "settings" {
            "INSERT OR REPLACE"
        } else {
            "INSERT"
        };
        let mut stmt = tx.prepare(&format!("{verb} INTO {table} ({cols}) VALUES ({marks})"))?;
        for row in &dump.rows {
            let values = row.iter().map(from_json).collect::<Result<Vec<_>>>()?;
            stmt.execute(params_from_iter(values))?;
            inserted += 1;
        }
    }
    let violations: i64 =
        tx.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| {
            r.get(0)
        })?;
    if violations > 0 {
        return Err(CoreError::CorruptBackup(
            "la copia rompe la integridad referencial".into(),
        ));
    }
    Ok(inserted)
}
