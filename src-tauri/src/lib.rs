//! Capa de escritorio de Chronos: inicializa Tauri, resuelve la carpeta de
//! datos y expone los comandos. Toda la lógica vive en `chronos-core`.

mod backups;
mod commands;
mod desktop;
mod errors;
mod i18n;
mod notifier;
mod remember;
mod state;

use chronos_core::crypto::kdf::KdfParams;
use chronos_core::{Vault, VaultPaths};
use desktop::{DesktopSettings, DesktopState};
use state::AppState;
use tauri::{Manager, WindowEvent};
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
        // Una sola instancia: abrir Chronos otra vez muestra la ventana existente
        // (dos procesos con la misma base de datos no deben convivir).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            desktop::show_main(app);
        }))
        // Inicio con el sistema (lo activa el usuario); se abre con `--minimized`.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![desktop::MINIMIZED_ARG]),
        ))
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
            let desktop_path = data_dir.join(desktop::SETTINGS_FILE);
            let settings = DesktopSettings::load(&desktop_path);
            let mut vault = Vault::new(VaultPaths::new(data_dir), KdfParams::RECOMMENDED);

            // Desbloqueo recordado (opcional): solo al arrancar. Si las claves ya
            // no sirven (datos borrados u otra instalación), se olvidan.
            if let Some(secret) = remember::load() {
                if let Err(e) = vault.unlock_with_remembered(&secret) {
                    tracing::warn!(error = %e.code(), "desbloqueo recordado no válido; se olvida");
                    remember::forget();
                }
            }

            let state = AppState::new(vault);
            notifier::spawn(app.handle().clone(), state.clone());
            backups::spawn(state.clone());
            app.manage(state);
            app.manage(DesktopState {
                path: desktop_path,
                settings: std::sync::Mutex::new(settings),
            });

            if let Err(e) = desktop::create_tray(app.handle()) {
                // Sin bandeja (p. ej. un escritorio Linux sin soporte) no se oculta al cerrar.
                tracing::warn!(error = %e, "no se pudo crear el icono de la bandeja");
            }
            let args: Vec<String> = std::env::args().collect();
            if !desktop::start_hidden(&args, settings) {
                desktop::show_main(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Cerrar la ventana la oculta en la bandeja (si está activado y hay bandeja).
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let to_tray = app
                    .try_state::<DesktopState>()
                    .map(|d| d.get().close_to_tray)
                    .unwrap_or(false)
                    && app.tray_by_id(desktop::TRAY_ID).is_some();
                if to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
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
            commands::desktop::desktop_settings_get,
            commands::desktop::desktop_settings_set,
            commands::desktop::remember_unlock_enable,
            commands::desktop::remember_unlock_disable,
            commands::update::update_check,
            commands::update::update_install,
        ])
        .run(tauri::generate_context!());

    if let Err(e) = result {
        tracing::error!(error = %e, "la aplicación terminó con error");
        std::process::exit(1);
    }
}
