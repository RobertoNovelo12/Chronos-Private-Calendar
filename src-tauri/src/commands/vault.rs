use crate::errors::CommandResult;
use crate::state::AppState;
use chronos_core::VaultStatus;
use tauri::State;
use zeroize::Zeroizing;

#[tauri::command]
pub async fn vault_status(state: State<'_, AppState>) -> CommandResult<VaultStatus> {
    state.with_vault(|v| Ok(v.status())).await
}

#[tauri::command]
pub async fn vault_setup(
    state: State<'_, AppState>,
    password: Zeroizing<String>,
) -> CommandResult<VaultStatus> {
    state
        .with_vault(move |v| {
            v.setup(&password)?;
            Ok(v.status())
        })
        .await
}

#[tauri::command]
pub async fn vault_unlock(
    state: State<'_, AppState>,
    password: Zeroizing<String>,
) -> CommandResult<VaultStatus> {
    state
        .with_vault(move |v| {
            v.unlock(&password)?;
            Ok(v.status())
        })
        .await
}

#[tauri::command]
pub async fn vault_lock(state: State<'_, AppState>) -> CommandResult<VaultStatus> {
    state
        .with_vault(|v| {
            v.lock();
            Ok(v.status())
        })
        .await
}

#[tauri::command]
pub async fn vault_change_password(
    state: State<'_, AppState>,
    current: Zeroizing<String>,
    new_password: Zeroizing<String>,
) -> CommandResult<()> {
    state
        .with_vault(move |v| v.change_password(&current, &new_password))
        .await?;
    // Si el desbloqueo está recordado, se guarda la clave de copias nueva.
    super::desktop::refresh_remembered(&state).await;
    Ok(())
}
