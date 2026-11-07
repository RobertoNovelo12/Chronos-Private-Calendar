use crate::errors::CommandResult;
use crate::state::AppState;
use chronos_core::backup::{self, BackupInfo, BackupKind, BackupRecord, RestoreReport};
use std::path::PathBuf;
use tauri::State;
use zeroize::Zeroizing;

/// Copia manual en la carpeta predeterminada, cifrada con la contraseña de la app.
#[tauri::command]
pub async fn backup_create(state: State<'_, AppState>) -> CommandResult<BackupRecord> {
    state
        .with_vault(|v| v.create_backup(None, BackupKind::Manual))
        .await
}

#[tauri::command]
pub async fn backup_history(state: State<'_, AppState>) -> CommandResult<Vec<BackupRecord>> {
    state
        .with_vault(|v| backup::history(v.session()?.conn(), 200))
        .await
}

/// Metadatos e integridad de un archivo, sin contraseña.
#[tauri::command]
pub async fn backup_inspect(state: State<'_, AppState>, path: String) -> CommandResult<BackupInfo> {
    state
        .with_vault(move |v| {
            v.session()?;
            backup::inspect_backup(&PathBuf::from(path))
        })
        .await
}

#[tauri::command]
pub async fn backup_verify(
    state: State<'_, AppState>,
    path: String,
    password: Zeroizing<String>,
) -> CommandResult<BackupInfo> {
    state
        .with_vault(move |v| {
            v.session()?;
            backup::verify_backup(&PathBuf::from(path), &password)
        })
        .await
}

#[tauri::command]
pub async fn backup_restore(
    state: State<'_, AppState>,
    path: String,
    password: Zeroizing<String>,
    confirm_overwrite: bool,
) -> CommandResult<RestoreReport> {
    state
        .with_vault(move |v| v.restore_backup(&PathBuf::from(path), &password, confirm_overwrite))
        .await
}
