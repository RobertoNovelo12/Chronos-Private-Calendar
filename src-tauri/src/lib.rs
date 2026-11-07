//! Capa de escritorio de Chronos: inicializa Tauri, resuelve la carpeta de
//! datos y expone los comandos. Toda la lógica vive en `chronos-core`.

mod commands;
mod errors;
mod state;

use chronos_core::crypto::kdf::KdfParams;
use chronos_core::{Vault, VaultPaths};
use state::AppState;
use tauri::Manager;
use tracing_subscriber::EnvFilter;

fn init_logging() {
    // Logs solo locales (salida estándar). Nunca contienen títulos, descripciones,
    // contraseñas ni claves: los módulos registran únicamente identificadores,
    // recuentos y códigos de error.
    let filter = EnvFilter::try_from_env("CHRONOS_LOG").unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_logging();

    let result = tauri::Builder::default()
        .setup(|app| {
            // Carpeta LOCAL (no "roaming"): en Windows, %LOCALAPPDATA% no se
            // sincroniza con perfiles móviles del dominio.
            let data_dir = app.path().app_local_data_dir()?;
            tracing::info!("carpeta de datos lista");
            let vault = Vault::new(VaultPaths::new(data_dir), KdfParams::RECOMMENDED);
            app.manage(AppState::new(vault));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::vault::vault_status,
            commands::vault::vault_setup,
            commands::vault::vault_unlock,
            commands::vault::vault_lock,
            commands::vault::vault_change_password,
            commands::calendars::calendars_list,
            commands::calendars::calendars_create,
            commands::calendars::calendars_update,
            commands::calendars::calendars_delete,
            commands::calendars::calendars_set_default,
            commands::calendars::calendars_reorder,
            commands::backup::backup_create,
            commands::backup::backup_history,
            commands::backup::backup_inspect,
            commands::backup::backup_verify,
            commands::backup::backup_restore,
        ])
        .run(tauri::generate_context!());

    if let Err(e) = result {
        tracing::error!(error = %e, "la aplicación terminó con error");
        std::process::exit(1);
    }
}
