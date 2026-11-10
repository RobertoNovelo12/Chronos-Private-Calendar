//! Persistencia de tareas y de sus recordatorios.

use crate::database::{now_ms, Atomic};
use crate::error::{CoreError, Result};
use crate::models::event::normalize_reminders;
use crate::models::task::*;
use crate::repositories::calendars;
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::collections::HashMap;
use uuid::Uuid;

const COLUMNS: &str = "id, calendar_id, title, notes, due_at, is_all_day, priority, completed_at, \
     sort_order, created_at, updated_at";

fn from_row(r: &Row<'_>) -> rusqlite::Result<Task> {
    Ok(Task {
        id: r.get(0)?,
        calendar_id: r.get(1)?,
        title: r.get(2)?,
        notes: r.get(3)?,
        due_at: r.get(4)?,
        is_all_day: r.get::<_, i64>(5)? != 0,
        priority: r.get::<_, i64>(6)?.clamp(0, 3) as u8,
        completed_at: r.get(7)?,
        sort_order: r.get(8)?,
        reminders: Vec::new(),
        created_at: r.get(9)?,
        updated_at: r.get(10)?,
    })
}

fn reminders_for(conn: &Connection, ids: &[String]) -> Result<HashMap<String, Vec<i32>>> {
    let mut map: HashMap<String, Vec<i32>> = HashMap::new();
    if ids.is_empty() {
        return Ok(map);
    }
    let mut stmt = conn.prepare_cached(
        "SELECT task_id, offset_minutes FROM event_reminders
         WHERE task_id IN (SELECT value FROM json_each(?1)) ORDER BY offset_minutes",
    )?;
    let rows = stmt.query_map([serde_json::to_string(ids)?], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, i32>(1)?))
    })?;
    for row in rows {
        let (id, m) = row?;
        map.entry(id).or_default().push(m);
    }
    Ok(map)
}

fn attach(conn: &Connection, tasks: &mut [Task]) -> Result<()> {
    let ids: Vec<String> = tasks.iter().map(|t| t.id.clone()).collect();
    let mut rem = reminders_for(conn, &ids)?;
    for t in tasks.iter_mut() {
        t.reminders = rem.remove(&t.id).unwrap_or_default();
    }
    Ok(())
}

fn set_reminders(conn: &Connection, task_id: &str, reminders: &[i32]) -> Result<()> {
    conn.execute("DELETE FROM event_reminders WHERE task_id = ?1", [task_id])?;
    let now = now_ms();
    let mut stmt = conn.prepare_cached(
        "INSERT INTO event_reminders (id, task_id, offset_minutes, method, created_at) VALUES (?1, ?2, ?3, 'notification', ?4)",
    )?;
    for m in reminders {
        stmt.execute(params![Uuid::new_v4().to_string(), task_id, m, now])?;
    }
    Ok(())
}

/// Valida y normaliza. Sin vencimiento no hay recordatorios.
fn validate(conn: &Connection, mut t: Task) -> Result<Task> {
    t.title = normalize_task_title(&t.title)?;
    validate_task_notes(&t.notes)?;
    validate_priority(t.priority)?;
    if t.due_at.is_none() {
        t.is_all_day = false;
        t.reminders.clear();
    }
    validate_due(t.due_at, t.is_all_day)?;
    t.reminders = normalize_reminders(&t.reminders)?;
    if let Some(cal) = &t.calendar_id {
        calendars::get(conn, cal)?;
    }
    Ok(t)
}

