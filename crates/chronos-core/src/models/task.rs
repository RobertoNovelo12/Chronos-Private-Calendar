//! Tareas: pendientes con fecha de vencimiento opcional.

use crate::error::{CoreError, Result};
use crate::models::event::DAY_MS;
use serde::{Deserialize, Deserializer, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    /// Calendario al que pertenece (color y visibilidad); `None` = sin calendario.
    pub calendar_id: Option<String>,
    pub title: String,
    pub notes: String,
    /// Vencimiento (ms UTC). En tareas de día completo: medianoche UTC de la fecha.
    pub due_at: Option<i64>,
    pub is_all_day: bool,
    /// 0 = ninguna, 1 = baja, 2 = media, 3 = alta.
    pub priority: u8,
    pub completed_at: Option<i64>,
    pub sort_order: i64,
    /// Minutos antes del vencimiento.
    pub reminders: Vec<i32>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewTask {
    #[serde(default)]
    pub calendar_id: Option<String>,
    pub title: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub due_at: Option<i64>,
    #[serde(default)]
    pub is_all_day: bool,
    #[serde(default)]
    pub priority: u8,
    #[serde(default)]
    pub reminders: Vec<i32>,
    /// Ya completada (solo importación).
    #[serde(skip)]
    pub completed_at: Option<i64>,
    /// UID de iCalendar (solo importación).
    #[serde(skip)]
    pub ical_uid: Option<String>,
}

/// Distingue «campo ausente» (`None`) de «campo a null» (`Some(None)`).
fn double_option<'de, T, D>(d: D) -> std::result::Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Option::<T>::deserialize(d).map(Some)
}

/// Cambios parciales. `dueAt: null` quita la fecha; `calendarId: null` quita el calendario.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPatch {
    #[serde(default, deserialize_with = "double_option")]
    pub calendar_id: Option<Option<String>>,
    pub title: Option<String>,
    pub notes: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    pub due_at: Option<Option<i64>>,
    pub is_all_day: Option<bool>,
    pub priority: Option<u8>,
    pub reminders: Option<Vec<i32>>,
    /// Marca o desmarca como completada.
    pub completed: Option<bool>,
}

pub const MAX_TASK_TITLE_CHARS: usize = 1000;
pub const MAX_TASK_NOTES_CHARS: usize = 50_000;
/// Máximo de tareas en total.
pub const MAX_TASKS: i64 = 20_000;

pub fn normalize_task_title(title: &str) -> Result<String> {
    let t = title.trim();
    if t.is_empty() {
        return Err(CoreError::Validation("la tarea necesita un título".into()));
    }
    if t.chars().count() > MAX_TASK_TITLE_CHARS {
        return Err(CoreError::Validation(format!(
            "título: máximo {MAX_TASK_TITLE_CHARS} caracteres"
        )));
    }
    Ok(t.to_string())
}

pub fn validate_task_notes(notes: &str) -> Result<()> {
    if notes.chars().count() > MAX_TASK_NOTES_CHARS {
        return Err(CoreError::Validation(format!(
            "notas: máximo {MAX_TASK_NOTES_CHARS} caracteres"
        )));
    }
    Ok(())
}

pub fn validate_priority(p: u8) -> Result<()> {
    if p > 3 {
        return Err(CoreError::Validation("prioridad fuera de rango".into()));
    }
    Ok(())
}

/// Una tarea de día completo vence a medianoche UTC (fecha flotante).
pub fn validate_due(due_at: Option<i64>, is_all_day: bool) -> Result<()> {
    if let Some(d) = due_at {
        if is_all_day && d % DAY_MS != 0 {
            return Err(CoreError::Validation(
                "una tarea de día completo debe vencer en una fecha sin hora".into(),
            ));
        }
        // Años 1900–2200, para rechazar valores absurdos.
        if !(-2_208_988_800_000..=7_258_118_400_000).contains(&d) {
            return Err(CoreError::Validation(
                "fecha de vencimiento no válida".into(),
            ));
        }
    }
    Ok(())
}
