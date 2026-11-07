use crate::error::{CoreError, Result};
use serde::{Deserialize, Serialize};

/// Calendario tal como se envía al frontend (camelCase).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Calendar {
    pub id: String,
    pub name: String,
    pub color: String,
    pub description: String,
    pub is_visible: bool,
    pub is_default: bool,
    pub sort_order: i64,
    /// Milisegundos UTC.
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewCalendar {
    pub name: String,
    pub color: String,
    #[serde(default)]
    pub description: Option<String>,
}

/// Cambios parciales: los campos `None` no se modifican.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarPatch {
    pub name: Option<String>,
    pub color: Option<String>,
    pub description: Option<String>,
    pub is_visible: Option<bool>,
}

pub const MAX_NAME_CHARS: usize = 200;
pub const MAX_DESCRIPTION_CHARS: usize = 5000;

pub fn normalize_name(name: &str) -> Result<String> {
    let n = name.trim();
    let count = n.chars().count();
    if count == 0 {
        return Err(CoreError::Validation(
            "el nombre del calendario no puede estar vacío".into(),
        ));
    }
    if count > MAX_NAME_CHARS {
        return Err(CoreError::Validation(format!(
            "el nombre no puede superar {MAX_NAME_CHARS} caracteres"
        )));
    }
    Ok(n.to_string())
}

/// Acepta `#RRGGBB` y lo normaliza a minúsculas.
pub fn normalize_color(color: &str) -> Result<String> {
    let c = color.trim();
    let valid =
        c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|ch| ch.is_ascii_hexdigit());
    if !valid {
        return Err(CoreError::Validation(
            "el color debe tener el formato #RRGGBB".into(),
        ));
    }
    Ok(c.to_ascii_lowercase())
}

pub fn normalize_description(description: &str) -> Result<String> {
    if description.chars().count() > MAX_DESCRIPTION_CHARS {
        return Err(CoreError::Validation(format!(
            "la descripción no puede superar {MAX_DESCRIPTION_CHARS} caracteres"
        )));
    }
    Ok(description.to_string())
}
