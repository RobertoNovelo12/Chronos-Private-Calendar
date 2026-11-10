//! Importación y exportación (ICS, JSON y CSV). Todo ocurre en local: se lee
//! o escribe un archivo que el usuario eligió; no hay conexiones de red.

pub mod csv;
pub mod ics;
pub mod json;

use crate::database::Atomic;
use crate::error::{CoreError, Result};
use crate::fs_util::write_atomic;
use crate::models::event::{
    Attendee, Availability, EditScope, Event, EventLink, EventPatch, EventStatus, NewEvent,
    Visibility,
};
use crate::models::Task;
use crate::models::{Calendar, NewCalendar};
use crate::recurrence::instance_id;
use crate::repositories::{calendars, events, labels, tasks};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// Tamaño máximo de un archivo a importar.
pub const MAX_IMPORT_BYTES: u64 = 20 * 1024 * 1024;
/// Máximo de eventos por importación.
pub const MAX_IMPORT_EVENTS: usize = 50_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Ics,
    Json,
    Csv,
}

/// Qué exportar. Sin filtros se exporta todo.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOptions {
    pub calendar_ids: Option<Vec<String>>,
    pub from: Option<i64>,
    pub to: Option<i64>,
    /// Eventos concretos (ids del frontend, también ocurrencias).
    pub event_ids: Option<Vec<String>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportReport {
    pub events: usize,
    pub tasks: usize,
    pub path: String,
}

/// Tarea exportable.
#[derive(Clone, Debug)]
pub struct TaskItem {
    pub uid: String,
    pub task: Task,
    pub calendar_name: Option<String>,
}

/// Tareas que se exportan con los mismos filtros (calendarios y fechas). Al
/// exportar eventos concretos no se incluyen tareas. Con filtro de calendarios
/// las tareas sin calendario quedan fuera; con rango, las que no tienen fecha.
pub fn collect_tasks(conn: &rusqlite::Connection, opts: &ExportOptions) -> Result<Vec<TaskItem>> {
    if opts.event_ids.is_some() {
        return Ok(Vec::new());
    }
    let names: HashMap<String, String> = calendars::list(conn)?
        .into_iter()
        .map(|c| (c.id, c.name))
        .collect();
    Ok(
        tasks::export_rows(conn, opts.calendar_ids.as_deref(), opts.from, opts.to)?
            .into_iter()
            .map(|(task, uid)| TaskItem {
                uid: uid.unwrap_or_else(|| format!("task-{}@chronos.local", task.id)),
                calendar_name: task
                    .calendar_id
                    .as_ref()
                    .and_then(|c| names.get(c).cloned()),
                task,
            })
            .collect(),
    )
}

/// Elemento exportable: evento simple, serie o excepción de una serie.
#[derive(Clone, Debug)]
pub struct ExportItem {
    pub uid: String,
    pub event: Event,
    pub calendar_name: String,
    /// Ocurrencias canceladas (EXDATE) de una serie.
    pub exdates: Vec<i64>,
    /// En excepciones: inicio original y formato de la serie (zona, día completo).
    pub recurrence_id: Option<(i64, String, bool)>,
    /// Nombres de las etiquetas del evento.
    pub labels: Vec<String>,
}

/// Nombres de etiqueta de cada elemento (los ids se traducen al exportar).
fn fill_label_names(conn: &rusqlite::Connection, items: &mut [ExportItem]) -> Result<()> {
    let names: HashMap<String, String> = labels::list(conn)?
        .into_iter()
        .map(|l| (l.id, l.name))
        .collect();
    for it in items.iter_mut() {
        it.labels = it
            .event
            .labels
            .iter()
            .filter_map(|id| names.get(id).cloned())
            .collect();
    }
    Ok(())
}

fn default_uid(id: &str) -> String {
    format!("{id}@chronos.local")
}

