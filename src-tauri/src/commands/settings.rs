use crate::errors::{CommandError, CommandResult};
use crate::state::AppState;
use chronos_core::repositories::settings;
use serde_json::Value;
use tauri::State;

/// Claves que el frontend puede leer y escribir.
const ALLOWED: &[&str] = &[settings::NOTIFICATIONS_SHOW_DETAILS];

fn check(key: &str) -> CommandResult<()> {
    if ALLOWED.contains(&key) {
        Ok(())
    } else {
        Err(CommandError {
            code: "validation",
            message: "ajuste desconocido".into(),
        })
    }
}

#[tauri::command]
pub async fn settings_get(state: State<'_, AppState>, key: String) -> CommandResult<Option<Value>> {
    check(&key)?;
    state
        .with_vault(move |v| settings::get(v.session()?.conn(), &key))
        .await
}

#[tauri::command]
pub async fn settings_set(
    state: State<'_, AppState>,
    key: String,
    value: Value,
) -> CommandResult<()> {
    check(&key)?;
    state
        .with_vault(move |v| settings::set(v.session()?.conn(), &key, &value))
        .await
}
