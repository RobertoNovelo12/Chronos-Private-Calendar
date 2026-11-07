//! Persistencia de calendarios.

use crate::database::now_ms;
use crate::error::{CoreError, Result};
use crate::models::calendar::{
    normalize_color, normalize_description, normalize_name, Calendar, CalendarPatch, NewCalendar,
};
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::collections::HashSet;
use uuid::Uuid;

const COLUMNS: &str =
    "id, name, color, description, is_visible, is_default, sort_order, created_at, updated_at";

fn from_row(r: &Row<'_>) -> rusqlite::Result<Calendar> {
    Ok(Calendar {
        id: r.get(0)?,
        name: r.get(1)?,
        color: r.get(2)?,
        description: r.get(3)?,
        is_visible: r.get::<_, i64>(4)? != 0,
        is_default: r.get::<_, i64>(5)? != 0,
        sort_order: r.get(6)?,
        created_at: r.get(7)?,
        updated_at: r.get(8)?,
    })
}

pub fn list(conn: &Connection) -> Result<Vec<Calendar>> {
    let mut stmt = conn.prepare_cached(&format!(
        "SELECT {COLUMNS} FROM calendars ORDER BY sort_order, created_at"
    ))?;
    let rows = stmt.query_map([], from_row)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn get(conn: &Connection, id: &str) -> Result<Calendar> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM calendars WHERE id = ?1"),
        [id],
        from_row,
    )
    .optional()?
    .ok_or(CoreError::NotFound("calendario"))
}

pub fn count(conn: &Connection) -> Result<i64> {
    Ok(conn.query_row("SELECT count(*) FROM calendars", [], |r| r.get(0))?)
}

pub fn create(conn: &Connection, input: &NewCalendar) -> Result<Calendar> {
    let name = normalize_name(&input.name)?;
    let color = normalize_color(&input.color)?;
    let description = normalize_description(input.description.as_deref().unwrap_or(""))?;
    let id = Uuid::new_v4().to_string();
    let now = now_ms();
    let next_order: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order) + 1, 0) FROM calendars",
        [],
        |r| r.get(0),
    )?;
    // El primer calendario se convierte en predeterminado.
    let is_default = count(conn)? == 0;
    conn.execute(
        "INSERT INTO calendars (id, name, color, description, is_visible, is_default, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?7, ?7)",
        params![id, name, color, description, is_default as i64, next_order, now],
    )?;
    tracing::debug!(calendar_id = %id, "calendario creado");
    get(conn, &id)
}

pub fn update(conn: &Connection, id: &str, patch: &CalendarPatch) -> Result<Calendar> {
    let mut current = get(conn, id)?;
    if let Some(name) = &patch.name {
        current.name = normalize_name(name)?;
    }
    if let Some(color) = &patch.color {
        current.color = normalize_color(color)?;
    }
    if let Some(description) = &patch.description {
        current.description = normalize_description(description)?;
    }
    if let Some(visible) = patch.is_visible {
        current.is_visible = visible;
    }
    conn.execute(
        "UPDATE calendars SET name = ?2, color = ?3, description = ?4, is_visible = ?5, updated_at = ?6 WHERE id = ?1",
        params![id, current.name, current.color, current.description, current.is_visible as i64, now_ms()],
    )?;
    get(conn, id)
}

/// Elimina un calendario y, en cascada, sus eventos. No permite borrar el
/// último calendario. Si era el predeterminado, el primero restante pasa a serlo.
pub fn delete(conn: &mut Connection, id: &str) -> Result<()> {
    let tx = conn.transaction()?;
    let target = get(&tx, id)?;
    if count(&tx)? <= 1 {
        return Err(CoreError::Validation(
            "debe existir al menos un calendario".into(),
        ));
    }
    tx.execute("DELETE FROM calendars WHERE id = ?1", [id])?;
    if target.is_default {
        tx.execute(
            "UPDATE calendars SET is_default = 1, updated_at = ?1
             WHERE id = (SELECT id FROM calendars ORDER BY sort_order, created_at LIMIT 1)",
            [now_ms()],
        )?;
    }
    tx.commit()?;
    tracing::debug!(calendar_id = %id, "calendario eliminado");
    Ok(())
}