/// Todas las tareas: pendientes primero (por vencimiento), después las completadas.
pub fn list(conn: &Connection) -> Result<Vec<Task>> {
    let mut stmt = conn.prepare_cached(&format!(
        "SELECT {COLUMNS} FROM tasks
         ORDER BY completed_at IS NOT NULL, due_at IS NULL, due_at, sort_order, created_at"
    ))?;
    let mut out = stmt
        .query_map([], from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    attach(conn, &mut out)?;
    Ok(out)
}

pub fn get(conn: &Connection, id: &str) -> Result<Task> {
    let mut t = conn
        .query_row(
            &format!("SELECT {COLUMNS} FROM tasks WHERE id = ?1"),
            [id],
            from_row,
        )
        .optional()?
        .ok_or(CoreError::NotFound("tarea"))?;
    attach(conn, std::slice::from_mut(&mut t))?;
    Ok(t)
}

fn insert(conn: &Connection, t: &Task, ical_uid: Option<&str>) -> Result<()> {
    conn.execute(
        "INSERT INTO tasks (id, calendar_id, title, notes, due_at, is_all_day, priority, completed_at,
            sort_order, created_at, updated_at, ical_uid)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            t.id,
            t.calendar_id,
            t.title,
            t.notes,
            t.due_at,
            t.is_all_day as i64,
            t.priority as i64,
            t.completed_at,
            t.sort_order,
            t.created_at,
            t.updated_at,
            ical_uid
        ],
    )?;
    set_reminders(conn, &t.id, &t.reminders)
}

pub fn create(conn: &Connection, input: &NewTask) -> Result<Task> {
    let total: i64 = conn.query_row("SELECT count(*) FROM tasks", [], |r| r.get(0))?;
    if total >= MAX_TASKS {
        return Err(CoreError::Validation(format!("máximo {MAX_TASKS} tareas")));
    }
    let now = now_ms();
    let sort_order: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order) + 1, 0) FROM tasks",
        [],
        |r| r.get(0),
    )?;
    let task = validate(
        conn,
        Task {
            id: Uuid::new_v4().to_string(),
            calendar_id: input.calendar_id.clone().filter(|c| !c.is_empty()),
            title: input.title.clone(),
            notes: input.notes.clone(),
            due_at: input.due_at,
            is_all_day: input.is_all_day,
            priority: input.priority,
            completed_at: input.completed_at,
            sort_order,
            reminders: input.reminders.clone(),
            created_at: now,
            updated_at: now,
        },
    )?;
    let uid: Option<String> = input
        .ical_uid
        .as_deref()
        .map(str::trim)
        .filter(|u| !u.is_empty())
        .map(|u| u.chars().take(500).collect());
    let tx = Atomic::begin(conn)?;
    insert(&tx, &task, uid.as_deref())?;
    tx.commit()?;
    tracing::debug!(task_id = %task.id, "tarea creada");
    Ok(task)
}

pub fn update(conn: &Connection, id: &str, patch: &TaskPatch) -> Result<Task> {
    let mut t = get(conn, id)?;
    if let Some(v) = &patch.calendar_id {
        t.calendar_id = v.clone().filter(|c| !c.is_empty());
    }
    if let Some(v) = &patch.title {
        t.title = v.clone();
    }
    if let Some(v) = &patch.notes {
        t.notes = v.clone();
    }
    if let Some(v) = patch.due_at {
        t.due_at = v;
    }
    if let Some(v) = patch.is_all_day {
        t.is_all_day = v;
    }
    if let Some(v) = patch.priority {
        t.priority = v;
    }
    if let Some(v) = &patch.reminders {
        t.reminders = v.clone();
    }
    match patch.completed {
        Some(true) if t.completed_at.is_none() => t.completed_at = Some(now_ms()),
        Some(false) => t.completed_at = None,
        _ => {}
    }
    let t = validate(conn, t)?;
    let tx = Atomic::begin(conn)?;
    tx.execute(
        "UPDATE tasks SET calendar_id = ?2, title = ?3, notes = ?4, due_at = ?5, is_all_day = ?6,
                priority = ?7, completed_at = ?8, updated_at = ?9
         WHERE id = ?1",
        params![
            t.id,
            t.calendar_id,
            t.title,
            t.notes,
            t.due_at,
            t.is_all_day as i64,
            t.priority as i64,
            t.completed_at,
            now_ms()
        ],
    )?;
    set_reminders(&tx, &t.id, &t.reminders)?;
    tx.commit()?;
    get(conn, id)
}

