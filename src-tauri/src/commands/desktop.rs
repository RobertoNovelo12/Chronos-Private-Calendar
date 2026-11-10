//! Ajustes de escritorio: bandeja, inicio con el sistema y desbloqueo recordado.
//! El frontend no tiene permisos `autostart:*`: todo pasa por estos comandos.

use crate::desktop::{DesktopSettings, DesktopState};
use crate::errors::{CommandError, CommandResult};
use crate::remember;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;
use zeroize::Zeroizing;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopInfo {
    pub close_to_tray: bool,
    pub start_minimized: bool,
    /// Se abre al iniciar sesión en el equipo.
    pub autostart: bool,
    /// El sistema permite recordar el desbloqueo (Windows y macOS).
    pub remember_supported: bool,
    pub remember_enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPatch {
    pub close_to_tray: Option<bool>,
    pub start_minimized: Option<bool>,
    pub autostart: Option<bool>,
}

fn io_error() -> CommandError {
    CommandError {
        code: "io",
        message: "no se pudo guardar el ajuste".into(),
    }
}

fn info(app: &AppHandle, s: DesktopSettings) -> DesktopInfo {
    DesktopInfo {
        close_to_tray: s.close_to_tray,
        start_minimized: s.start_minimized,
        autostart: app.autolaunch().is_enabled().unwrap_or(false),
        remember_supported: remember::supported(),
        remember_enabled: remember::enabled(),
    }
}

#[tauri::command]
pub fn desktop_settings_get(app: AppHandle, desktop: State<'_, DesktopState>) -> DesktopInfo {
    info(&app, desktop.get())
}

#[tauri::command]
pub fn desktop_settings_set(
    app: AppHandle,
    desktop: State<'_, DesktopState>,
    patch: DesktopPatch,
) -> CommandResult<DesktopInfo> {
    let updated = {
        let mut s = desktop.settings.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(v) = patch.close_to_tray {
            s.close_to_tray = v;
        }
        if let Some(v) = patch.start_minimized {
            s.start_minimized = v;
        }
        s.save(&desktop.path).map_err(|_| io_error())?;
        *s
    };
    if let Some(on) = patch.autostart {
        let launcher = app.autolaunch();
        let r = if on {
            launcher.enable()
        } else {
            launcher.disable()
        };
        r.map_err(|e| {
            tracing::warn!(error = %e, "no se pudo cambiar el inicio con el sistema");
            CommandError {
                code: "autostart_failed",
                message: "no se pudo cambiar el inicio con el sistema".into(),
            }
        })?;
    }
    Ok(info(&app, updated))
}

/// Activa el desbloqueo recordado. Exige la app desbloqueada y la contraseña.
#[tauri::command]
pub async fn remember_unlock_enable(
    state: State<'_, AppState>,
    password: Zeroizing<String>,
) -> CommandResult<()> {
    if !remember::supported() {
        return Err(CommandError {
            code: "remember_unsupported",
            message: "este sistema no permite recordar el desbloqueo".into(),
        });
    }
    let secret = state
        .with_vault(move |v| {
            v.verify_password(&password)?;
            v.remembered_secret()
        })
        .await?;
    remember::store(&secret).map_err(|e| {
        tracing::warn!(error = %e, "no se pudo guardar la credencial");
        CommandError {
            code: "remember_failed",
            message: "no se pudo guardar en el almacén de credenciales del sistema".into(),
        }
    })?;
    tracing::info!("desbloqueo recordado activado");
    Ok(())
}

#[tauri::command]
pub fn remember_unlock_disable() {
    remember::forget();
    tracing::info!("desbloqueo recordado desactivado");
}

/// Tras cambiar la contraseña, la clave de copias cambia: se actualiza la credencial.
pub async fn refresh_remembered(state: &AppState) {
    if !remember::enabled() {
        return;
    }
    match state.with_vault(|v| v.remembered_secret()).await {
        Ok(secret) => {
            if remember::store(&secret).is_err() {
                remember::forget();
            }
        }
        Err(_) => remember::forget(),
    }
}
