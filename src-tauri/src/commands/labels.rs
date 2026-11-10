use crate::errors::CommandResult;
use crate::state::AppState;
use chronos_core::models::{Label, LabelPatch, NewLabel};
use chronos_core::repositories::labels;
use tauri::State;

#[tauri::command]
pub async fn labels_list(state: State<'_, AppState>) -> CommandResult<Vec<Label>> {
    state
        .with_vault(|v| labels::list(v.session()?.conn()))
        .await
}

#[tauri::command]
pub async fn labels_create(state: State<'_, AppState>, input: NewLabel) -> CommandResult<Label> {
    state
        .with_vault(move |v| labels::create(v.session()?.conn(), &input))
        .await
}

#[tauri::command]
pub async fn labels_update(
    state: State<'_, AppState>,
    id: String,
    patch: LabelPatch,
) -> CommandResult<Label> {
    state
        .with_vault(move |v| labels::update(v.session()?.conn(), &id, &patch))
        .await
}

#[tauri::command]
pub async fn labels_delete(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    state
        .with_vault(move |v| labels::delete(v.session()?.conn(), &id))
        .await
}