/// Elimina y devuelve la tarea (para deshacer).
pub fn delete(conn: &Connection, id: &str) -> Result<Task> {
    let t = get(conn, id)?;
    conn.execute("DELETE FROM tasks WHERE id = ?1", [id])?;
    tracing::debug!(task_id = %id, "tarea eliminada");
    Ok(t)
}

/// Vuelve a insertar una tarea eliminada con su mismo id (deshacer).
pub fn restore(conn: &Connection, task: &Task) -> Result<Task> {
    Uuid::parse_str(&task.id)
        .map_err(|_| CoreError::Validation("identificador no válido".into()))?;
    let mut t = task.clone();
    // El calendario pudo eliminarse mientras tanto.
    if let Some(c) = &t.calendar_id {
        if calendars::get(conn, c).is_err() {
            t.calendar_id = None;
        }
    }
    let mut t = validate(conn, t)?;
    t.updated_at = now_ms();
    let tx = Atomic::begin(conn)?;
    insert(&tx, &t, None)?;
    tx.commit()?;
    Ok(t)
}

/// Elimina todas las tareas completadas. Devuelve cuántas.
pub fn delete_completed(conn: &Connection) -> Result<usize> {
    Ok(conn.execute("DELETE FROM tasks WHERE completed_at IS NOT NULL", [])?)
}

/// Tareas pendientes con vencimiento en `[from, to)` y algún recordatorio.
pub(crate) fn pending_with_reminders(conn: &Connection, from: i64, to: i64) -> Result<Vec<Task>> {
    let mut stmt = conn.prepare_cached(&format!(
        "SELECT {COLUMNS} FROM tasks t
         WHERE completed_at IS NULL AND due_at IS NOT NULL AND due_at >= ?1 AND due_at < ?2
           AND EXISTS (SELECT 1 FROM event_reminders r WHERE r.task_id = t.id)"
    ))?;
    let mut out = stmt
        .query_map(params![from, to], from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    attach(conn, &mut out)?;
    Ok(out)
}

/// Tareas para exportar, con su UID de iCalendar si se importaron.
pub(crate) fn export_rows(
    conn: &Connection,
    calendar_ids: Option<&[String]>,
    from: Option<i64>,
    to: Option<i64>,
) -> Result<Vec<(Task, Option<String>)>> {
    let cals = calendar_ids.map(serde_json::to_string).transpose()?;
    let ranged = from.is_some() || to.is_some();
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS}, ical_uid FROM tasks
         WHERE (?1 IS NULL OR calendar_id IN (SELECT value FROM json_each(?1)))
           AND (?2 = 0 OR (due_at IS NOT NULL AND due_at >= ?3 AND due_at < ?4))
         ORDER BY due_at IS NULL, due_at, sort_order"
    ))?;
    let rows = stmt.query_map(
        params![
            cals,
            ranged as i64,
            from.unwrap_or(i64::MIN),
            to.unwrap_or(i64::MAX)
        ],
        |r| Ok((from_row(r)?, r.get::<_, Option<String>>(11)?)),
    )?;
    let mut out = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    let mut tasks: Vec<Task> = out.iter().map(|(t, _)| t.clone()).collect();
    attach(conn, &mut tasks)?;
    for ((t, _), full) in out.iter_mut().zip(tasks) {
        *t = full;
    }
    Ok(out)
}

