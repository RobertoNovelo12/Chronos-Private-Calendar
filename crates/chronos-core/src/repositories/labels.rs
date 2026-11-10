//! Persistencia de etiquetas. La asignación a eventos (`event_labels`) la
//! gestiona el repositorio de eventos.

use crate::database::now_ms;
use crate::error::{CoreError, Result};
use crate::models::calendar::normalize_color;
use crate::models::label::{normalize_label_name, Label, LabelPatch, NewLabel, MAX_LABELS};
use rusqlite::{params, Connection, OptionalExtension, Row};
use uuid::Uuid;

const COLUMNS: &str = "id, name, color, created_at, updated_at";

fn from_row(r: &Row<'_>) -> rusqlite::Result<Label> {
    Ok(Label {
        id: r.get(0)?,
        name: r.get(1)?,
        color: r.get(2)?,
        created_at: r.get(3)?,
        updated_at: r.get(4)?,
    })
}

/// Todas las etiquetas, por nombre.
pub fn list(conn: &Connection) -> Result<Vec<Label>> {
    let mut stmt = conn.prepare_cached(&format!(
        "SELECT {COLUMNS} FROM labels ORDER BY name COLLATE NOCASE"
    ))?;
    let rows = stmt.query_map([], from_row)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn get(conn: &Connection, id: &str) -> Result<Label> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM labels WHERE id = ?1"),
        [id],
        from_row,
    )
    .optional()?
    .ok_or(CoreError::NotFound("etiqueta"))
}

/// Busca por nombre sin distinguir mayúsculas.
pub fn find_by_name(conn: &Connection, name: &str) -> Result<Option<Label>> {
    Ok(conn
        .query_row(
            &format!("SELECT {COLUMNS} FROM labels WHERE name = ?1 COLLATE NOCASE"),
            [name.trim()],
            from_row,
        )
        .optional()?)
}

fn ensure_unique(conn: &Connection, name: &str, except: Option<&str>) -> Result<()> {
    match find_by_name(conn, name)? {
        Some(l) if Some(l.id.as_str()) != except => Err(CoreError::Validation(
            "ya existe una etiqueta con ese nombre".into(),
        )),
        _ => Ok(()),
    }
}

pub fn create(conn: &Connection, input: &NewLabel) -> Result<Label> {
    let name = normalize_label_name(&input.name)?;
    let color = normalize_color(&input.color)?;
    ensure_unique(conn, &name, None)?;
    let total: i64 = conn.query_row("SELECT count(*) FROM labels", [], |r| r.get(0))?;
    if total >= MAX_LABELS {
        return Err(CoreError::Validation(format!(
            "máximo {MAX_LABELS} etiquetas"
        )));
    }
    let id = Uuid::new_v4().to_string();
    let now = now_ms();
    conn.execute(
        "INSERT INTO labels (id, name, color, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
        params![id, name, color, now],
    )?;
    tracing::debug!(label_id = %id, "etiqueta creada");
    get(conn, &id)
}

pub fn update(conn: &Connection, id: &str, patch: &LabelPatch) -> Result<Label> {
    let mut current = get(conn, id)?;
    if let Some(name) = &patch.name {
        let name = normalize_label_name(name)?;
        ensure_unique(conn, &name, Some(id))?;
        current.name = name;
    }
    if let Some(color) = &patch.color {
        current.color = normalize_color(color)?;
    }
    conn.execute(
        "UPDATE labels SET name = ?2, color = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, current.name, current.color, now_ms()],
    )?;
    get(conn, id)
}

/// Elimina la etiqueta; los eventos la pierden (borrado en cascada), no se borran.
pub fn delete(conn: &Connection, id: &str) -> Result<()> {
    let n = conn.execute("DELETE FROM labels WHERE id = ?1", [id])?;
    if n == 0 {
        return Err(CoreError::NotFound("etiqueta"));
    }
    tracing::debug!(label_id = %id, "etiqueta eliminada");
    Ok(())
}

/// Colores para etiquetas creadas al importar.
const IMPORT_COLORS: &[&str] = &[
    "#2f80ed", "#eb5757", "#27ae60", "#f2994a", "#9b51e0", "#0f766e", "#e84393", "#828282",
];

/// Devuelve el id de la etiqueta con ese nombre, creándola si no existe
/// (importación). Nombres no válidos devuelven `None`.
pub fn ensure_by_name(
    conn: &Connection,
    name: &str,
    color: Option<&str>,
) -> Result<Option<String>> {
    let Ok(name) = normalize_label_name(name) else {
        return Ok(None);
    };
    if let Some(l) = find_by_name(conn, &name)? {
        return Ok(Some(l.id));
    }
    let total: i64 = conn.query_row("SELECT count(*) FROM labels", [], |r| r.get(0))?;
    if total >= MAX_LABELS {
        return Ok(None);
    }
    let color = color
        .and_then(|c| normalize_color(c).ok())
        .unwrap_or_else(|| IMPORT_COLORS[total as usize % IMPORT_COLORS.len()].to_string());
    Ok(Some(create(conn, &NewLabel { name, color })?.id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::migrate;

    fn db() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        c.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate(&mut c).unwrap();
        c
    }

    fn new(name: &str) -> NewLabel {
        NewLabel {
            name: name.into(),
            color: "#AABBCC".into(),
        }
    }

    #[test]
    fn crud_and_validation() {
        let c = db();
        let a = create(&c, &new("  Urgente ")).unwrap();
        assert_eq!((a.name.as_str(), a.color.as_str()), ("Urgente", "#aabbcc"));
        create(&c, &new("cliente")).unwrap();
        // Orden alfabético sin distinguir mayúsculas.
        let names: Vec<String> = list(&c).unwrap().into_iter().map(|l| l.name).collect();
        assert_eq!(names, ["cliente", "Urgente"]);

        // Nombre repetido (sin distinguir mayúsculas), vacío o color no válido.
        assert!(create(&c, &new("URGENTE")).is_err());
        assert!(create(&c, &new("   ")).is_err());
        assert!(create(
            &c,
            &NewLabel {
                name: "x".into(),
                color: "rojo".into()
            }
        )
        .is_err());

        let renamed = update(
            &c,
            &a.id,
            &LabelPatch {
                name: Some("Importante".into()),
                color: Some("#112233".into()),
            },
        )
        .unwrap();
        assert_eq!(renamed.name, "Importante");
        // Renombrar a sí misma con otras mayúsculas está permitido; a otra existente, no.
        update(
            &c,
            &a.id,
            &LabelPatch {
                name: Some("IMPORTANTE".into()),
                color: None,
            },
        )
        .unwrap();
        assert!(update(
            &c,
            &a.id,
            &LabelPatch {
                name: Some("Cliente".into()),
                color: None
            }
        )
        .is_err());

        delete(&c, &a.id).unwrap();
        assert!(matches!(delete(&c, &a.id), Err(CoreError::NotFound(_))));
        assert_eq!(list(&c).unwrap().len(), 1);
    }

    #[test]
    fn ensure_by_name_reuses_and_creates() {
        let c = db();
        let a = ensure_by_name(&c, "Viaje", None).unwrap().unwrap();
        let again = ensure_by_name(&c, "viaje", Some("#000000"))
            .unwrap()
            .unwrap();
        assert_eq!(a, again);
        let b = ensure_by_name(&c, "Casa", Some("#123456"))
            .unwrap()
            .unwrap();
        assert_eq!(get(&c, &b).unwrap().color, "#123456");
        assert_eq!(ensure_by_name(&c, "  ", None).unwrap(), None);
    }
}
