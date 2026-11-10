//! Actualizaciones en línea: la ÚNICA conexión de red de Chronos.
//!
//! * Solo ocurre cuando el usuario la pide (botón en «Acerca de») o si activa
//!   expresamente la comprobación diaria. Por defecto está desactivada.
//! * Solo se consulta `latest.json` de los Releases del repositorio oficial
//!   (dirección fija en `tauri.conf.json`) y solo se descarga desde ese mismo
//!   repositorio. No se envía ningún dato del usuario: es una descarga anónima
//!   (GitHub ve la dirección IP, como cualquier web).
//! * El paquete descargado se verifica con la clave pública incluida en la app
//!   (minisign) antes de instalarlo. Un archivo sin firma válida se rechaza.
//! * El frontend no tiene permisos `updater:*`: solo puede llamar a estos dos
//!   comandos, que no aceptan direcciones ni parámetros.

use crate::errors::{CommandError, CommandResult};
use crate::state::AppState;
use chronos_core::backup::BackupKind;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Error as UpdaterError, Update, UpdaterExt};

/// Prefijo obligatorio de cualquier descarga (Releases del repositorio oficial).
pub const DOWNLOAD_PREFIX: &str =
    "https://github.com/RobertoNovelo12/Chronos-Private-Calendar/releases/download/";

/// Actualización encontrada y pendiente de instalar.
#[derive(Default)]
pub struct PendingUpdate(pub Mutex<Option<Update>>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    /// Fecha de publicación (milisegundos UTC) si el servidor la indica.
    pub date: Option<i64>,
    /// Notas de la versión (texto plano o Markdown del Release).
    pub notes: Option<String>,
    /// Falso si esta instalación no puede actualizarse sola (p. ej. un .deb).
    pub can_install: bool,
}

fn error(code: &'static str, message: &str) -> CommandError {
    CommandError {
        code,
        message: message.into(),
    }
}

fn map_error(e: &UpdaterError) -> CommandError {
    tracing::warn!(error = %e, "actualizaciones: error");
    match e {
        UpdaterError::Minisign(_) | UpdaterError::Base64(_) | UpdaterError::SignatureUtf8(_) => {
            error(
                "update_signature",
                "la actualización no tiene una firma válida y no se ha instalado",
            )
        }
        UpdaterError::Reqwest(_) | UpdaterError::Network(_) | UpdaterError::ReleaseNotFound => {
            error(
                "update_network",
                "no se pudo conectar con el servidor de actualizaciones",
            )
        }
        UpdaterError::TargetNotFound(_)
        | UpdaterError::TargetsNotFound(_)
        | UpdaterError::UnsupportedArch
        | UpdaterError::UnsupportedOs => error(
            "update_unsupported",
            "no hay una actualización automática para este sistema",
        ),
        _ => error("update_failed", "no se pudo completar la actualización"),
    }
}

/// En Linux solo se actualiza sola la versión AppImage; los paquetes .deb/.rpm
/// se actualizan reinstalando desde la página de Releases.
fn can_self_install() -> bool {
    if cfg!(target_os = "linux") {
        std::env::var_os("APPIMAGE").is_some()
    } else {
        true
    }
}

/// Consulta si hay una versión más reciente. No descarga nada todavía.
#[tauri::command]
pub async fn update_check(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
) -> CommandResult<Option<UpdateInfo>> {
    tracing::info!("actualizaciones: comprobando (pedido por el usuario)");
    let updater = app.updater().map_err(|e| map_error(&e))?;
    let found = updater.check().await.map_err(|e| map_error(&e))?;
    let mut slot = pending.0.lock().unwrap_or_else(|p| p.into_inner());
    let Some(update) = found else {
        *slot = None;
        return Ok(None);
    };
    if !update.download_url.as_str().starts_with(DOWNLOAD_PREFIX) {
        *slot = None;
        return Err(error(
            "update_signature",
            "la actualización no procede del repositorio oficial",
        ));
    }
    let info = UpdateInfo {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        date: update.date.map(|d| d.unix_timestamp() * 1000),
        notes: update.body.clone(),
        can_install: can_self_install(),
    };
    *slot = Some(update);
    Ok(Some(info))
}

/// Descarga, verifica la firma e instala la actualización encontrada; después
/// reinicia la aplicación. Antes guarda una copia cifrada si la app está desbloqueada.
#[tauri::command]
pub async fn update_install(
    app: AppHandle,
    state: State<'_, AppState>,
    pending: State<'_, PendingUpdate>,
) -> CommandResult<()> {
    if !can_self_install() {
        return Err(error(
            "update_unsupported",
            "no hay una actualización automática para este sistema",
        ));
    }
    let update = pending
        .0
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .take()
        .ok_or_else(|| error("update_failed", "primero busca actualizaciones"))?;

    // Copia de seguridad con la versión actual (si está bloqueada, no hay datos
    // abiertos). Sin copia no se instala: el usuario puede reintentar.
    state
        .with_vault(|v| {
            if v.session().is_ok() {
                v.create_backup(None, BackupKind::PreUpdate).map(Some)
            } else {
                Ok(None)
            }
        })
        .await?;

    tracing::info!(version = %update.version, "actualizaciones: descargando e instalando");
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| map_error(&e))?;
    tracing::info!("actualizaciones: instalada; reiniciando");
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downloads_only_from_official_releases() {
        assert!(DOWNLOAD_PREFIX.starts_with("https://github.com/"));
        assert!(DOWNLOAD_PREFIX.ends_with("/releases/download/"));
        assert!(crate::commands::about::REPOSITORY_URL
            .starts_with(DOWNLOAD_PREFIX.trim_end_matches("/releases/download/")));
    }

    #[test]
    fn errors_are_classified_without_details() {
        let e = map_error(&UpdaterError::ReleaseNotFound);
        assert_eq!(e.code, "update_network");
        let e = map_error(&UpdaterError::UnsupportedOs);
        assert_eq!(e.code, "update_unsupported");
        let e = map_error(&UpdaterError::SignatureUtf8("x".into()));
        assert_eq!(e.code, "update_signature");
    }
}
