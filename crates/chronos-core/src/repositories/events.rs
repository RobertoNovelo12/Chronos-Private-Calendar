//! Persistencia de eventos, series recurrentes y recordatorios.
//!
//! Tipos de fila en `events`:
//! * **Simple**: `is_recurring = 0`, sin `recurrence_master_id`.
//! * **Serie (maestra)**: `is_recurring = 1` + fila en `event_recurrences`.
//!   Nunca se envía tal cual al frontend: se expande en ocurrencias.
//! * **Excepción modificada**: `recurrence_master_id` + `original_start_at`;
//!   sustituye a una ocurrencia concreta (también hay una fila en `event_exceptions`).
//!
//! Las ocurrencias generadas tienen id `serie@inicio_original_ms`.

use crate::database::{now_ms, Atomic};
use crate::error::{CoreError, Result};
use crate::models::event::*;
use crate::recurrence::{self, instance_id, parse_instance_id};
use crate::repositories::calendars;
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

const SELECT: &str = "SELECT e.id, e.calendar_id, e.title, e.description, e.location, e.links_json, e.color, \
     e.start_at, e.end_at, e.timezone, e.is_all_day, e.visibility, e.availability, e.status, e.is_recurring, \
     e.recurrence_master_id, e.original_start_at, r.rrule, e.created_at, e.updated_at \
     FROM events e LEFT JOIN event_recurrences r ON r.event_id = COALESCE(e.recurrence_master_id, e.id)";

fn from_row(r: &Row<'_>) -> rusqlite::Result<Event> {
    let links_json: String = r.get(5)?;
    let to_sql_err = |i: usize, e: CoreError| {
        rusqlite::Error::FromSqlConversionFailure(i, rusqlite::types::Type::Text, Box::new(e))
    };
    let master: Option<String> = r.get(15)?;
    Ok(Event {
        id: r.get(0)?,
        calendar_id: r.get(1)?,
        title: r.get(2)?,
        description: r.get(3)?,
        location: r.get(4)?,
        links: serde_json::from_str(&links_json).unwrap_or_default(),
        color: r.get(6)?,
        start_at: r.get(7)?,
        end_at: r.get(8)?,
        timezone: r.get(9)?,
        is_all_day: r.get::<_, i64>(10)? != 0,
        visibility: Visibility::parse(&r.get::<_, String>(11)?).map_err(|e| to_sql_err(11, e))?,
        availability: Availability::parse(&r.get::<_, String>(12)?)
            .map_err(|e| to_sql_err(12, e))?,
        status: EventStatus::parse(&r.get::<_, String>(13)?).map_err(|e| to_sql_err(13, e))?,
        is_recurring: r.get::<_, i64>(14)? != 0 || master.is_some(),
        recurrence_master_id: master,
        original_start_at: r.get(16)?,
        recurrence: r.get(17)?,
        reminders: Vec::new(),
        created_at: r.get(18)?,
        updated_at: r.get(19)?,
    })
}

/// Fila tal cual está en la base de datos (sin expandir).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum RowKind {
    Simple,
    Master,
    Override,
}

fn kind(e: &Event) -> RowKind {
    if e.recurrence_master_id.is_some() {
        RowKind::Override
    } else if e.is_recurring {
        RowKind::Master
    } else {
        RowKind::Simple
    }
}

fn normalize_color_opt(color: Option<&str>) -> Result<Option<String>> {
    match color.map(str::trim) {
        None | Some("") => Ok(None),
        Some(c) => Ok(Some(crate::models::calendar::normalize_color(c)?)),
    }
}

/// Valida todos los campos y devuelve el evento normalizado.
fn validate(mut e: Event) -> Result<Event> {
    e.title = normalize_title(&e.title)?;
    validate_description(&e.description)?;
    e.location = normalize_location(&e.location)?;
    e.links = normalize_links(&e.links)?;
    e.color = normalize_color_opt(e.color.as_deref())?;
    e.timezone = normalize_timezone(&e.timezone)?;
    e.reminders = normalize_reminders(&e.reminders)?;
    validate_times(e.start_at, e.end_at, e.is_all_day)?;
    Ok(e)
}

// ---------------------------------------------------------------------------
// Acceso a filas
// ---------------------------------------------------------------------------

fn get_row(conn: &Connection, id: &str) -> Result<Event> {
    let mut e = conn
        .query_row(&format!("{SELECT} WHERE e.id = ?1"), [id], from_row)
        .optional()?
        .ok_or(CoreError::NotFound("evento"))?;
    e.reminders = reminders_of(conn, id)?;
    Ok(e)
}

fn reminders_of(conn: &Connection, event_id: &str) -> Result<Vec<i32>> {
    let mut stmt = conn.prepare_cached(
        "SELECT offset_minutes FROM event_reminders WHERE event_id = ?1 ORDER BY offset_minutes",
    )?;
    let rows = stmt.query_map([event_id], |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<Vec<i32>>>()?)
}

