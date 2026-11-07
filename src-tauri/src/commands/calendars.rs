use crate::errors::CommandResult;
use crate::state::AppState;
use chronos_core::models::{Calendar, CalendarPatch, NewCalendar};
use chronos_core::repositories::calendars;
use tauri::State;

#[tauri::command]
pub async fn calendars_list(state: State<'_, AppState>) -> CommandResult<Vec<Calendar>> {
    state
        .with_vault(|v| calendars::list(v.session()?.conn()))
        .await
}

#[tauri::command]
pub async fn calendars_create(
    state: State<'_, AppState>,
    input: NewCalendar,
) -> CommandResult<Calendar> {
    state
        .with_vault(move |v| calendars::create(v.session()?.conn(), &input))
        .await
}

#[tauri::command]
pub async fn calendars_update(
    state: State<'_, AppState>,
    id: String,
    patch: CalendarPatch,
) -> CommandResult<Calendar> {
    state
        .with_vault(move |v| calendars::update(v.session()?.conn(), &id, &patch))
        .await
}

#[tauri::command]
pub async fn calendars_delete(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    state
        .with_vault(move |v| calendars::delete(v.session_mut()?.conn_mut(), &id))
        .await
}

#[tauri::command]
pub async fn calendars_set_default(
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<Calendar> {
    state
        .with_vault(move |v| calendars::set_default(v.session_mut()?.conn_mut(), &id))
        .await
}

#[tauri::command]
pub async fn calendars_reorder(
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> CommandResult<Vec<Calendar>> {
    state
        .with_vault(move |v| calendars::reorder(v.session_mut()?.conn_mut(), &ids))
        .await
}