pub fn set_default(conn: &mut Connection, id: &str) -> Result<Calendar> {
    let tx = conn.transaction()?;
    get(&tx, id)?;
    let now = now_ms();
    tx.execute(
        "UPDATE calendars SET is_default = 0, updated_at = ?1 WHERE is_default = 1",
        [now],
    )?;
    tx.execute(
        "UPDATE calendars SET is_default = 1, updated_at = ?2 WHERE id = ?1",
        params![id, now],
    )?;
    tx.commit()?;
    get(conn, id)
}

/// Reordena: `ordered_ids` debe contener exactamente todos los calendarios.
pub fn reorder(conn: &mut Connection, ordered_ids: &[String]) -> Result<Vec<Calendar>> {
    let tx = conn.transaction()?;
    let existing: HashSet<String> = list(&tx)?.into_iter().map(|c| c.id).collect();
    let requested: HashSet<&String> = ordered_ids.iter().collect();
    if requested.len() != ordered_ids.len()
        || existing.len() != ordered_ids.len()
        || !ordered_ids.iter().all(|id| existing.contains(id))
    {
        return Err(CoreError::Validation(
            "el nuevo orden debe incluir cada calendario una vez".into(),
        ));
    }
    let now = now_ms();
    {
        let mut stmt =
            tx.prepare("UPDATE calendars SET sort_order = ?2, updated_at = ?3 WHERE id = ?1")?;
        for (i, id) in ordered_ids.iter().enumerate() {
            stmt.execute(params![id, i as i64, now])?;
        }
    }
    tx.commit()?;
    list(conn)
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

    fn new(name: &str) -> NewCalendar {
        NewCalendar {
            name: name.into(),
            color: "#3366FF".into(),
            description: None,
        }
    }

    #[test]
    fn crud_default_and_reorder() {
        let mut c = db();
        let a = create(&c, &new("  Personal ")).unwrap();
        assert_eq!(a.name, "Personal");
        assert_eq!(a.color, "#3366ff");
        assert!(a.is_default);
        let b = create(&c, &new("Trabajo")).unwrap();
        assert!(!b.is_default);
        assert_eq!(b.sort_order, a.sort_order + 1);

        let b = update(
            &c,
            &b.id,
            &CalendarPatch {
                is_visible: Some(false),
                name: Some("Oficina".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(!b.is_visible);
        assert_eq!(b.name, "Oficina");

        let b = set_default(&mut c, &b.id).unwrap();
        assert!(b.is_default);
        assert!(!get(&c, &a.id).unwrap().is_default);

        let ordered = reorder(&mut c, &[b.id.clone(), a.id.clone()]).unwrap();
        assert_eq!(ordered[0].id, b.id);
        assert!(reorder(&mut c, std::slice::from_ref(&b.id)).is_err());
        assert!(reorder(&mut c, &[b.id.clone(), b.id.clone()]).is_err());

        // Borrar el predeterminado reasigna el predeterminado.
        delete(&mut c, &b.id).unwrap();
        assert!(get(&c, &a.id).unwrap().is_default);
        // No se puede borrar el último.
        assert!(matches!(
            delete(&mut c, &a.id),
            Err(CoreError::Validation(_))
        ));
        assert!(matches!(get(&c, "no-existe"), Err(CoreError::NotFound(_))));
    }

    #[test]
    fn validation() {
        let c = db();
        assert!(create(&c, &new("   ")).is_err());
        assert!(create(
            &c,
            &NewCalendar {
                name: "x".into(),
                color: "red".into(),
                description: None
            }
        )
        .is_err());
        assert!(create(&c, &new(&"a".repeat(201))).is_err());
    }

    #[test]
    fn deleting_calendar_cascades_events() {
        let mut c = db();
        let a = create(&c, &new("A")).unwrap();
        let b = create(&c, &new("B")).unwrap();
        c.execute(
            "INSERT INTO events (id, calendar_id, start_at, end_at, created_at, updated_at) VALUES ('e1', ?1, 0, 1, 0, 0)",
            [&b.id],
        )
        .unwrap();
        delete(&mut c, &b.id).unwrap();
        let n: i64 = c
            .query_row("SELECT count(*) FROM events", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
        assert_eq!(list(&c).unwrap().len(), 1);
        assert_eq!(list(&c).unwrap()[0].id, a.id);
    }
}
