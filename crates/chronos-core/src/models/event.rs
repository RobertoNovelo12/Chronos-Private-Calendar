//! Eventos del calendario.

use crate::error::{CoreError, Result};
use serde::{Deserialize, Serialize};

/// Un día en milisegundos.
pub const DAY_MS: i64 = 86_400_000;
/// Duración máxima de un evento (≈ 5 años), para rechazar valores absurdos.
pub const MAX_DURATION_MS: i64 = 5 * 366 * DAY_MS;
/// Rango máximo de una consulta por fechas.
pub const MAX_RANGE_MS: i64 = 400 * DAY_MS;

pub const MAX_TITLE_CHARS: usize = 1000;
pub const MAX_DESCRIPTION_CHARS: usize = 50_000;
pub const MAX_LOCATION_CHARS: usize = 1000;
pub const MAX_LINKS: usize = 20;
pub const MAX_LINK_LABEL_CHARS: usize = 200;
pub const MAX_URL_CHARS: usize = 2048;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Visibility {
    Default,
    Public,
    Private,
    Confidential,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Availability {
    Busy,
    Free,
    Tentative,
    OutOfOffice,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventStatus {
    Confirmed,
    Tentative,
    Cancelled,
}

macro_rules! sql_enum {
    ($t:ty { $($variant:ident => $s:literal),+ $(,)? }) => {
        impl $t {
            pub fn as_str(&self) -> &'static str {
                match self { $(Self::$variant => $s),+ }
            }
            pub fn parse(s: &str) -> Result<Self> {
                match s {
                    $($s => Ok(Self::$variant),)+
                    _ => Err(CoreError::Validation(format!("valor desconocido: {s}"))),
                }
            }
        }
    };
}

sql_enum!(Visibility { Default => "default", Public => "public", Private => "private", Confidential => "confidential" });
sql_enum!(Availability { Busy => "busy", Free => "free", Tentative => "tentative", OutOfOffice => "out_of_office" });
sql_enum!(EventStatus { Confirmed => "confirmed", Tentative => "tentative", Cancelled => "cancelled" });

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EventLink {
    #[serde(default)]
    pub label: String,
    pub url: String,
}

/// Evento tal como lo recibe el frontend.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: String,
    pub calendar_id: String,
    pub title: String,
    pub description: String,
    pub location: String,
    pub links: Vec<EventLink>,
    /// Color propio; `None` = el del calendario.
    pub color: Option<String>,
    /// Milisegundos UTC. En eventos de día completo: medianoche UTC de la fecha.
    pub start_at: i64,
    /// Exclusivo.
    pub end_at: i64,
    /// Zona IANA en la que se creó el evento.
    pub timezone: String,
    pub is_all_day: bool,
    pub visibility: Visibility,
    pub availability: Availability,
    pub status: EventStatus,
    /// Ocurrencia (o excepción) de una serie.
    pub is_recurring: bool,
    /// Serie a la que pertenece una ocurrencia o una excepción modificada.
    pub recurrence_master_id: Option<String>,
    /// Inicio original de la ocurrencia dentro de la serie.
    pub original_start_at: Option<i64>,
    /// Regla RRULE de la serie (también en ocurrencias y excepciones).
    pub recurrence: Option<String>,
    /// Recordatorios: minutos antes del inicio.
    pub reminders: Vec<i32>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Alcance de una edición o eliminación sobre un evento repetido.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EditScope {
    /// Solo esta ocurrencia.
    #[default]
    This,
    /// Esta y las siguientes.
    Following,
    /// Toda la serie.
    All,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewEvent {
    pub calendar_id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub links: Vec<EventLink>,
    #[serde(default)]
    pub color: Option<String>,
    pub start_at: i64,
    pub end_at: i64,
    pub timezone: String,
    #[serde(default)]
    pub is_all_day: bool,
    #[serde(default)]
    pub visibility: Option<Visibility>,
    #[serde(default)]
    pub availability: Option<Availability>,
    /// RRULE (sin prefijo) para crear una serie.
    #[serde(default)]
    pub recurrence: Option<String>,
    #[serde(default)]
    pub reminders: Vec<i32>,
    /// UID de iCalendar (solo importación; el frontend no lo envía).
    #[serde(skip)]
    pub ical_uid: Option<String>,
}

/// Cambios parciales. `color: Some("")` elimina el color propio.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventPatch {
    pub calendar_id: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub location: Option<String>,
    pub links: Option<Vec<EventLink>>,
    pub color: Option<String>,
    pub start_at: Option<i64>,
    pub end_at: Option<i64>,
    pub timezone: Option<String>,
    pub is_all_day: Option<bool>,
    pub visibility: Option<Visibility>,
    pub availability: Option<Availability>,
    pub status: Option<EventStatus>,
    /// `Some("")` quita la repetición.
    pub recurrence: Option<String>,
    pub reminders: Option<Vec<i32>>,
}

impl EventPatch {
    /// ¿Modifica la hora de inicio o fin?
    pub fn touches_times(&self) -> bool {
        self.start_at.is_some()
            || self.end_at.is_some()
            || self.is_all_day.is_some()
            || self.timezone.is_some()
    }
}

/// Máximo de recordatorios por evento.
pub const MAX_REMINDERS: usize = 10;
/// Máximo adelanto de un recordatorio (4 semanas).
pub const MAX_REMINDER_MINUTES: i32 = 40_320;

/// Ordena, elimina duplicados y valida los recordatorios.
pub fn normalize_reminders(r: &[i32]) -> Result<Vec<i32>> {
    let mut v: Vec<i32> = r.to_vec();
    v.sort_unstable();
    v.dedup();
    if v.len() > MAX_REMINDERS {
        return Err(CoreError::Validation(format!(
            "máximo {MAX_REMINDERS} recordatorios"
        )));
    }
    if v.iter().any(|m| !(0..=MAX_REMINDER_MINUTES).contains(m)) {
        return Err(CoreError::Validation(
            "recordatorio fuera de rango (0 a 4 semanas)".into(),
        ));
    }
    Ok(v)
}

fn check_len(value: &str, max: usize, field: &str) -> Result<()> {
    if value.chars().count() > max {
        return Err(CoreError::Validation(format!(
            "{field}: máximo {max} caracteres"
        )));
    }
    Ok(())
}

pub fn normalize_title(title: &str) -> Result<String> {
    let t = title.trim();
    check_len(t, MAX_TITLE_CHARS, "título")?;
    Ok(t.to_string())
}

pub fn validate_description(d: &str) -> Result<()> {
    check_len(d, MAX_DESCRIPTION_CHARS, "descripción")
}

pub fn normalize_location(l: &str) -> Result<String> {
    let l = l.trim();
    check_len(l, MAX_LOCATION_CHARS, "ubicación")?;
    Ok(l.to_string())
}

/// Solo esquemas seguros: se evitan `javascript:`, `file:`, `data:`…
pub fn normalize_links(links: &[EventLink]) -> Result<Vec<EventLink>> {
    if links.len() > MAX_LINKS {
        return Err(CoreError::Validation(format!("máximo {MAX_LINKS} enlaces")));
    }
    links
        .iter()
        .map(|l| {
            let url = l.url.trim();
            let lower = url.to_ascii_lowercase();
            let allowed = ["https://", "http://", "mailto:"]
                .iter()
                .any(|p| lower.starts_with(p));
            if !allowed || url.len() > MAX_URL_CHARS || url.chars().any(char::is_whitespace) {
                return Err(CoreError::Validation(
                    "los enlaces deben empezar por https://, http:// o mailto:".into(),
                ));
            }
            check_len(&l.label, MAX_LINK_LABEL_CHARS, "texto del enlace")?;
            Ok(EventLink {
                label: l.label.trim().to_string(),
                url: url.to_string(),
            })
        })
        .collect()
}

pub fn normalize_timezone(tz: &str) -> Result<String> {
    let tz = tz.trim();
    if tz == "UTC" || tz.parse::<chrono_tz::Tz>().is_ok() {
        Ok(tz.to_string())
    } else {
        Err(CoreError::Validation("zona horaria desconocida".into()))
    }
}

/// Valida el intervalo. Los eventos de día completo deben empezar y terminar
/// en medianoche UTC y durar al menos un día.
pub fn validate_times(start_at: i64, end_at: i64, is_all_day: bool) -> Result<()> {
    if end_at < start_at {
        return Err(CoreError::Validation(
            "el fin no puede ser anterior al inicio".into(),
        ));
    }
    if end_at - start_at > MAX_DURATION_MS {
        return Err(CoreError::Validation("el evento es demasiado largo".into()));
    }
    if is_all_day && (start_at % DAY_MS != 0 || end_at % DAY_MS != 0 || end_at <= start_at) {
        return Err(CoreError::Validation(
            "un evento de día completo debe ocupar días enteros".into(),
        ));
    }
    Ok(())
}