/// Reúne lo que se va a exportar.
pub fn collect(
    conn: &rusqlite::Connection,
    opts: &ExportOptions,
) -> Result<(Vec<ExportItem>, Vec<Calendar>)> {
    let all_cals = calendars::list(conn)?;
    let names: HashMap<String, String> = all_cals
        .iter()
        .map(|c| (c.id.clone(), c.name.clone()))
        .collect();
    let mut items = Vec::new();

    if let Some(ids) = &opts.event_ids {
        // Eventos seleccionados: cada uno tal como se ve (una ocurrencia se exporta sola).
        for id in ids {
            let mut e = events::get(conn, id)?;
            let uid = match (&e.recurrence_master_id, e.original_start_at) {
                (Some(m), Some(t)) => format!("{m}-{t}@chronos.local"),
                _ => default_uid(&e.id),
            };
            e.recurrence = None;
            e.recurrence_master_id = None;
            e.original_start_at = None;
            e.is_recurring = false;
            items.push(ExportItem {
                uid,
                calendar_name: names.get(&e.calendar_id).cloned().unwrap_or_default(),
                event: e,
                exdates: vec![],
                recurrence_id: None,
                labels: vec![],
            });
        }
        fill_label_names(conn, &mut items)?;
        let used: Vec<Calendar> = all_cals
            .into_iter()
            .filter(|c| items.iter().any(|i| i.event.calendar_id == c.id))
            .collect();
        return Ok((items, used));
    }

    let rows = events::export_rows(conn, opts.calendar_ids.as_deref(), opts.from, opts.to)?;
    let master_info: HashMap<String, (String, String, bool)> = rows
        .iter()
        .filter(|r| r.event.is_recurring && r.event.recurrence_master_id.is_none())
        .map(|r| {
            let uid = r.uid.clone().unwrap_or_else(|| default_uid(&r.event.id));
            (
                r.event.id.clone(),
                (uid, r.event.timezone.clone(), r.event.is_all_day),
            )
        })
        .collect();
    for r in rows {
        let calendar_name = names.get(&r.event.calendar_id).cloned().unwrap_or_default();
        let (uid, exdates, recurrence_id) =
            match (&r.event.recurrence_master_id, r.event.original_start_at) {
                (Some(m), Some(t)) => match master_info.get(m) {
                    Some((muid, tz, all_day)) => {
                        (muid.clone(), vec![], Some((t, tz.clone(), *all_day)))
                    }
                    None => (
                        r.uid.clone().unwrap_or_else(|| default_uid(&r.event.id)),
                        vec![],
                        None,
                    ),
                },
                _ if r.event.is_recurring => (
                    master_info
                        .get(&r.event.id)
                        .map(|m| m.0.clone())
                        .unwrap_or_else(|| default_uid(&r.event.id)),
                    events::cancelled_exceptions(conn, &r.event.id)?,
                    None,
                ),
                _ => (
                    r.uid.clone().unwrap_or_else(|| default_uid(&r.event.id)),
                    vec![],
                    None,
                ),
            };
        items.push(ExportItem {
            uid,
            event: r.event,
            calendar_name,
            exdates,
            recurrence_id,
            labels: vec![],
        });
    }
    fill_label_names(conn, &mut items)?;
    let used: Vec<Calendar> = match &opts.calendar_ids {
        Some(ids) => all_cals
            .into_iter()
            .filter(|c| ids.contains(&c.id))
            .collect(),
        None => all_cals,
    };
    Ok((items, used))
}

/// Exporta a un archivo (escritura atómica).
pub fn export_to_file(
    conn: &rusqlite::Connection,
    format: Format,
    opts: &ExportOptions,
    path: &Path,
) -> Result<ExportReport> {
    let (items, cals) = collect(conn, opts)?;
    // El CSV es una tabla de eventos: las tareas van en ICS (VTODO) y JSON.
    let task_items = match format {
        Format::Csv => Vec::new(),
        _ => collect_tasks(conn, opts)?,
    };
    let content = match format {
        Format::Ics => {
            let name = if cals.len() == 1 {
                Some(cals[0].name.as_str())
            } else {
                None
            };
            ics::write(&items, &task_items, name)
        }
        Format::Json => {
            let used: Vec<crate::models::Label> = labels::list(conn)?
                .into_iter()
                .filter(|l| items.iter().any(|it| it.labels.contains(&l.name)))
                .collect();
            json::write(&items, &task_items, &cals, &used)?
        }
        Format::Csv => csv::write(&items),
    };
    write_atomic(path, content.as_bytes())?;
    tracing::info!(
        events = items.len(),
        tasks = task_items.len(),
        "exportación completada"
    );
    Ok(ExportReport {
        events: items.len(),
        tasks: task_items.len(),
        path: path.to_string_lossy().into_owned(),
    })
}

// ---------------------------------------------------------------------------
// Importación
// ---------------------------------------------------------------------------

/// Evento leído de un archivo, independiente del formato.
#[derive(Clone, Debug, Default)]
pub struct ImportEvent {
    pub uid: Option<String>,
    pub title: String,
    pub description: String,
    pub location: String,
    pub links: Vec<EventLink>,
    pub start_at: i64,
    pub end_at: i64,
    pub timezone: String,
    pub is_all_day: bool,
    pub availability: Option<Availability>,
    pub visibility: Option<Visibility>,
    pub status: Option<EventStatus>,
    pub recurrence: Option<String>,
    pub reminders: Vec<i32>,
    pub exdates: Vec<i64>,
    /// Si es una excepción: inicio original de la ocurrencia de la serie `uid`.
    pub recurrence_id: Option<i64>,
    /// Nombres de etiquetas (se crean al importar si no existen).
    pub labels: Vec<String>,
    pub attendees: Vec<Attendee>,
}

/// Participantes importados: se descartan los no válidos y se limita el número.
fn clean_attendees(list: &[Attendee]) -> Vec<Attendee> {
    let mut out: Vec<Attendee> = Vec::new();
    let mut organizer = false;
    for a in list.iter().take(crate::models::event::MAX_ATTENDEES) {
        let mut a = Attendee {
            name: truncate(&a.name, 200),
            ..a.clone()
        };
        if a.role == crate::models::event::AttendeeRole::Organizer {
            if organizer {
                a.role = crate::models::event::AttendeeRole::Required;
            }
            organizer = true;
        }
        if crate::models::event::normalize_attendees(std::slice::from_ref(&a)).is_ok() {
            out.push(a);
        }
    }
    out
}

/// Tarea leída de un archivo.
#[derive(Clone, Debug, Default)]
pub struct ImportTask {
    pub uid: Option<String>,
    pub title: String,
    pub notes: String,
    pub due_at: Option<i64>,
    pub is_all_day: bool,
    pub priority: u8,
    pub completed_at: Option<i64>,
    pub reminders: Vec<i32>,
}

