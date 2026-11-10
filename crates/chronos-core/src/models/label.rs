//! Etiquetas: marcas de color que se asignan a eventos (varias por evento).

use crate::error::{CoreError, Result};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Label {
    pub id: String,
    pub name: String,
    pub color: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewLabel {
    pub name: String,
    pub color: String,
}

/// Cambios parciales: los campos `None` no se modifican.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelPatch {
    pub name: Option<String>,
    pub color: Option<String>,
}

pub const MAX_LABEL_NAME_CHARS: usize = 100;
/// Máximo de etiquetas en un evento.
pub const MAX_LABELS_PER_EVENT: usize = 20;
/// Máximo de etiquetas en total.
pub const MAX_LABELS: i64 = 500;

pub fn normalize_label_name(name: &str) -> Result<String> {
    let n = name.trim();
    let count = n.chars().count();
    if count == 0 {
        return Err(CoreError::Validation(
            "el nombre de la etiqueta no puede estar vacío".into(),
        ));
    }
    if count > MAX_LABEL_NAME_CHARS {
        return Err(CoreError::Validation(format!(
            "el nombre de la etiqueta no puede superar {MAX_LABEL_NAME_CHARS} caracteres"
        )));
    }
    Ok(n.to_string())
}

/// Elimina duplicados conservando el orden y limita la cantidad.
pub fn normalize_label_ids(ids: &[String]) -> Result<Vec<String>> {
    let mut out: Vec<String> = Vec::with_capacity(ids.len());
    for id in ids {
        let id = id.trim();
        if !id.is_empty() && !out.iter().any(|x| x == id) {
            out.push(id.to_string());
        }
    }
    if out.len() > MAX_LABELS_PER_EVENT {
        return Err(CoreError::Validation(format!(
            "máximo {MAX_LABELS_PER_EVENT} etiquetas por evento"
        )));
    }
    Ok(out)
}