fn reminders_for(conn: &Connection, ids: &[String]) -> Result<HashMap<String, Vec<i32>>> {
    let mut map: HashMap<String, Vec<i32>> = HashMap::new();
    if ids.is_empty() {
        return Ok(map);
    }
    let mut stmt = conn.prepare_cached(
        "SELECT event_id, offset_minutes FROM event_reminders
         WHERE event_id IN (SELECT value FROM json_each(?1)) ORDER BY offset_minutes",
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

fn set_reminders(conn: &Connection, event_id: &str, reminders: &[i32]) -> Result<()> {
    conn.execute(
        "DELETE FROM event_reminders WHERE event_id = ?1",
        [event_id],
    )?;
    let now = now_ms();
    let mut stmt = conn.prepare_cached(
        "INSERT INTO event_reminders (id, event_id, offset_minutes, method, created_at) VALUES (?1, ?2, ?3, 'notification', ?4)",
    )?;
    for m in reminders {
        stmt.execute(params![Uuid::new_v4().to_string(), event_id, m, now])?;
    }
    Ok(())
}

fn exceptions_of(conn: &Connection, master_id: &str) -> Result<HashSet<i64>> {
    let mut stmt =
        conn.prepare_cached("SELECT original_start_at FROM event_exceptions WHERE event_id = ?1")?;
    let rows = stmt.query_map([master_id], |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<HashSet<i64>>>()?)
}

/// Inserta una fila completa. `series_until` solo aplica a series.
fn insert_row(
    conn: &Connection,
    e: &Event,
    master_row: bool,
    series_until: Option<i64>,
) -> Result<()> {
    calendars::get(conn, &e.calendar_id)?;
    conn.execute(
        "INSERT INTO events (id, calendar_id, title, description, location, links_json, color, start_at, end_at,
            timezone, is_all_day, visibility, availability, status, is_recurring, series_until_at,
            recurrence_master_id, original_start_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)",
        params![
            e.id,
            e.calendar_id,
            e.title,
            e.description,
            e.location,
            serde_json::to_string(&e.links)?,
            e.color,
            e.start_at,
            e.end_at,
            e.timezone,
            e.is_all_day as i64,
            e.visibility.as_str(),
            e.availability.as_str(),
            e.status.as_str(),
            master_row as i64,
            series_until,
            e.recurrence_master_id,
            e.original_start_at,
            e.created_at,
            e.updated_at
        ],
    )?;
    set_reminders(conn, &e.id, &e.reminders)?;
    Ok(())
}

fn write_row(
    conn: &Connection,
    e: &Event,
    master_row: bool,
    series_until: Option<i64>,
) -> Result<()> {
    calendars::get(conn, &e.calendar_id)?;
    conn.execute(
        "UPDATE events SET calendar_id = ?2, title = ?3, description = ?4, location = ?5, links_json = ?6,
                color = ?7, start_at = ?8, end_at = ?9, timezone = ?10, is_all_day = ?11, visibility = ?12,
                availability = ?13, status = ?14, is_recurring = ?15, series_until_at = ?16, updated_at = ?17
         WHERE id = ?1",
        params![
            e.id,
            e.calendar_id,
            e.title,
            e.description,
            e.location,
            serde_json::to_string(&e.links)?,
            e.color,
            e.start_at,
            e.end_at,
            e.timezone,
            e.is_all_day as i64,
            e.visibility.as_str(),
            e.availability.as_str(),
            e.status.as_str(),
            master_row as i64,
            series_until,
            now_ms()
        ],
    )?;
    set_reminders(conn, &e.id, &e.reminders)?;
    Ok(())
}

fn set_ical_uid(conn: &Connection, event_id: &str, uid: &str) -> Result<()> {
    conn.execute("UPDATE events SET ical_uid = ?2 WHERE id = ?1", params![event_id, uid])?;
    Ok(())
}

fn set_rule(conn: &Connection, event_id: &str, rule: &str) -> Result<()> {
    let now = now_ms();
    conn.execute(
        "INSERT INTO event_recurrences (event_id, rrule, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT(event_id) DO UPDATE SET rrule = excluded.rrule, updated_at = excluded.updated_at",
        params![event_id, rule, now],
    )?;
    Ok(())
}

/// Elimina excepciones y excepciones modificadas de una serie a partir de `from`.
fn clear_exceptions_from(conn: &Connection, master_id: &str, from: i64) -> Result<()> {
    conn.execute(
        "DELETE FROM events WHERE recurrence_master_id = ?1 AND original_start_at >= ?2",
        params![master_id, from],
    )?;
    conn.execute(
        "DELETE FROM event_exceptions WHERE event_id = ?1 AND original_start_at >= ?2",
        params![master_id, from],
    )?;
    Ok(())
}

fn master_rule(m: &Event) -> Result<&str> {
    m.recurrence
        .as_deref()
        .ok_or(CoreError::NotFound("regla de repetición"))
}

/// Ocurrencia generada de una serie.
fn instance(master: &Event, t: i64) -> Event {
    let duration = master.end_at - master.start_at;
    Event {
        id: instance_id(&master.id, t),
        start_at: t,
        end_at: t + duration,
        is_recurring: true,
        recurrence_master_id: Some(master.id.clone()),
        original_start_at: Some(t),
        ..master.clone()
    }
}

/// Resuelve un id del frontend: fila real u ocurrencia generada.
// Valor efímero (vive durante una operación): no compensa encajonarlo.
#[allow(clippy::large_enum_variant)]
enum Target {
    Simple(Event),
    Override(Event),
    /// Serie maestra + inicio original + evento tal como se muestra.
    Instance {
        master: Event,
        t: i64,
        shown: Event,
    },
}

fn resolve(conn: &Connection, id: &str) -> Result<Target> {
    if let Some((master_id, t)) = parse_instance_id(id) {
        let master = get_row(conn, master_id)?;
        if kind(&master) != RowKind::Master {
            return Err(CoreError::NotFound("serie"));
        }
        let rule = master_rule(&master)?.to_string();
        if !recurrence::is_occurrence(&master, &rule, t)?
            || exceptions_of(conn, master_id)?.contains(&t)
        {
            return Err(CoreError::NotFound("ocurrencia"));
        }
        let shown = instance(&master, t);
        return Ok(Target::Instance { master, t, shown });
    }
    let row = get_row(conn, id)?;
    Ok(match kind(&row) {
        RowKind::Simple => Target::Simple(row),
        RowKind::Override => Target::Override(row),
        RowKind::Master => {
            let t = row.start_at;
            let shown = instance(&row, t);
            Target::Instance {
                master: row,
                t,
                shown,
            }
        }
    })
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/// Evento u ocurrencia por id.
pub fn get(conn: &Connection, id: &str) -> Result<Event> {
    Ok(match resolve(conn, id)? {
        Target::Simple(e) | Target::Override(e) => e,
        Target::Instance { shown, .. } => shown,
    })
}

pub fn create(conn: &Connection, input: &NewEvent) -> Result<Event> {
    let now = now_ms();
    let rule = match input.recurrence.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(r) => Some(recurrence::validate_rule(r)?),
    };
    let mut event = validate(Event {
        id: Uuid::new_v4().to_string(),
        calendar_id: input.calendar_id.clone(),
        title: input.title.clone(),
        description: input.description.clone(),
        location: input.location.clone(),
        links: input.links.clone(),
        color: input.color.clone(),
        start_at: input.start_at,
        end_at: input.end_at,
        timezone: input.timezone.clone(),
        is_all_day: input.is_all_day,
        visibility: input.visibility.unwrap_or(Visibility::Default),
        availability: input.availability.unwrap_or(Availability::Busy),
        status: EventStatus::Confirmed,
        is_recurring: rule.is_some(),
        recurrence_master_id: None,
        original_start_at: None,
        recurrence: rule.clone(),
        reminders: input.reminders.clone(),
        created_at: now,
        updated_at: now,
    })?;
    let tx = Atomic::begin(conn)?;
    let until = match &rule {
        Some(r) => recurrence::series_end(&event, r)?,
        None => None,
    };
    insert_row(&tx, &event, rule.is_some(), until)?;
    if let Some(r) = &rule {
        set_rule(&tx, &event.id, r)?;
    }
    if let Some(uid) = input.ical_uid.as_deref().map(str::trim).filter(|u| !u.is_empty()) {
        set_ical_uid(&tx, &event.id, &uid.chars().take(500).collect::<String>())?;
    }
    tx.commit()?;
    tracing::debug!(event_id = %event.id, recurring = rule.is_some(), "evento creado");
    if rule.is_some() {
        // Se devuelve la primera ocurrencia, que es lo que muestra el frontend.
        let t = event.start_at;
        event = instance(&event, t);
    }
    Ok(event)
}

/// Aplica los campos del patch (sin regla ni horas) a un evento.
fn apply_fields(e: &mut Event, patch: &EventPatch) -> Result<()> {
    if let Some(v) = &patch.calendar_id {
        e.calendar_id = v.clone();
    }
    if let Some(v) = &patch.title {
        e.title = v.clone();
    }
    if let Some(v) = &patch.description {
        e.description = v.clone();
    }
    if let Some(v) = &patch.location {
        e.location = v.clone();
    }
    if let Some(v) = &patch.links {
        e.links = v.clone();
    }
    if let Some(v) = &patch.color {
        e.color = Some(v.clone());
    }
    if let Some(v) = &patch.timezone {
        e.timezone = v.clone();
    }
    if let Some(v) = patch.visibility {
        e.visibility = v;
    }
    if let Some(v) = patch.availability {
        e.availability = v;
    }
    if let Some(v) = patch.status {
        e.status = v;
    }
    if let Some(v) = &patch.reminders {
        e.reminders = v.clone();
    }
    Ok(())
}

fn apply_times(e: &mut Event, patch: &EventPatch) {
    if let Some(v) = patch.start_at {
        e.start_at = v;
    }
    if let Some(v) = patch.end_at {
        e.end_at = v;
    }
    if let Some(v) = patch.is_all_day {
        e.is_all_day = v;
    }
}

/// Desplaza la serie igual que el usuario desplazó la ocurrencia mostrada.
fn shift_series_times(master: &mut Event, shown: &Event, patch: &EventPatch) {
    if !patch.touches_times() {
        return;
    }
    let new_start = patch.start_at.unwrap_or(shown.start_at);
    let new_end = patch
        .end_at
        .unwrap_or(shown.end_at + (new_start - shown.start_at));
    let all_day = patch.is_all_day.unwrap_or(master.is_all_day);
    let mut start = master.start_at + (new_start - shown.start_at);
    if all_day {
        start = start.div_euclid(DAY_MS) * DAY_MS;
    }
    master.start_at = start;
    master.end_at = start + (new_end - new_start).max(0);
    master.is_all_day = all_day;
}

pub fn update(conn: &Connection, id: &str, patch: &EventPatch, scope: EditScope) -> Result<Event> {
    let tx = Atomic::begin(conn)?;
    let result = match resolve(&tx, id)? {
        Target::Simple(e) => update_simple(&tx, e, patch)?,
        Target::Override(e) if scope == EditScope::This => {
            if patch.recurrence.is_some() {
                return Err(CoreError::Validation(
                    "para cambiar la repetición aplica el cambio a todos los eventos de la serie"
                        .into(),
                ));
            }
            let mut e = e;
            apply_fields(&mut e, patch)?;
            apply_times(&mut e, patch);
            let e = validate(e)?;
            write_row(&tx, &e, false, None)?;
            get_row(&tx, &e.id)?
        }
        Target::Override(e) => {
            let master_id = e
                .recurrence_master_id
                .clone()
                .ok_or(CoreError::NotFound("serie"))?;
            let master = get_row(&tx, &master_id)?;
            let t = e.original_start_at.unwrap_or(e.start_at);
            update_series(&tx, master, t, &e, patch, scope)?
        }
        Target::Instance { master, t, shown } => {
            update_series(&tx, master, t, &shown, patch, scope)?
        }
    };
    tx.commit()?;
    Ok(result)
}

fn update_simple(conn: &Connection, mut e: Event, patch: &EventPatch) -> Result<Event> {
    apply_fields(&mut e, patch)?;
    apply_times(&mut e, patch);
    let e = validate(e)?;
    match patch.recurrence.as_deref().map(str::trim) {
        Some(r) if !r.is_empty() => {
            // Un evento simple se convierte en serie.
            let rule = recurrence::validate_rule(r)?;
            let until = recurrence::series_end(&e, &rule)?;
            write_row(conn, &e, true, until)?;
            set_rule(conn, &e.id, &rule)?;
            let master = get_row(conn, &e.id)?;
            let t = master.start_at;
            Ok(instance(&master, t))
        }
        _ => {
            write_row(conn, &e, false, None)?;
            get_row(conn, &e.id)
        }
    }
}

fn update_series(
    conn: &Connection,
    master: Event,
    t: i64,
    shown: &Event,
    patch: &EventPatch,
    scope: EditScope,
) -> Result<Event> {
    let old_rule = master_rule(&master)?.to_string();
    let scope = if scope == EditScope::Following && t <= master.start_at {
        EditScope::All
    } else {
        scope
    };

    match scope {
        EditScope::This => {
            if patch.recurrence.is_some() {
                return Err(CoreError::Validation(
                    "para cambiar la repetición aplica el cambio a todos los eventos o a los siguientes".into(),
                ));
            }
            // Se crea una excepción modificada que sustituye a esta ocurrencia.
            let now = now_ms();
            let mut ov = Event {
                id: Uuid::new_v4().to_string(),
                is_recurring: false,
                recurrence_master_id: Some(master.id.clone()),
                original_start_at: Some(t),
                recurrence: None,
                created_at: now,
                updated_at: now,
                ..shown.clone()
            };
            apply_fields(&mut ov, patch)?;
            apply_times(&mut ov, patch);
            let ov = validate(ov)?;
            insert_row(conn, &ov, false, None)?;
            conn.execute(
                "INSERT INTO event_exceptions (id, event_id, original_start_at, kind, override_event_id, created_at)
                 VALUES (?1, ?2, ?3, 'modified', ?4, ?5)",
                params![Uuid::new_v4().to_string(), master.id, t, ov.id, now],
            )?;
            get_row(conn, &ov.id)
        }
        EditScope::All => {
            let mut m = master.clone();
            apply_fields(&mut m, patch)?;
            shift_series_times(&mut m, shown, patch);
            let m = validate(m)?;
            match patch.recurrence.as_deref().map(str::trim) {
                Some("") => {
                    // Quitar la repetición: queda un evento simple con los datos de la serie.
                    clear_exceptions_from(conn, &m.id, i64::MIN)?;
                    conn.execute("DELETE FROM event_recurrences WHERE event_id = ?1", [&m.id])?;
                    write_row(conn, &m, false, None)?;
                    get_row(conn, &m.id)
                }
                other => {
                    let rule = match other {
                        Some(r) => recurrence::validate_rule(r)?,
                        None => old_rule.clone(),
                    };
                    // Si cambian las horas o la regla, las excepciones dejan de corresponder.
                    if patch.touches_times() || rule != old_rule {
                        clear_exceptions_from(conn, &m.id, i64::MIN)?;
                    }
                    let until = recurrence::series_end(&m, &rule)?;
                    write_row(conn, &m, true, until)?;
                    set_rule(conn, &m.id, &rule)?;
                    let saved = get_row(conn, &m.id)?;
                    let first = saved.start_at;
                    Ok(instance(&saved, first))
                }
            }
        }
        EditScope::Following => {
            // 1. La serie original termina justo antes de esta ocurrencia.
            let already = recurrence::count_before(&master, &old_rule, t)?;
            let cut = recurrence::rule_ending_before(&old_rule, t)?;
            clear_exceptions_from(conn, &master.id, t)?;
            let until = recurrence::series_end(&master, &cut)?;
            write_row(conn, &master, true, until)?;
            set_rule(conn, &master.id, &cut)?;

            // 2. Nueva serie desde esta ocurrencia con los cambios.
            let now = now_ms();
            let mut n = Event {
                id: Uuid::new_v4().to_string(),
                start_at: t,
                end_at: t + (master.end_at - master.start_at),
                recurrence_master_id: None,
                original_start_at: None,
                created_at: now,
                updated_at: now,
                ..master.clone()
            };
            let shown_new = instance(&n, t);
            apply_fields(&mut n, patch)?;
            shift_series_times(&mut n, &shown_new, patch);
            let n = validate(n)?;
            match patch.recurrence.as_deref().map(str::trim) {
                Some("") => {
                    insert_row(
                        conn,
                        &Event {
                            is_recurring: false,
                            recurrence: None,
                            ..n.clone()
                        },
                        false,
                        None,
                    )?;
                    get_row(conn, &n.id)
                }
                other => {
                    let rule = match other {
                        Some(r) => recurrence::validate_rule(r)?,
                        None => recurrence::rule_with_remaining_count(&old_rule, already),
                    };
                    let until = recurrence::series_end(&n, &rule)?;
                    insert_row(conn, &n, true, until)?;
                    set_rule(conn, &n.id, &rule)?;
                    let saved = get_row(conn, &n.id)?;
                    let first = saved.start_at;
                    Ok(instance(&saved, first))
                }
            }
        }
    }
}

/// Elimina según el alcance y devuelve lo que se mostraba (para deshacer en eventos simples).
pub fn delete(conn: &Connection, id: &str, scope: EditScope) -> Result<Event> {
    let tx = Atomic::begin(conn)?;
    let shown = match resolve(&tx, id)? {
        Target::Simple(e) => {
            tx.execute("DELETE FROM events WHERE id = ?1", [&e.id])?;
            e
        }
        Target::Override(e) if scope == EditScope::This => {
            // La excepción pasa a ser una cancelación; después se borra la fila.
            tx.execute(
                "UPDATE event_exceptions SET kind = 'cancelled', override_event_id = NULL WHERE override_event_id = ?1",
                [&e.id],
            )?;
            tx.execute("DELETE FROM events WHERE id = ?1", [&e.id])?;
            e
        }
        Target::Override(e) => {
            let master_id = e
                .recurrence_master_id
                .clone()
                .ok_or(CoreError::NotFound("serie"))?;
            let master = get_row(&tx, &master_id)?;
            delete_series(
                &tx,
                &master,
                e.original_start_at.unwrap_or(e.start_at),
                scope,
            )?;
            e
        }
        Target::Instance { master, t, shown } => {
            if scope == EditScope::This {
                tx.execute(
                    "INSERT INTO event_exceptions (id, event_id, original_start_at, kind, override_event_id, created_at)
                     VALUES (?1, ?2, ?3, 'cancelled', NULL, ?4)",
                    params![Uuid::new_v4().to_string(), master.id, t, now_ms()],
                )?;
            } else {
                delete_series(&tx, &master, t, scope)?;
            }
            shown
        }
    };
    tx.commit()?;
    tracing::debug!(scope = ?scope, "evento eliminado");
    Ok(shown)
}

fn delete_series(conn: &Connection, master: &Event, t: i64, scope: EditScope) -> Result<()> {
    if scope == EditScope::All || t <= master.start_at {
        conn.execute("DELETE FROM events WHERE id = ?1", [&master.id])?;
        return Ok(());
    }
    let cut = recurrence::rule_ending_before(master_rule(master)?, t)?;
    clear_exceptions_from(conn, &master.id, t)?;
    let until = recurrence::series_end(master, &cut)?;
    write_row(conn, master, true, until)?;
    set_rule(conn, &master.id, &cut)
}

/// Vuelve a insertar un evento simple eliminado con su mismo id (deshacer).
pub fn restore(conn: &Connection, event: &Event) -> Result<Event> {
    if event.is_recurring || event.recurrence_master_id.is_some() || event.recurrence.is_some() {
        return Err(CoreError::Validation(
            "deshacer no está disponible para eventos repetidos".into(),
        ));
    }
    Uuid::parse_str(&event.id)
        .map_err(|_| CoreError::Validation("identificador no válido".into()))?;
    let mut e = validate(event.clone())?;
    e.updated_at = now_ms();
    let tx = Atomic::begin(conn)?;
    insert_row(&tx, &e, false, None)?;
    tx.commit()?;
    Ok(e)
}

/// Duplica lo que se muestra como un evento simple nuevo.
pub fn duplicate(conn: &Connection, id: &str) -> Result<Event> {
    let src = get(conn, id)?;
    let now = now_ms();
    let copy = Event {
        id: Uuid::new_v4().to_string(),
        is_recurring: false,
        recurrence_master_id: None,
        original_start_at: None,
        recurrence: None,
        created_at: now,
        updated_at: now,
        ..src
    };
    let tx = Atomic::begin(conn)?;
    insert_row(&tx, &copy, false, None)?;
    tx.commit()?;
    Ok(copy)
}

/// Eventos y ocurrencias que se solapan con `[from, to)`.
pub fn list_range(conn: &Connection, from: i64, to: i64) -> Result<Vec<Event>> {
    if to <= from || to - from > MAX_RANGE_MS {
        return Err(CoreError::Validation("rango de fechas no válido".into()));
    }
    let mut out = Vec::new();
    {
        let mut stmt = conn.prepare_cached(&format!(
            "{SELECT} WHERE e.is_recurring = 0 AND e.start_at < ?2
               AND (e.end_at > ?1 OR (e.end_at = e.start_at AND e.start_at >= ?1))"
        ))?;
        let rows = stmt.query_map(params![from, to], from_row)?;
        for r in rows {
            out.push(r?);
        }
    }
    let masters: Vec<Event> = {
        let mut stmt = conn.prepare_cached(&format!(
            "{SELECT} WHERE e.is_recurring = 1 AND e.start_at < ?2
               AND (e.series_until_at IS NULL OR e.series_until_at > ?1)"
        ))?;
        let rows = stmt.query_map(params![from, to], from_row)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    let mut ids: Vec<String> = out.iter().map(|e| e.id.clone()).collect();
    ids.extend(masters.iter().map(|m| m.id.clone()));
    let reminders = reminders_for(conn, &ids)?;
    for e in out.iter_mut() {
        e.reminders = reminders.get(&e.id).cloned().unwrap_or_default();
    }
    for mut m in masters {
        let Some(rule) = m.recurrence.clone() else {
            continue;
        };
        m.reminders = reminders.get(&m.id).cloned().unwrap_or_default();
        let skip = exceptions_of(conn, &m.id)?;
        for t in recurrence::occurrences(&m, &rule, from, to)? {
            if !skip.contains(&t) {
                out.push(instance(&m, t));
            }
        }
    }
    out.sort_by(|a, b| {
        a.start_at
            .cmp(&b.start_at)
            .then(b.end_at.cmp(&a.end_at))
            .then(a.id.cmp(&b.id))
    });
    Ok(out)
}

/// Búsqueda por texto en título, ubicación y descripción. Las series aparecen
/// una vez (como su primera ocurrencia).
pub fn search(conn: &Connection, query: &str, limit: u32) -> Result<Vec<Event>> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    if q.chars().count() > 200 {
        return Err(CoreError::Validation("búsqueda demasiado larga".into()));
    }
    let escaped = q
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    let pattern = format!("%{escaped}%");
    let mut stmt = conn.prepare_cached(&format!(
        "{SELECT} WHERE e.title LIKE ?1 ESCAPE '\\' OR e.location LIKE ?1 ESCAPE '\\' OR e.description LIKE ?1 ESCAPE '\\'
         ORDER BY e.start_at DESC LIMIT ?2"
    ))?;
    let rows = stmt.query_map(params![pattern, limit.min(200)], from_row)?;
    let mut out = Vec::new();
    for r in rows {
        let e = r?;
        out.push(if kind(&e) == RowKind::Master {
            let t = e.start_at;
            instance(&e, t)
        } else {
            e
        });
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Apoyo para importación y exportación
// ---------------------------------------------------------------------------

/// Fila exportable con su UID de iCalendar (si se importó).
pub(crate) struct ExportRow {
    pub event: Event,
    pub uid: Option<String>,
}

/// Filas reales (eventos simples, series y excepciones modificadas) filtradas
/// por calendario y rango. Las excepciones de cada serie incluida se añaden
/// siempre, para que la serie se exporte completa.
pub(crate) fn export_rows(
    conn: &Connection,
    calendar_ids: Option<&[String]>,
    from: Option<i64>,
    to: Option<i64>,
) -> Result<Vec<ExportRow>> {
    let from = from.unwrap_or(i64::MIN);
    let to = to.unwrap_or(i64::MAX);
    let cals = calendar_ids.map(serde_json::to_string).transpose()?;
    let sql = format!(
        "{SELECT_WITH_UID} WHERE (?1 IS NULL OR e.calendar_id IN (SELECT value FROM json_each(?1)))
           AND (
             (e.is_recurring = 0 AND e.recurrence_master_id IS NULL AND e.start_at < ?3
                AND (e.end_at > ?2 OR (e.end_at = e.start_at AND e.start_at >= ?2)))
             OR (e.is_recurring = 1 AND e.start_at < ?3 AND (e.series_until_at IS NULL OR e.series_until_at > ?2))
           )
         ORDER BY e.start_at"
    );
    let mut rows: Vec<ExportRow> = {
        let mut stmt = conn.prepare(&sql)?;
        let it = stmt.query_map(params![cals, from, to], |r| Ok(ExportRow { event: from_row(r)?, uid: r.get(20)? }))?;
        it.collect::<rusqlite::Result<Vec<_>>>()?
    };
    // Excepciones modificadas de las series incluidas.
    let masters: Vec<String> = rows.iter().filter(|r| kind(&r.event) == RowKind::Master).map(|r| r.event.id.clone()).collect();
    if !masters.is_empty() {
        let mut stmt = conn.prepare(&format!(
            "{SELECT_WITH_UID} WHERE e.recurrence_master_id IN (SELECT value FROM json_each(?1)) ORDER BY e.start_at"
        ))?;
        let it = stmt.query_map([serde_json::to_string(&masters)?], |r| Ok(ExportRow { event: from_row(r)?, uid: r.get(20)? }))?;
        for row in it {
            rows.push(row?);
        }
    }
    let ids: Vec<String> = rows.iter().map(|r| r.event.id.clone()).collect();
    let reminders = reminders_for(conn, &ids)?;
    for r in rows.iter_mut() {
        r.event.reminders = reminders.get(&r.event.id).cloned().unwrap_or_default();
    }
    Ok(rows)
}

const SELECT_WITH_UID: &str = "SELECT e.id, e.calendar_id, e.title, e.description, e.location, e.links_json, e.color, \
     e.start_at, e.end_at, e.timezone, e.is_all_day, e.visibility, e.availability, e.status, e.is_recurring, \
     e.recurrence_master_id, e.original_start_at, r.rrule, e.created_at, e.updated_at, e.ical_uid \
     FROM events e LEFT JOIN event_recurrences r ON r.event_id = COALESCE(e.recurrence_master_id, e.id)";

/// Inicios originales de las ocurrencias canceladas de una serie.
pub(crate) fn cancelled_exceptions(conn: &Connection, master_id: &str) -> Result<Vec<i64>> {
    let mut stmt = conn.prepare_cached(
        "SELECT original_start_at FROM event_exceptions WHERE event_id = ?1 AND kind = 'cancelled' ORDER BY original_start_at",
    )?;
    let rows = stmt.query_map([master_id], |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<Vec<i64>>>()?)
}

/// UID de iCalendar → id del evento, en un calendario.
pub(crate) fn uids_in_calendar(conn: &Connection, calendar_id: &str) -> Result<HashMap<String, String>> {
    let mut stmt = conn.prepare_cached("SELECT ical_uid, id FROM events WHERE calendar_id = ?1 AND ical_uid IS NOT NULL")?;
    let rows = stmt.query_map([calendar_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    Ok(rows.collect::<rusqlite::Result<HashMap<_, _>>>()?)
}

/// Cancela una ocurrencia (EXDATE). Devuelve `false` si no es una ocurrencia válida.
pub(crate) fn add_cancelled_exception(conn: &Connection, master_id: &str, t: i64) -> Result<bool> {
    let master = get_row(conn, master_id)?;
    let Some(rule) = master.recurrence.clone() else { return Ok(false) };
    if !recurrence::is_occurrence(&master, &rule, t)? || exceptions_of(conn, master_id)?.contains(&t) {
        return Ok(false);
    }
    conn.execute(
        "INSERT INTO event_exceptions (id, event_id, original_start_at, kind, override_event_id, created_at)
         VALUES (?1, ?2, ?3, 'cancelled', NULL, ?4)",
        params![Uuid::new_v4().to_string(), master_id, t, now_ms()],
    )?;
    Ok(true)
}

/// ¿Es `t` una ocurrencia libre (ni cancelada ni modificada) de la serie?
pub(crate) fn is_free_occurrence(conn: &Connection, master_id: &str, t: i64) -> Result<bool> {
    let master = get_row(conn, master_id)?;
    let Some(rule) = master.recurrence.clone() else { return Ok(false) };
    Ok(recurrence::is_occurrence(&master, &rule, t)? && !exceptions_of(conn, master_id)?.contains(&t))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::migrate;
    use crate::models::NewCalendar;

    const H: i64 = 3_600_000;

    fn setup() -> (Connection, String, String) {
        let mut c = Connection::open_in_memory().unwrap();
        c.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate(&mut c).unwrap();
        let a = calendars::create(
            &c,
            &NewCalendar {
                name: "A".into(),
                color: "#112233".into(),
                description: None,
            },
        )
        .unwrap();
        let b = calendars::create(
            &c,
            &NewCalendar {
                name: "B".into(),
                color: "#445566".into(),
                description: None,
            },
        )
        .unwrap();
        (c, a.id, b.id)
    }

    fn new(cal: &str, start: i64, end: i64) -> NewEvent {
        NewEvent {
            calendar_id: cal.into(),
            title: "  Reunión  ".into(),
            description: String::new(),
            location: String::new(),
            links: vec![],
            color: None,
            start_at: start,
            end_at: end,
            timezone: "UTC".into(),
            is_all_day: false,
            visibility: None,
            availability: None,
            recurrence: None,
            reminders: vec![],
            ical_uid: None,
        }
    }

    fn series(c: &Connection, cal: &str, rule: &str) -> Event {
        let mut n = new(cal, 9 * H, 10 * H);
        n.recurrence = Some(rule.into());
        n.reminders = vec![10];
        create(c, &n).unwrap()
    }

    fn starts(c: &Connection, from: i64, to: i64) -> Vec<i64> {
        list_range(c, from, to)
            .unwrap()
            .into_iter()
            .map(|e| e.start_at)
            .collect()
    }

    fn patch() -> EventPatch {
        EventPatch::default()
    }

    #[test]
    fn create_update_duplicate_delete_restore() {
        let (c, a, b) = setup();
        let mut input = new(&a, 10 * H, 11 * H);
        input.reminders = vec![30, 10, 30];
        let e = create(&c, &input).unwrap();
        assert_eq!(e.title, "Reunión");
        assert_eq!(e.reminders, vec![10, 30]);
        assert_eq!(get(&c, &e.id).unwrap(), e);

        let moved = update(
            &c,
            &e.id,
            &EventPatch {
                calendar_id: Some(b.clone()),
                start_at: Some(12 * H),
                end_at: Some(14 * H),
                color: Some("#ABCDEF".into()),
                reminders: Some(vec![]),
                links: Some(vec![EventLink {
                    label: "Doc".into(),
                    url: "https://ejemplo.org/x".into(),
                }]),
                ..patch()
            },
            EditScope::This,
        )
        .unwrap();
        assert_eq!(moved.calendar_id, b);
        assert_eq!(moved.color.as_deref(), Some("#abcdef"));
        assert!(moved.reminders.is_empty());
        let cleared = update(
            &c,
            &e.id,
            &EventPatch {
                color: Some(String::new()),
                ..patch()
            },
            EditScope::This,
        )
        .unwrap();
        assert_eq!(cleared.color, None);

        let dup = duplicate(&c, &e.id).unwrap();
        assert_ne!(dup.id, e.id);

        let removed = delete(&c, &e.id, EditScope::This).unwrap();
        assert!(matches!(get(&c, &e.id), Err(CoreError::NotFound(_))));
        let back = restore(&c, &removed).unwrap();
        assert_eq!(back.id, e.id);
        assert!(
            restore(&c, &removed).is_err(),
            "no se puede restaurar dos veces"
        );
    }

    #[test]
    fn validation_rules() {
        let (c, a, _) = setup();
        assert!(create(&c, &new(&a, 10 * H, 9 * H)).is_err());
        assert!(matches!(
            create(&c, &new("nope", H, 2 * H)),
            Err(CoreError::NotFound(_))
        ));
        let mut bad_tz = new(&a, H, 2 * H);
        bad_tz.timezone = "Marte/Olympus".into();
        assert!(create(&c, &bad_tz).is_err());
        let mut bad_link = new(&a, H, 2 * H);
        bad_link.links = vec![EventLink {
            label: String::new(),
            url: "javascript:alert(1)".into(),
        }];
        assert!(create(&c, &bad_link).is_err());
        let mut bad_rem = new(&a, H, 2 * H);
        bad_rem.reminders = vec![-5];
        assert!(create(&c, &bad_rem).is_err());
        let mut bad_rule = new(&a, H, 2 * H);
        bad_rule.recurrence = Some("FREQ=SECONDLY".into());
        assert!(create(&c, &bad_rule).is_err());
        let mut all_day = new(&a, DAY_MS * 3 + H, DAY_MS * 4);
        all_day.is_all_day = true;
        assert!(create(&c, &all_day).is_err());
        all_day.start_at = DAY_MS * 3;
        assert!(create(&c, &all_day).is_ok());
    }

    #[test]
    fn range_queries() {
        let (c, a, _) = setup();
        let inside = create(&c, &new(&a, 10 * H, 11 * H)).unwrap();
        let before = create(&c, &new(&a, 0, 9 * H)).unwrap();
        let instant = create(&c, &new(&a, 9 * H, 9 * H)).unwrap();
        let ids: Vec<String> = list_range(&c, 9 * H, 12 * H)
            .unwrap()
            .into_iter()
            .map(|e| e.id)
            .collect();
        assert!(ids.contains(&inside.id));
        assert!(ids.contains(&instant.id));
        assert!(!ids.contains(&before.id));
        assert!(list_range(&c, 10, 5).is_err());
    }

    #[test]
    fn series_expand_without_duplicating_rows() {
        let (c, a, _) = setup();
        let first = series(&c, &a, "FREQ=DAILY;COUNT=5");
        assert_eq!(
            first.id,
            instance_id(first.recurrence_master_id.as_ref().unwrap(), 9 * H)
        );
        assert_eq!(first.recurrence.as_deref(), Some("FREQ=DAILY;COUNT=5"));
        let n: i64 = c
            .query_row("SELECT count(*) FROM events", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1, "la serie se guarda una sola vez");
        let all = list_range(&c, 0, 10 * DAY_MS).unwrap();
        assert_eq!(all.len(), 5);
        assert!(all
            .iter()
            .all(|e| e.reminders == vec![10] && e.is_recurring));
        // Fuera del rango de la serie (terminada) no aparece.
        assert!(list_range(&c, 6 * DAY_MS, 9 * DAY_MS).unwrap().is_empty());
        assert_eq!(get(&c, &all[2].id).unwrap().start_at, 2 * DAY_MS + 9 * H);
        assert!(get(
            &c,
            &instance_id(all[0].recurrence_master_id.as_ref().unwrap(), 9 * H + 1)
        )
        .is_err());
    }

    #[test]
    fn edit_and_delete_this_occurrence() {
        let (c, a, _) = setup();
        let first = series(&c, &a, "FREQ=DAILY;COUNT=4");
        let master = first.recurrence_master_id.clone().unwrap();
        let day2 = instance_id(&master, DAY_MS + 9 * H);
        let day3 = instance_id(&master, 2 * DAY_MS + 9 * H);

        let ov = update(
            &c,
            &day2,
            &EventPatch {
                title: Some("Cambiada".into()),
                start_at: Some(DAY_MS + 15 * H),
                end_at: Some(DAY_MS + 16 * H),
                ..patch()
            },
            EditScope::This,
        )
        .unwrap();
        assert_eq!(ov.recurrence_master_id.as_deref(), Some(master.as_str()));
        assert_eq!(ov.original_start_at, Some(DAY_MS + 9 * H));
        assert!(ov.is_recurring);
        let list = list_range(&c, 0, 10 * DAY_MS).unwrap();
        assert_eq!(list.len(), 4);
        assert!(list
            .iter()
            .any(|e| e.title == "Cambiada" && e.start_at == DAY_MS + 15 * H));
        assert!(
            !list.iter().any(|e| e.start_at == DAY_MS + 9 * H),
            "la ocurrencia original queda sustituida"
        );

        // Editar de nuevo la excepción solo la modifica a ella.
        update(
            &c,
            &ov.id,
            &EventPatch {
                title: Some("Otra vez".into()),
                ..patch()
            },
            EditScope::This,
        )
        .unwrap();
        assert_eq!(get(&c, &ov.id).unwrap().title, "Otra vez");

        // Eliminar "solo esta" en una ocurrencia y en la excepción.
        delete(&c, &day3, EditScope::This).unwrap();
        delete(&c, &ov.id, EditScope::This).unwrap();
        assert_eq!(starts(&c, 0, 10 * DAY_MS), vec![9 * H, 3 * DAY_MS + 9 * H]);
        assert!(update(
            &c,
            &day3,
            &EventPatch {
                title: Some("x".into()),
                ..patch()
            },
            EditScope::This
        )
        .is_err());
    }

    #[test]
    fn edit_following_splits_series() {
        let (c, a, _) = setup();
        let first = series(&c, &a, "FREQ=DAILY;COUNT=6");
        let master = first.recurrence_master_id.clone().unwrap();
        let day3 = instance_id(&master, 2 * DAY_MS + 9 * H);
        let res = update(
            &c,
            &day3,
            &EventPatch {
                title: Some("Nueva etapa".into()),
                start_at: Some(2 * DAY_MS + 11 * H),
                end_at: Some(2 * DAY_MS + 12 * H),
                ..patch()
            },
            EditScope::Following,
        )
        .unwrap();
        assert_eq!(res.title, "Nueva etapa");
        assert_eq!(
            res.recurrence.as_deref(),
            Some("FREQ=DAILY;COUNT=4"),
            "hereda las repeticiones restantes"
        );
        let list = list_range(&c, 0, 20 * DAY_MS).unwrap();
        assert_eq!(list.len(), 6);
        assert_eq!(list.iter().filter(|e| e.title == "Reunión").count(), 2);
        assert_eq!(
            list.iter()
                .filter(|e| e.title == "Nueva etapa" && (e.start_at % DAY_MS) == 11 * H)
                .count(),
            4
        );
    }

    #[test]
    fn edit_all_shifts_series_and_can_remove_rule() {
        let (c, a, _) = setup();
        let first = series(&c, &a, "FREQ=DAILY;COUNT=3");
        let master = first.recurrence_master_id.clone().unwrap();
        let day2 = instance_id(&master, DAY_MS + 9 * H);
        // Mover la segunda ocurrencia una hora más tarde mueve toda la serie.
        update(
            &c,
            &day2,
            &EventPatch {
                start_at: Some(DAY_MS + 10 * H),
                end_at: Some(DAY_MS + 11 * H),
                ..patch()
            },
            EditScope::All,
        )
        .unwrap();
        assert_eq!(
            starts(&c, 0, 10 * DAY_MS),
            vec![10 * H, DAY_MS + 10 * H, 2 * DAY_MS + 10 * H]
        );
        // Cambiar la regla.
        let day1 = instance_id(&master, 10 * H);
        update(
            &c,
            &day1,
            &EventPatch {
                recurrence: Some("FREQ=DAILY;INTERVAL=2;COUNT=2".into()),
                ..patch()
            },
            EditScope::All,
        )
        .unwrap();
        assert_eq!(
            starts(&c, 0, 10 * DAY_MS),
            vec![10 * H, 2 * DAY_MS + 10 * H]
        );
        // Quitar la repetición deja un evento simple.
        let e = update(
            &c,
            &day1,
            &EventPatch {
                recurrence: Some(String::new()),
                ..patch()
            },
            EditScope::All,
        )
        .unwrap();
        assert!(!e.is_recurring);
        assert_eq!(starts(&c, 0, 10 * DAY_MS), vec![10 * H]);
        // Y uno simple puede convertirse en serie.
        let s = update(
            &c,
            &e.id,
            &EventPatch {
                recurrence: Some("FREQ=WEEKLY;COUNT=2".into()),
                ..patch()
            },
            EditScope::This,
        )
        .unwrap();
        assert!(s.is_recurring);
        assert_eq!(
            starts(&c, 0, 30 * DAY_MS),
            vec![10 * H, 7 * DAY_MS + 10 * H]
        );
    }

    #[test]
    fn delete_following_and_all() {
        let (c, a, _) = setup();
        let first = series(&c, &a, "FREQ=DAILY");
        let master = first.recurrence_master_id.clone().unwrap();
        delete(
            &c,
            &instance_id(&master, 3 * DAY_MS + 9 * H),
            EditScope::Following,
        )
        .unwrap();
        assert_eq!(starts(&c, 0, 30 * DAY_MS).len(), 3);
        delete(&c, &instance_id(&master, DAY_MS + 9 * H), EditScope::All).unwrap();
        assert!(list_range(&c, 0, 30 * DAY_MS).unwrap().is_empty());
        let n: i64 = c
            .query_row("SELECT count(*) FROM event_recurrences", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
        let r: i64 = c
            .query_row("SELECT count(*) FROM event_reminders", [], |r| r.get(0))
            .unwrap();
        assert_eq!(r, 0, "los recordatorios se borran en cascada");
    }

    #[test]
    fn search_is_literal_and_case_insensitive() {
        let (c, a, _) = setup();
        let mut e = new(&a, H, 2 * H);
        e.title = "Dentista 100%".into();
        e.location = "Clínica Norte".into();
        create(&c, &e).unwrap();
        create(&c, &new(&a, H, 2 * H)).unwrap();
        assert_eq!(search(&c, "dentista", 10).unwrap().len(), 1);
        assert_eq!(search(&c, "norte", 10).unwrap().len(), 1);
        assert_eq!(search(&c, "%", 10).unwrap().len(), 1, "% es literal");
        let s = series(&c, &a, "FREQ=DAILY");
        let found = search(&c, "reunión", 10).unwrap();
        assert!(
            found.iter().any(|f| f.id == s.id),
            "las series se devuelven como su primera ocurrencia"
        );
    }
}