/// Grupo de eventos de un archivo (un calendario).
#[derive(Clone, Debug, Default)]
pub struct ImportBatch {
    pub calendar_name: Option<String>,
    pub calendar_color: Option<String>,
    pub events: Vec<ImportEvent>,
    pub tasks: Vec<ImportTask>,
    /// Reglas de repetición que no se pudieron interpretar.
    pub rules_dropped: usize,
    /// Colores conocidos de etiquetas (nombre, color), p. ej. del JSON de Chronos.
    pub label_colors: Vec<(String, String)>,
}

/// Dónde se importan los eventos.
#[derive(Clone, Debug, Deserialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
pub enum ImportTarget {
    /// Todo en un calendario existente.
    Existing { calendar_id: String },
    /// En calendarios nuevos (o en los que ya tengan el mismo nombre).
    New { name: Option<String> },
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub imported: usize,
    /// Ya existían (mismo UID en el mismo calendario).
    pub duplicates: usize,
    /// Descartados (cancelados o con datos no válidos).
    pub skipped: usize,
    pub rules_dropped: usize,
    pub calendars_created: usize,
    #[serde(default)]
    pub labels_created: usize,
    /// Tareas importadas (también cuentan en `duplicates` y `skipped`).
    #[serde(default)]
    pub tasks_imported: usize,
}

