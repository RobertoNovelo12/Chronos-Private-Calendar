//! Formato JSON propio de Chronos (legible y completo, sin cifrar).

use super::{ExportItem, ImportBatch, ImportEvent};
use crate::error::{CoreError, Result};
use crate::models::event::{Availability, EventLink, EventStatus, Visibility};
use crate::models::Calendar;
use crate::recurrence;
use serde::{Deserialize, Serialize};

pub const FORMAT_TAG: &str = "chronos-export";
pub const FORMAT_VERSION: u32 = 1;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Doc {
    format: String,
    version: u32,
    #[serde(default)]
    exported_at: i64,
    #[serde(default)]
    app_version: String,
    #[serde(default)]
    calendars: Vec<CalDoc>,
    #[serde(default)]
    events: Vec<EventDoc>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CalDoc {
    name: String,
    #[serde(default)]
    color: Option<String>,
    #[serde(default)]
    description: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EventDoc {
    #[serde(default)]
    uid: Option<String>,
    #[serde(default)]
    calendar: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    location: String,
    #[serde(default)]
    links: Vec<EventLink>,
    start_at: i64,
    end_at: i64,
    #[serde(default = "utc")]
    timezone: String,
    #[serde(default)]
    is_all_day: bool,
    #[serde(default)]
    availability: Option<Availability>,
    #[serde(default)]
    visibility: Option<Visibility>,
    #[serde(default)]
    status: Option<EventStatus>,
    #[serde(default)]
    recurrence: Option<String>,
    #[serde(default)]
    reminders: Vec<i32>,
    #[serde(default)]
    exdates: Vec<i64>,
    #[serde(default)]
    recurrence_id: Option<i64>,
}

fn utc() -> String {
    "UTC".into()
}

pub fn write(items: &[ExportItem], calendars: &[Calendar]) -> Result<String> {
    let doc = Doc {
        format: FORMAT_TAG.into(),
        version: FORMAT_VERSION,
        exported_at: crate::database::now_ms(),
        app_version: crate::APP_VERSION.into(),
        calendars: calendars
            .iter()
            .map(|c| CalDoc {
                name: c.name.clone(),
                color: Some(c.color.clone()),
                description: c.description.clone(),
            })
            .collect(),
        events: items
            .iter()
            .map(|it| {
                let e = &it.event;
                let series = e.recurrence.is_some() && e.recurrence_master_id.is_none();
                EventDoc {
                    uid: Some(it.uid.clone()),
                    calendar: it.calendar_name.clone(),
                    title: e.title.clone(),
                    description: e.description.clone(),
                    location: e.location.clone(),
                    links: e.links.clone(),
                    start_at: e.start_at,
                    end_at: e.end_at,
                    timezone: e.timezone.clone(),
                    is_all_day: e.is_all_day,
                    availability: Some(e.availability),
                    visibility: Some(e.visibility),
                    status: Some(e.status),
                    recurrence: if series { e.recurrence.clone() } else { None },
                    reminders: e.reminders.clone(),
                    exdates: it.exdates.clone(),
                    recurrence_id: it.recurrence_id.as_ref().map(|r| r.0),
                }
            })
            .collect(),
    };
    serde_json::to_string_pretty(&doc)
        .map_err(|e| CoreError::Validation(format!("no se pudo generar el JSON: {e}")))
}

pub fn parse(text: &str) -> Result<Vec<ImportBatch>> {
    let doc: Doc = serde_json::from_str(text).map_err(|_| {
        CoreError::Validation(
            "el archivo JSON no tiene el formato de exportación de Chronos".into(),
        )
    })?;
    if doc.format != FORMAT_TAG {
        return Err(CoreError::Validation(
            "el archivo JSON no es una exportación de Chronos".into(),
        ));
    }
    if doc.version > FORMAT_VERSION {
        return Err(CoreError::Validation(
            "la exportación es de una versión más nueva de Chronos".into(),
        ));
    }
    if doc.events.len() > super::MAX_IMPORT_EVENTS {
        return Err(CoreError::Validation(
            "el archivo tiene demasiados eventos".into(),
        ));
    }
    // Un lote por calendario, en el orden en que aparecen.
    let mut batches: Vec<ImportBatch> = doc
        .calendars
        .iter()
        .map(|c| ImportBatch {
            calendar_name: Some(c.name.clone()),
            calendar_color: c.color.clone(),
            ..Default::default()
        })
        .collect();
    for e in doc.events {
        let idx = match batches
            .iter()
            .position(|b| b.calendar_name.as_deref() == Some(e.calendar.as_str()))
        {
            Some(i) => i,
            None => {
                batches.push(ImportBatch {
                    calendar_name: Some(if e.calendar.is_empty() {
                        "Importado".into()
                    } else {
                        e.calendar.clone()
                    }),
                    ..Default::default()
                });
                batches.len() - 1
            }
        };
        let b = &mut batches[idx];
        let recurrence = match e.recurrence.as_deref().filter(|r| !r.trim().is_empty()) {
            Some(r) => match recurrence::validate_rule(r) {
                Ok(v) => Some(v),
                Err(_) => {
                    b.rules_dropped += 1;
                    None
                }
            },
            None => None,
        };
        b.events.push(ImportEvent {
            uid: e.uid.filter(|u| !u.trim().is_empty()),
            title: e.title,
            description: e.description,
            location: e.location,
            links: e.links,
            start_at: e.start_at,
            end_at: e.end_at,
            timezone: e.timezone,
            is_all_day: e.is_all_day,
            availability: e.availability,
            visibility: e.visibility,
            status: e.status,
            recurrence,
            reminders: e.reminders,
            exdates: e.exdates,
            recurrence_id: e.recurrence_id,
        });
    }
    batches.retain(|b| !b.events.is_empty());
    Ok(batches)
}
