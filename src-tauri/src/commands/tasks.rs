use crate::errors::CommandResult;
use crate::state::AppState;
use chronos_core::models::{NewTask, Task, TaskPatch};
use chronos_core::repositories::tasks;
use tauri::State;

#[tauri::command]
pub async fn tasks_list(state: State<'_, AppState>) -> CommandResult<Vec<Task>> {
    state.with_vault(|v| tasks::list(v.session()?.conn())).await
}

#[tauri::command]
pub async fn tasks_create(state: State<'_, AppState>, input: NewTask) -> CommandResult<Task> {
    state
        .with_vault(move |v| tasks::create(v.session()?.conn(), &input))
        .await
}

#[tauri::command]
pub async fn tasks_update(
    state: State<'_, AppState>,
    id: String,
    patch: TaskPatch,
) -> CommandResult<Task> {
    state
        .with_vault(move |v| tasks::update(v.session()?.conn(), &id, &patch))
        .await
}

#[tauri::command]
pub async fn tasks_delete(state: State<'_, AppState>, id: String) -> CommandResult<Task> {
    state
        .with_vault(move |v| tasks::delete(v.session()?.conn(), &id))
        .await
}

#[tauri::command]
pub async fn tasks_restore(state: State<'_, AppState>, task: Task) -> CommandResult<Task> {
    state
        .with_vault(move |v| tasks::restore(v.session()?.conn(), &task))
        .await
}

#[tauri::command]
pub async fn tasks_delete_completed(state: State<'_, AppState>) -> CommandResult<usize> {
    state
        .with_vault(|v| tasks::delete_completed(v.session()?.conn()))
        .await
}
