//! Capa de escritorio de Chronos: inicializa Tauri, resuelve la carpeta de
//! datos y expone los comandos. Toda la lógica vive en `chronos-core`.

mod backups;
mod commands;
mod errors;
mod i18n;
mod notifier;
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
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        // Solo para abrir la página de donaciones desde Rust (URL fija); el
        // frontend no tiene permisos `opener:*`.
        .plugin(tauri_plugin_opener::init())
        // Actualizaciones: solo desde los comandos `update_*` de Rust, cuando el
        // usuario lo pide; el frontend no tiene permisos `updater:*`.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(commands::update::PendingUpdate::default())
        .setup(|app| {
            // Carpeta LOCAL (no "roaming"): en Windows, %LOCALAPPDATA% no se
            // sincroniza con perfiles móviles del dominio.
            let data_dir = app.path().app_local_data_dir()?;
            tracing::info!("carpeta de datos lista");
            let vault = Vault::new(VaultPaths::new(data_dir), KdfParams::RECOMMENDED);
            let state = AppState::new(vault);
            notifier::spawn(app.handle().clone(), state.clone());
            backups::spawn(state.clone());
            app.manage(state);
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
            commands::events::events_list_range,
            commands::events::events_create,
            commands::events::events_update,
            commands::events::events_delete,
            commands::events::events_restore,
            commands::events::events_duplicate,
            commands::events::events_search,
            commands::events::events_snapshot,
            commands::events::events_snapshots,
            commands::events::events_replace_series,
            commands::labels::labels_list,
            commands::labels::labels_create,
            commands::labels::labels_update,
            commands::labels::labels_delete,
            commands::tasks::tasks_list,
            commands::tasks::tasks_create,
            commands::tasks::tasks_update,
            commands::tasks::tasks_delete,
            commands::tasks::tasks_restore,
            commands::tasks::tasks_delete_completed,
            commands::settings::settings_get,
            commands::settings::settings_set,
            commands::backup::backup_create,
            commands::backup::backup_history,
            commands::backup::backup_inspect,
            commands::backup::backup_verify,
            commands::backup::backup_restore,
            commands::data::export_data,
            commands::data::import_pick,
            commands::data::import_apply,
            commands::data::backup_settings_get,
            commands::data::backup_settings_set,
            commands::data::backup_choose_dir,
            commands::data::backup_create_in,
            commands::data::backup_pick_file,
            commands::data::vault_destroy,
            commands::about::app_about,
            commands::about::open_donation_link,
            commands::about::app_set_language,
            commands::update::update_check,
            commands::update::update_install,
        ])
        .run(tauri::generate_context!());

    if let Err(e) = result {
        tracing::error!(error = %e, "la aplicación terminó con error");
        std::process::exit(1);
    }
}