fn truncate(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

const IMPORT_COLORS: &[&str] = &[
    "#27ae60", "#9b51e0", "#f2994a", "#2d9cdb", "#e84393", "#0f766e",
];

fn resolve_calendar(
    conn: &rusqlite::Connection,
    name: &str,
    color: Option<&str>,
    report: &mut ImportReport,
) -> Result<String> {
    let name = truncate(name.trim(), 200);
    let name = if name.is_empty() {
        "Importado".to_string()
    } else {
        name
    };
    if let Some(existing) = calendars::list(conn)?
        .into_iter()
        .find(|c| c.name.eq_ignore_ascii_case(&name))
    {
        return Ok(existing.id);
    }
    let color = color
        .and_then(|c| crate::models::calendar::normalize_color(c).ok())
        .unwrap_or_else(|| {
            IMPORT_COLORS[report.calendars_created % IMPORT_COLORS.len()].to_string()
        });
    let cal = calendars::create(
        conn,
        &NewCalendar {
            name,
            color,
            description: None,
        },
    )?;
    report.calendars_created += 1;
    Ok(cal.id)
}

/// Aplica la importación en una única operación atómica.
pub fn apply(
    conn: &rusqlite::Connection,
    batches: Vec<ImportBatch>,
    target: &ImportTarget,
    file_name: &str,
) -> Result<ImportReport> {
    let total: usize = batches.iter().map(|b| b.events.len() + b.tasks.len()).sum();
    if total > MAX_IMPORT_EVENTS {
        return Err(CoreError::Validation(format!(
            "el archivo tiene más de {MAX_IMPORT_EVENTS} eventos"
        )));
    }
    let tx = Atomic::begin(conn)?;
    let mut report = ImportReport::default();
    let mut label_ids = LabelResolver::new(&tx)?;
    let mut task_uids = tasks::existing_uids(&tx)?;
    for batch in batches {
        for (name, color) in &batch.label_colors {
            label_ids.colors.insert(name.to_lowercase(), color.clone());
        }
        report.rules_dropped += batch.rules_dropped;
        let calendar_id = match target {
            ImportTarget::Existing { calendar_id } => calendars::get(&tx, calendar_id)?.id,
            ImportTarget::New { name } => {
                let n = name
                    .clone()
                    .or(batch.calendar_name.clone())
                    .unwrap_or_else(|| file_name.to_string());
                resolve_calendar(&tx, &n, batch.calendar_color.as_deref(), &mut report)?
            }
        };
        import_tasks(&tx, &calendar_id, batch.tasks, &mut task_uids, &mut report)?;
        import_batch(&tx, &calendar_id, batch.events, &mut label_ids, &mut report)?;
    }
    report.labels_created = label_ids.created;
    tx.commit()?;
    tracing::info!(
        imported = report.imported,
        duplicates = report.duplicates,
        "importación completada"
    );
    Ok(report)
}

fn import_tasks(
    conn: &rusqlite::Connection,
    calendar_id: &str,
    list: Vec<ImportTask>,
    uids: &mut std::collections::HashSet<String>,
    report: &mut ImportReport,
) -> Result<()> {
    for t in list {
        if let Some(uid) = &t.uid {
            if uids.contains(uid) {
                report.duplicates += 1;
                continue;
            }
        }
        let input = crate::models::NewTask {
            calendar_id: Some(calendar_id.to_string()),
            title: truncate(&t.title, 1000),
            notes: truncate(&t.notes, 50_000),
            due_at: t.due_at,
            is_all_day: t.is_all_day,
            priority: t.priority.min(3),
            reminders: t
                .reminders
                .into_iter()
                .filter(|m| (0..=40_320).contains(m))
                .take(10)
                .collect(),
            completed_at: t.completed_at,
            ical_uid: t.uid.clone(),
        };
        match tasks::create(conn, &input) {
            Ok(_) => {
                report.tasks_imported += 1;
                if let Some(uid) = t.uid {
                    uids.insert(uid);
                }
            }
            Err(CoreError::Validation(_)) => report.skipped += 1,
            Err(other) => return Err(other),
        }
    }
    Ok(())
}

/// Traduce nombres de etiqueta a ids, creando las que falten (con caché).
struct LabelResolver {
    known: HashMap<String, Option<String>>,
    colors: HashMap<String, String>,
    created: usize,
}

impl LabelResolver {
    fn new(conn: &rusqlite::Connection) -> Result<Self> {
        let known = labels::list(conn)?
            .into_iter()
            .map(|l| (l.name.to_lowercase(), Some(l.id)))
            .collect();
        Ok(Self {
            known,
            colors: HashMap::new(),
            created: 0,
        })
    }

    fn ids(&mut self, conn: &rusqlite::Connection, names: &[String]) -> Result<Vec<String>> {
        let mut out = Vec::new();
        for name in names
            .iter()
            .take(crate::models::label::MAX_LABELS_PER_EVENT)
        {
            let key = name.trim().to_lowercase();
            if key.is_empty() {
                continue;
            }
            let id = match self.known.get(&key) {
                Some(id) => id.clone(),
                None => {
                    let id = labels::ensure_by_name(
                        conn,
                        &truncate(name, crate::models::label::MAX_LABEL_NAME_CHARS),
                        self.colors.get(&key).map(String::as_str),
                    )?;
                    if id.is_some() {
                        self.created += 1;
                    }
                    self.known.insert(key, id.clone());
                    id
                }
            };
            if let Some(id) = id {
                if !out.contains(&id) {
                    out.push(id);
                }
            }
        }
        Ok(out)
    }
}

fn import_batch(
    conn: &rusqlite::Connection,
    calendar_id: &str,
    list: Vec<ImportEvent>,
    label_ids: &mut LabelResolver,
    report: &mut ImportReport,
) -> Result<()> {
    let mut by_uid = events::uids_in_calendar(conn, calendar_id)?;
    let (masters, overrides): (Vec<_>, Vec<_>) =
        list.into_iter().partition(|e| e.recurrence_id.is_none());

    for e in masters {
        if e.status == Some(EventStatus::Cancelled) {
            report.skipped += 1;
            continue;
        }
        if let Some(uid) = &e.uid {
            if by_uid.contains_key(uid) {
                report.duplicates += 1;
                continue;
            }
        }
        let input = NewEvent {
            calendar_id: calendar_id.to_string(),
            title: truncate(&e.title, 1000),
            description: truncate(&e.description, 50_000),
            location: truncate(&e.location, 1000),
            links: e.links.into_iter().take(20).collect(),
            color: None,
            start_at: e.start_at,
            end_at: e.end_at.max(e.start_at),
            timezone: e.timezone.clone(),
            is_all_day: e.is_all_day,
            visibility: e.visibility,
            availability: e.availability,
            recurrence: e.recurrence.clone(),
            reminders: e
                .reminders
                .into_iter()
                .filter(|m| (0..=40_320).contains(m))
                .take(10)
                .collect(),
            labels: label_ids.ids(conn, &e.labels)?,
            attendees: clean_attendees(&e.attendees),
            ical_uid: e.uid.clone(),
        };
        let created = match events::create(conn, &input) {
            Ok(c) => c,
            Err(CoreError::Validation(_)) => {
                // Regla incompatible u otro dato no válido: se intenta sin repetición.
                if input.recurrence.is_some() {
                    match events::create(
                        conn,
                        &NewEvent {
                            recurrence: None,
                            ..input.clone()
                        },
                    ) {
                        Ok(c) => {
                            report.rules_dropped += 1;
                            c
                        }
                        Err(_) => {
                            report.skipped += 1;
                            continue;
                        }
                    }
                } else {
                    report.skipped += 1;
                    continue;
                }
            }
            Err(other) => return Err(other),
        };
        let real_id = created
            .recurrence_master_id
            .clone()
            .unwrap_or(created.id.clone());
        if created.is_recurring {
            for t in e.exdates {
                events::add_cancelled_exception(conn, &real_id, t)?;
            }
        }
        if let Some(uid) = e.uid {
            by_uid.insert(uid, real_id);
        }
        report.imported += 1;
    }

    for e in overrides {
        let t = e.recurrence_id.unwrap_or_default();
        let master = e.uid.as_ref().and_then(|u| by_uid.get(u)).cloned();
        let patch = EventPatch {
            title: Some(truncate(&e.title, 1000)),
            description: Some(truncate(&e.description, 50_000)),
            location: Some(truncate(&e.location, 1000)),
            start_at: Some(e.start_at),
            end_at: Some(e.end_at.max(e.start_at)),
            is_all_day: Some(e.is_all_day),
            availability: e.availability,
            visibility: e.visibility,
            reminders: Some(
                e.reminders
                    .iter()
                    .copied()
                    .filter(|m| (0..=40_320).contains(m))
                    .take(10)
                    .collect(),
            ),
            labels: Some(label_ids.ids(conn, &e.labels)?),
            attendees: Some(clean_attendees(&e.attendees)),
            ..Default::default()
        };
        let applied = match &master {
            Some(m) if events::is_free_occurrence(conn, m, t)? => {
                if e.status == Some(EventStatus::Cancelled) {
                    events::add_cancelled_exception(conn, m, t)?
                } else {
                    events::update(conn, &instance_id(m, t), &patch, EditScope::This).is_ok()
                }
            }
            // La ocurrencia ya tiene una excepción: se importó antes.
            Some(_) => {
                report.duplicates += 1;
                continue;
            }
            _ => false,
        };
        if applied {
            report.imported += 1;
            continue;
        }
        // Sin serie a la que asociarla: se importa como evento suelto.
        if e.status == Some(EventStatus::Cancelled) {
            report.skipped += 1;
            continue;
        }
        let input = NewEvent {
            calendar_id: calendar_id.to_string(),
            title: patch.title.clone().unwrap_or_default(),
            description: patch.description.clone().unwrap_or_default(),
            location: patch.location.clone().unwrap_or_default(),
            links: e.links,
            start_at: e.start_at,
            end_at: e.end_at.max(e.start_at),
            timezone: e.timezone,
            is_all_day: e.is_all_day,
            visibility: e.visibility,
            availability: e.availability,
            reminders: patch.reminders.clone().unwrap_or_default(),
            labels: patch.labels.clone().unwrap_or_default(),
            attendees: patch.attendees.clone().unwrap_or_default(),
            ..Default::default()
        };
        match events::create(conn, &input) {
            Ok(_) => report.imported += 1,
            Err(CoreError::Validation(_)) => report.skipped += 1,
            Err(other) => return Err(other),
        }
    }
    Ok(())
}

/// Lee y analiza un archivo de importación.
pub fn read_file(path: &Path, default_tz: &str) -> Result<(Format, Vec<ImportBatch>)> {
    let meta = std::fs::metadata(path)?;
    if !meta.is_file() || meta.len() > MAX_IMPORT_BYTES {
        return Err(CoreError::Validation(
            "el archivo no existe o es demasiado grande (máx. 20 MB)".into(),
        ));
    }
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    let bytes = std::fs::read(path)?;
    let text = String::from_utf8_lossy(&bytes);
    let text = text.trim_start_matches('\u{feff}');
    let default_tz =
        crate::models::event::normalize_timezone(default_tz).unwrap_or_else(|_| "UTC".into());
    match ext.as_str() {
        "ics" | "ical" | "ifb" => Ok((Format::Ics, vec![ics::parse(text, &default_tz)?])),
        "json" => Ok((Format::Json, json::parse(text)?)),
        _ => Err(CoreError::Validation(
            "formato no compatible: usa un archivo .ics o .json".into(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::migrate;
    use crate::models::event::DAY_MS;
    use rusqlite::Connection;

    const H: i64 = 3_600_000;

    fn db() -> (Connection, String) {
        let mut c = Connection::open_in_memory().unwrap();
        c.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate(&mut c).unwrap();
        let cal = calendars::create(
            &c,
            &NewCalendar {
                name: "Trabajo".into(),
                color: "#112233".into(),
                description: None,
            },
        )
        .unwrap();
        (c, cal.id)
    }

    fn seed(c: &Connection, cal: &str) -> String {
        let base = 20_000 * DAY_MS + 15 * H;
        events::create(
            c,
            &NewEvent {
                calendar_id: cal.into(),
                title: "Café, con \"amigos\"".into(),
                description: "línea 1\nlínea 2".into(),
                start_at: base,
                end_at: base + H,
                timezone: "UTC".into(),
                reminders: vec![10],
                ..Default::default()
            },
        )
        .unwrap();
        let s = events::create(
            c,
            &NewEvent {
                calendar_id: cal.into(),
                title: "Diario".into(),
                start_at: base,
                end_at: base + H,
                timezone: "America/Mexico_City".into(),
                recurrence: Some("FREQ=DAILY;COUNT=5".into()),
                ..Default::default()
            },
        )
        .unwrap();
        let master = s.recurrence_master_id.clone().unwrap_or(s.id.clone());
        // Se cancela el segundo día y se mueve el tercero.
        events::delete(c, &instance_id(&master, base + DAY_MS), EditScope::This).unwrap();
        events::update(
            c,
            &instance_id(&master, base + 2 * DAY_MS),
            &EventPatch {
                title: Some("Movido".into()),
                start_at: Some(base + 2 * DAY_MS + 2 * H),
                end_at: Some(base + 2 * DAY_MS + 3 * H),
                ..Default::default()
            },
            EditScope::This,
        )
        .unwrap();
        events::create(
            c,
            &NewEvent {
                calendar_id: cal.into(),
                title: "Vacaciones".into(),
                start_at: 20_010 * DAY_MS,
                end_at: 20_012 * DAY_MS,
                timezone: "UTC".into(),
                is_all_day: true,
                ..Default::default()
            },
        )
        .unwrap();
        master
    }

    fn titles(c: &Connection) -> Vec<String> {
        let mut v: Vec<String> = events::list_range(c, 19_990 * DAY_MS, 20_030 * DAY_MS)
            .unwrap()
            .into_iter()
            .map(|e| e.title)
            .collect();
        v.sort();
        v
    }

    #[test]
    fn ics_round_trip_and_dedup() {
        let (c, cal) = db();
        seed(&c, &cal);
        let before = titles(&c);
        assert_eq!(before.len(), 1 + 4 + 1);
        let (items, cals) = collect(&c, &ExportOptions::default()).unwrap();
        let text = ics::write(&items, &[], Some(&cals[0].name));
        assert!(text.contains("RRULE:FREQ=DAILY;COUNT=5"));
        assert!(text.contains("EXDATE;TZID=America/Mexico_City:"));
        assert!(text.contains("RECURRENCE-ID;TZID=America/Mexico_City:"));
        assert!(text.contains("TRIGGER:-PT10M"));

        let (c2, _) = db();
        let batch = ics::parse(&text, "UTC").unwrap();
        let r = apply(
            &c2,
            vec![batch.clone()],
            &ImportTarget::New { name: None },
            "x",
        )
        .unwrap();
        assert_eq!(r.imported, 4, "{r:?}"); // café, serie, excepción, vacaciones
        assert_eq!(r.calendars_created, 0, "reutiliza 'Trabajo'");
        assert_eq!(titles(&c2), before);
        // Reimportar no duplica.
        let r = apply(&c2, vec![batch], &ImportTarget::New { name: None }, "x").unwrap();
        assert_eq!(r.imported, 0);
        assert_eq!(r.duplicates, 4);
        assert_eq!(titles(&c2), before);
        let cafe = events::list_range(&c2, 19_990 * DAY_MS, 20_030 * DAY_MS)
            .unwrap()
            .into_iter()
            .find(|e| e.title.starts_with("Café"))
            .unwrap();
        assert_eq!(cafe.description, "línea 1\nlínea 2");
        assert_eq!(cafe.reminders, vec![10]);
    }

    #[test]
    fn json_round_trip_and_csv() {
        let (c, cal) = db();
        seed(&c, &cal);
        let before = titles(&c);
        let (items, cals) = collect(&c, &ExportOptions::default()).unwrap();
        let text = json::write(&items, &[], &cals, &[]).unwrap();
        let (c2, _) = db();
        let batches = json::parse(&text).unwrap();
        assert_eq!(batches.len(), 1);
        apply(
            &c2,
            batches,
            &ImportTarget::New {
                name: Some("Copia".into()),
            },
            "x",
        )
        .unwrap();
        assert_eq!(titles(&c2), before);
        assert!(json::parse("{\"format\":\"otro\",\"version\":1}").is_err());

        let csv = csv::write(&items);
        assert!(csv.starts_with('\u{feff}'));
        assert!(csv.contains("\"Café, con \"\"amigos\"\"\""));
        // Cabecera + una fila por elemento + la línea extra de la descripción multilínea.
        assert_eq!(csv.lines().count(), 1 + items.len() + 1);
    }

    #[test]
    fn export_filters() {
        let (c, cal) = db();
        seed(&c, &cal);
        let other = calendars::create(
            &c,
            &NewCalendar {
                name: "Otro".into(),
                color: "#445566".into(),
                description: None,
            },
        )
        .unwrap();
        let (items, _) = collect(
            &c,
            &ExportOptions {
                calendar_ids: Some(vec![other.id]),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(items.is_empty());
        // Solo las vacaciones caen en este rango.
        let (items, _) = collect(
            &c,
            &ExportOptions {
                from: Some(20_009 * DAY_MS),
                to: Some(20_013 * DAY_MS),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(
            items
                .iter()
                .map(|i| i.event.title.as_str())
                .collect::<Vec<_>>(),
            vec!["Vacaciones"]
        );
        // Una ocurrencia seleccionada se exporta sola, sin regla.
        let all = events::list_range(&c, 19_990 * DAY_MS, 20_030 * DAY_MS).unwrap();
        let occ = all.iter().find(|e| e.title == "Diario").unwrap();
        let (items, _) = collect(
            &c,
            &ExportOptions {
                event_ids: Some(vec![occ.id.clone()]),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(items.len(), 1);
        assert!(items[0].event.recurrence.is_none());
    }

    #[test]
    fn labels_round_trip_ics_and_json() {
        use crate::models::label::NewLabel;
        let (c, cal) = db();
        let base = 20_000 * DAY_MS + 15 * H;
        let urgent = labels::create(
            &c,
            &NewLabel {
                name: "Urgente, ya".into(),
                color: "#eb5757".into(),
            },
        )
        .unwrap();
        let client = labels::create(
            &c,
            &NewLabel {
                name: "Cliente".into(),
                color: "#27ae60".into(),
            },
        )
        .unwrap();
        events::create(
            &c,
            &NewEvent {
                calendar_id: cal.clone(),
                title: "Llamada".into(),
                start_at: base,
                end_at: base + H,
                timezone: "UTC".into(),
                labels: vec![urgent.id.clone(), client.id.clone()],
                ..Default::default()
            },
        )
        .unwrap();
        events::create(
            &c,
            &NewEvent {
                calendar_id: cal.clone(),
                title: "Semanal".into(),
                start_at: base,
                end_at: base + H,
                timezone: "UTC".into(),
                recurrence: Some("FREQ=WEEKLY;COUNT=3".into()),
                labels: vec![client.id.clone()],
                ..Default::default()
            },
        )
        .unwrap();
        let (items, cals) = collect(&c, &ExportOptions::default()).unwrap();

        // ICS: CATEGORIES con la coma escapada; al importar se crean las etiquetas.
        let text = ics::write(&items, &[], Some(&cals[0].name));
        assert!(text.contains("CATEGORIES:Cliente,Urgente\\, ya"), "{text}");
        let (c2, _) = db();
        let r = apply(
            &c2,
            vec![ics::parse(&text, "UTC").unwrap()],
            &ImportTarget::New { name: None },
            "x",
        )
        .unwrap();
        assert_eq!(r.labels_created, 2);
        let names = |conn: &Connection, title: &str| -> Vec<String> {
            let all = labels::list(conn).unwrap();
            let ev = events::list_range(conn, base - DAY_MS, base + 30 * DAY_MS)
                .unwrap()
                .into_iter()
                .find(|e| e.title == title)
                .unwrap();
            ev.labels
                .iter()
                .map(|id| all.iter().find(|l| &l.id == id).unwrap().name.clone())
                .collect()
        };
        assert_eq!(names(&c2, "Llamada"), ["Cliente", "Urgente, ya"]);
        assert_eq!(names(&c2, "Semanal"), ["Cliente"]);

        // JSON: conserva también los colores; reutiliza etiquetas con el mismo nombre.
        let used = labels::list(&c).unwrap();
        let text = json::write(&items, &[], &cals, &used).unwrap();
        let (c3, _) = db();
        labels::create(
            &c3,
            &NewLabel {
                name: "cliente".into(),
                color: "#000000".into(),
            },
        )
        .unwrap();
        let r = apply(
            &c3,
            json::parse(&text).unwrap(),
            &ImportTarget::New { name: None },
            "x",
        )
        .unwrap();
        assert_eq!(r.labels_created, 1);
        let all = labels::list(&c3).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(
            all.iter().find(|l| l.name == "Urgente, ya").unwrap().color,
            "#eb5757"
        );
        assert_eq!(names(&c3, "Llamada"), ["cliente", "Urgente, ya"]);

        // CSV: columna «Etiquetas».
        let csv = csv::write(&items);
        assert!(csv.contains("\"Cliente, Urgente, ya\""));
    }

    #[test]
    fn tasks_round_trip_ics_and_json() {
        use crate::models::task::{NewTask, TaskPatch};
        let (c, cal) = db();
        let due = 20_000 * DAY_MS + 15 * H;
        tasks::create(
            &c,
            &NewTask {
                calendar_id: Some(cal.clone()),
                title: "Pagar luz, agua".into(),
                notes: "recibo\nde octubre".into(),
                due_at: Some(due),
                priority: 3,
                reminders: vec![60],
                ..Default::default()
            },
        )
        .unwrap();
        let done = tasks::create(
            &c,
            &NewTask {
                calendar_id: Some(cal.clone()),
                title: "Comprar regalo".into(),
                due_at: Some(20_002 * DAY_MS),
                is_all_day: true,
                ..Default::default()
            },
        )
        .unwrap();
        tasks::update(
            &c,
            &done.id,
            &TaskPatch {
                completed: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
        tasks::create(
            &c,
            &NewTask {
                title: "Sin fecha ni calendario".into(),
                ..Default::default()
            },
        )
        .unwrap();
        let (items, cals) = collect(&c, &ExportOptions::default()).unwrap();
        let task_items = collect_tasks(&c, &ExportOptions::default()).unwrap();
        assert_eq!(task_items.len(), 3);
        // Con filtro de calendario, la tarea sin calendario no se exporta.
        let filtered = collect_tasks(
            &c,
            &ExportOptions {
                calendar_ids: Some(vec![cal.clone()]),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(filtered.len(), 2);

        let text = ics::write(&items, &task_items, Some(&cals[0].name));
        assert!(text.contains("BEGIN:VTODO"));
        assert!(text.contains("PRIORITY:1"));
        assert!(text.contains("DUE;VALUE=DATE:"));
        assert!(text.contains("STATUS:COMPLETED"));
        assert!(text.contains("TRIGGER;RELATED=END:-PT1H"));

        let check = |conn: &Connection| {
            let all = tasks::list(conn).unwrap();
            assert_eq!(all.len(), 3);
            let pay = all.iter().find(|t| t.title == "Pagar luz, agua").unwrap();
            assert_eq!(
                (pay.due_at, pay.priority, pay.reminders.clone()),
                (Some(due), 3, vec![60])
            );
            assert_eq!(pay.notes, "recibo\nde octubre");
            let gift = all.iter().find(|t| t.title == "Comprar regalo").unwrap();
            assert!(gift.is_all_day && gift.completed_at.is_some());
        };

        let (c2, _) = db();
        let r = apply(
            &c2,
            vec![ics::parse(&text, "UTC").unwrap()],
            &ImportTarget::New { name: None },
            "x",
        )
        .unwrap();
        assert_eq!(r.tasks_imported, 3, "{r:?}");
        check(&c2);
        // Reimportar no duplica.
        let r = apply(
            &c2,
            vec![ics::parse(&text, "UTC").unwrap()],
            &ImportTarget::New { name: None },
            "x",
        )
        .unwrap();
        assert_eq!((r.tasks_imported, r.duplicates), (0, 3));

        let text = json::write(&items, &task_items, &cals, &[]).unwrap();
        let (c3, _) = db();
        let r = apply(
            &c3,
            json::parse(&text).unwrap(),
            &ImportTarget::New { name: None },
            "x",
        )
        .unwrap();
        assert_eq!(r.tasks_imported, 3);
        check(&c3);
        // La tarea sin calendario va a un calendario «Tareas».
        assert!(calendars::list(&c3)
            .unwrap()
            .iter()
            .any(|c| c.name == "Tareas"));
    }

    #[test]
    fn imports_vtodo_from_other_apps() {
        let text = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:a@x\r\nSUMMARY:Llamar\r\n\
                    DUE;TZID=America/Mexico_City:20261110T090000\r\nPRIORITY:5\r\nBEGIN:VALARM\r\n\
                    TRIGGER:-PT15M\r\nACTION:DISPLAY\r\nEND:VALARM\r\nEND:VTODO\r\nBEGIN:VTODO\r\n\
                    UID:b@x\r\nSUMMARY:Cancelada\r\nSTATUS:CANCELLED\r\nEND:VTODO\r\nBEGIN:VTODO\r\n\
                    UID:c@x\r\nSUMMARY:\r\nEND:VTODO\r\nEND:VCALENDAR\r\n";
        let b = ics::parse(text, "UTC").unwrap();
        assert_eq!(b.tasks.len(), 1, "las canceladas y sin título se omiten");
        let t = &b.tasks[0];
        assert_eq!((t.priority, t.reminders.clone()), (2, vec![15]));
        // 9:00 en Ciudad de México = 15:00 UTC.
        assert_eq!(t.due_at.unwrap() % DAY_MS, 15 * H);
    }

    #[test]
    fn attendees_round_trip_ics_and_json() {
        use crate::models::event::{AttendeeRole as R, AttendeeStatus as S};
        let (c, cal) = db();
        let base = 20_000 * DAY_MS + 15 * H;
        let att = |name: &str, email: &str, role, status| Attendee {
            name: name.into(),
            email: email.into(),
            role,
            status,
        };
        events::create(
            &c,
            &NewEvent {
                calendar_id: cal.clone(),
                title: "Revisión".into(),
                start_at: base,
                end_at: base + H,
                timezone: "UTC".into(),
                attendees: vec![
                    att("Ana López", "ana@ejemplo.com", R::Organizer, S::Accepted),
                    att(
                        "Luis; \"el jefe\"",
                        "luis@ejemplo.com",
                        R::Required,
                        S::Tentative,
                    ),
                    att("", "eva@ejemplo.com", R::Optional, S::Declined),
                    att("Sin correo", "", R::Required, S::NeedsAction),
                ],
                ..Default::default()
            },
        )
        .unwrap();
        let (items, cals) = collect(&c, &ExportOptions::default()).unwrap();
        let text = ics::write(&items, &[], Some(&cals[0].name));
        let flat = text.replace("\r\n ", "");
        assert!(
            flat.contains("ORGANIZER;CN=Ana López:mailto:ana@ejemplo.com"),
            "{text}"
        );
        assert!(flat.contains("ATTENDEE;CN=\"Luis; el jefe\";ROLE=REQ-PARTICIPANT;PARTSTAT=TENTATIVE:mailto:luis@ejemplo.com"));
        assert!(flat.contains("ROLE=OPT-PARTICIPANT;PARTSTAT=DECLINED:mailto:eva@ejemplo.com"));
        assert!(!text.contains("Sin correo"), "sin correo no va en ICS");

        let (c2, _) = db();
        apply(
            &c2,
            vec![ics::parse(&text, "UTC").unwrap()],
            &ImportTarget::New { name: None },
            "x",
        )
        .unwrap();
        let ev = events::list_range(&c2, base - DAY_MS, base + DAY_MS)
            .unwrap()
            .remove(0);
        let got: Vec<(String, R, S)> = ev
            .attendees
            .iter()
            .map(|a| (a.email.clone(), a.role, a.status))
            .collect();
        assert_eq!(
            got,
            [
                ("ana@ejemplo.com".to_string(), R::Organizer, S::Accepted),
                ("luis@ejemplo.com".to_string(), R::Required, S::Tentative),
                ("eva@ejemplo.com".to_string(), R::Optional, S::Declined),
            ]
        );
        assert_eq!(ev.attendees[1].name, "Luis; el jefe");

        // JSON conserva también a quien no tiene correo.
        let text = json::write(&items, &[], &cals, &[]).unwrap();
        let (c3, _) = db();
        apply(
            &c3,
            json::parse(&text).unwrap(),
            &ImportTarget::New { name: None },
            "x",
        )
        .unwrap();
        let ev = events::list_range(&c3, base - DAY_MS, base + DAY_MS)
            .unwrap()
            .remove(0);
        assert_eq!(ev.attendees.len(), 4);
        assert_eq!(ev.attendees[3].name, "Sin correo");
    }

    #[test]
    fn parses_google_style_attendees() {
        let text = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:g1\r\nDTSTART:20261110T150000Z\r\n\
                    DTEND:20261110T160000Z\r\nSUMMARY:Sync\r\nORGANIZER;CN=yo@gmail.com:mailto:yo@gmail.com\r\n\
                    ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=yo@gmail.com;\r\n \
                    X-NUM-GUESTS=0:mailto:yo@gmail.com\r\nATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;\r\n \
                    PARTSTAT=NEEDS-ACTION;CN=Otra Persona;X-NUM-GUESTS=0:MAILTO:Otra@Ejemplo.com\r\n\
                    END:VEVENT\r\nEND:VCALENDAR\r\n";
        let b = ics::parse(text, "UTC").unwrap();
        let a = &b.events[0].attendees;
        assert_eq!(a.len(), 2, "el organizador no se repite como asistente");
        assert_eq!(a[1].email, "otra@ejemplo.com");
        assert_eq!(a[1].name, "Otra Persona");
    }
}

#[cfg(test)]
mod serde_tests {
    use super::ImportTarget;

    #[test]
    fn import_target_uses_camel_case() {
        let t: ImportTarget =
            serde_json::from_str(r#"{"kind":"existing","calendarId":"abc"}"#).unwrap();
        assert!(matches!(t, ImportTarget::Existing { calendar_id } if calendar_id == "abc"));
        let t: ImportTarget = serde_json::from_str(r#"{"kind":"new","name":null}"#).unwrap();
        assert!(matches!(t, ImportTarget::New { name: None }));
    }
}
