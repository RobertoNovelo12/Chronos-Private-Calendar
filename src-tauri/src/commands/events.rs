use crate::errors::CommandResult;
use crate::state::AppState;
use chronos_core::models::event::EditScope;
use chronos_core::models::{Event, EventPatch, NewEvent};
use chronos_core::repositories::events;
use tauri::State;

/// Eventos que se solapan con `[from, to)` (milisegundos UTC).
#[tauri::command]
pub async fn events_list_range(
    state: State<'_, AppState>,
    from: i64,
    to: i64,
) -> CommandResult<Vec<Event>> {
    state
        .with_vault(move |v| events::list_range(v.session()?.conn(), from, to))
        .await
}

#[tauri::command]
pub async fn events_create(state: State<'_, AppState>, input: NewEvent) -> CommandResult<Event> {
    state
        .with_vault(move |v| events::create(v.session()?.conn(), &input))
        .await
}

/// `scope` solo importa en eventos repetidos (este / siguientes / todos).
#[tauri::command]
pub async fn events_update(
    state: State<'_, AppState>,
    id: String,
    patch: EventPatch,
    scope: Option<EditScope>,
) -> CommandResult<Event> {
    state
        .with_vault(move |v| {
            events::update(v.session()?.conn(), &id, &patch, scope.unwrap_or_default())
        })
        .await
}

/// Devuelve lo eliminado para que el frontend pueda deshacer (eventos simples).
#[tauri::command]
pub async fn events_delete(
    state: State<'_, AppState>,
    id: String,
    scope: Option<EditScope>,
) -> CommandResult<Event> {
    state
        .with_vault(move |v| events::delete(v.session()?.conn(), &id, scope.unwrap_or_default()))
        .await
}

/// Vuelve a crear un evento eliminado con su mismo identificador (deshacer).
#[tauri::command]
pub async fn events_restore(state: State<'_, AppState>, event: Event) -> CommandResult<Event> {
    state
        .with_vault(move |v| events::restore(v.session()?.conn(), &event))
        .await
}

#[tauri::command]
pub async fn events_duplicate(state: State<'_, AppState>, id: String) -> CommandResult<Event> {
    state
        .with_vault(move |v| events::duplicate(v.session()?.conn(), &id))
        .await
}

#[tauri::command]
pub async fn events_search(state: State<'_, AppState>, query: String) -> CommandResult<Vec<Event>> {
    state
        .with_vault(move |v| events::search(v.session()?.conn(), &query, 50))
        .await
}