/// UIDs de iCalendar de las tareas existentes.
pub(crate) fn existing_uids(conn: &Connection) -> Result<std::collections::HashSet<String>> {
    let mut stmt = conn.prepare("SELECT ical_uid FROM tasks WHERE ical_uid IS NOT NULL")?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::migrate;
    use crate::models::event::DAY_MS;
    use crate::models::NewCalendar;

    const H: i64 = 3_600_000;

    fn db() -> (Connection, String) {
        let mut c = Connection::open_in_memory().unwrap();
        c.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate(&mut c).unwrap();
        let cal = calendars::create(
            &c,
            &NewCalendar {
                name: "A".into(),
                color: "#112233".into(),
                description: None,
            },
        )
        .unwrap();
        (c, cal.id)
    }

    fn new(title: &str, due: Option<i64>) -> NewTask {
        NewTask {
            title: title.into(),
            due_at: due,
            ..Default::default()
        }
    }

    #[test]
    fn crud_complete_and_order() {
        let (c, cal) = db();
        let late = create(&c, &new("Tarde", Some(20 * DAY_MS + 18 * H))).unwrap();
        let early = create(&c, &new("  Pronto  ", Some(20 * DAY_MS + 9 * H))).unwrap();
        let undated = create(&c, &new("Sin fecha", None)).unwrap();
        assert_eq!(early.title, "Pronto");
        let order: Vec<String> = list(&c).unwrap().into_iter().map(|t| t.title).collect();
        assert_eq!(order, ["Pronto", "Tarde", "Sin fecha"]);

        // Completar la mueve al final; desmarcar la devuelve.
        let done = update(
            &c,
            &early.id,
            &TaskPatch {
                completed: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(done.completed_at.is_some());
        assert_eq!(list(&c).unwrap().last().unwrap().id, early.id);
        let reopened = update(
            &c,
            &early.id,
            &TaskPatch {
                completed: Some(false),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(reopened.completed_at.is_none());

        // Cambios: calendario, prioridad, notas; quitar la fecha borra los recordatorios.
        let t = update(
            &c,
            &late.id,
            &TaskPatch {
                calendar_id: Some(Some(cal.clone())),
                priority: Some(3),
                notes: Some("detalles".into()),
                reminders: Some(vec![30, 10, 30]),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!((t.priority, t.reminders.clone()), (3, vec![10, 30]));
        assert_eq!(t.calendar_id.as_deref(), Some(cal.as_str()));
        let t = update(
            &c,
            &late.id,
            &TaskPatch {
                due_at: Some(None),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(t.due_at.is_none() && t.reminders.is_empty());

        // Eliminar y deshacer conserva id y datos.
        let removed = delete(&c, &undated.id).unwrap();
        assert!(matches!(get(&c, &undated.id), Err(CoreError::NotFound(_))));
        restore(&c, &removed).unwrap();
        assert_eq!(get(&c, &undated.id).unwrap().title, "Sin fecha");

        // Borrar un calendario deja la tarea sin calendario (no la borra).
        c.execute("DELETE FROM calendars WHERE id = ?1", [&cal])
            .unwrap();
        assert!(get(&c, &late.id).unwrap().calendar_id.is_none());

        // Limpiar completadas.
        update(
            &c,
            &early.id,
            &TaskPatch {
                completed: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(delete_completed(&c).unwrap(), 1);
        assert_eq!(list(&c).unwrap().len(), 2);
    }

    #[test]
    fn validation() {
        let (c, _) = db();
        assert!(create(&c, &new("   ", None)).is_err());
        let mut bad = new("x", Some(20 * DAY_MS + H));
        bad.is_all_day = true;
        assert!(create(&c, &bad).is_err(), "día completo con hora");
        let mut bad = new("x", None);
        bad.priority = 4;
        assert!(create(&c, &bad).is_err());
        let mut bad = new("x", None);
        bad.calendar_id = Some("no-existe".into());
        assert!(create(&c, &bad).is_err());
        assert!(create(&c, &new("x", Some(i64::MAX))).is_err());
        // Sin fecha, los recordatorios se descartan.
        let mut t = new("x", None);
        t.reminders = vec![10];
        assert!(create(&c, &t).unwrap().reminders.is_empty());
    }

    #[test]
    fn patch_distinguishes_null_from_absent() {
        let p: TaskPatch = serde_json::from_str(r#"{"dueAt": null}"#).unwrap();
        assert_eq!(p.due_at, Some(None));
        let p: TaskPatch = serde_json::from_str(r#"{"title": "a"}"#).unwrap();
        assert_eq!(p.due_at, None);
        let p: TaskPatch = serde_json::from_str(r#"{"dueAt": 5}"#).unwrap();
        assert_eq!(p.due_at, Some(Some(5)));
    }
}
