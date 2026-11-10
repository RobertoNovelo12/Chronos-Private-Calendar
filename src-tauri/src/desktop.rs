//! Integración con el escritorio: bandeja del sistema, cerrar a la bandeja,
//! iniciar con el sistema (minimizado) y una sola instancia.
//!
//! Los ajustes se guardan en `desktop.json`, junto a los datos, sin cifrar:
//! hacen falta antes de desbloquear y no contienen datos del calendario.

use crate::i18n::{self, Key};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub const SETTINGS_FILE: &str = "desktop.json";
/// Argumento con el que el sistema abre Chronos al iniciar sesión.
pub const MINIMIZED_ARG: &str = "--minimized";
pub const TRAY_ID: &str = "main";
/// Evento para que la interfaz limpie su estado tras bloquear desde la bandeja.
pub const LOCKED_EVENT: &str = "chronos://locked";

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct DesktopSettings {
    /// Cerrar la ventana la oculta en la bandeja (la app sigue abierta y desbloqueada).
    pub close_to_tray: bool,
    /// Al iniciar con el sistema, empezar oculto en la bandeja.
    pub start_minimized: bool,
}

impl Default for DesktopSettings {
    fn default() -> Self {
        DesktopSettings {
            // En Linux muchos escritorios no muestran la bandeja: ocultar la
            // ventana dejaría la app sin forma visible de volver a ella.
            close_to_tray: !cfg!(target_os = "linux"),
            start_minimized: true,
        }
    }
}

impl DesktopSettings {
    pub fn load(path: &PathBuf) -> Self {
        std::fs::read(path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &PathBuf) -> std::io::Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(self).unwrap_or_default())?;
        std::fs::rename(tmp, path)
    }
}

/// Ajustes de escritorio en memoria y su archivo.
pub struct DesktopState {
    pub path: PathBuf,
    pub settings: Mutex<DesktopSettings>,
}

impl DesktopState {
    pub fn get(&self) -> DesktopSettings {
        *self.settings.lock().unwrap_or_else(|p| p.into_inner())
    }
}

/// ¿Debe arrancar oculto? Solo si lo abrió el sistema al iniciar sesión.
pub fn start_hidden(args: &[String], settings: DesktopSettings) -> bool {
    settings.start_minimized && args.iter().any(|a| a == MINIMIZED_ARG)
}

/// Muestra y enfoca la ventana principal.
pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "open", i18n::text(Key::TrayOpen), true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "lock", i18n::text(Key::TrayLock), true, None::<&str>)?,
            &MenuItem::with_id(app, "quit", i18n::text(Key::TrayQuit), true, None::<&str>)?,
        ],
    )
}

/// Crea el icono de la bandeja con su menú (Abrir · Bloquear · Salir).
pub fn create_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Chronos")
        .menu(&build_menu(app)?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "lock" => lock_from_tray(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// Vuelve a crear el menú con los textos del idioma actual.
pub fn refresh_tray<R: Runtime>(app: &AppHandle<R>) {
    if let (Some(tray), Ok(menu)) = (app.tray_by_id(TRAY_ID), build_menu(app)) {
        let _ = tray.set_menu(Some(menu));
    }
}

fn lock_from_tray<R: Runtime>(app: &AppHandle<R>) {
    if let Some(state) = app.try_state::<AppState>() {
        let _ = state.with_vault_blocking(|v| {
            v.lock();
            Ok(())
        });
    }
    // La interfaz borra de su memoria los datos que tuviera a la vista.
    let _ = app.emit(LOCKED_EVENT, ());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_and_start_hidden() {
        let d = DesktopSettings::default();
        assert_eq!(d.close_to_tray, !cfg!(target_os = "linux"));
        assert!(d.start_minimized);
        let args = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        // Abierto a mano: siempre visible.
        assert!(!start_hidden(&args(&["chronos"]), d));
        // Abierto por el sistema al iniciar sesión: oculto si así está configurado.
        assert!(start_hidden(&args(&["chronos", MINIMIZED_ARG]), d));
        let visible = DesktopSettings {
            start_minimized: false,
            ..d
        };
        assert!(!start_hidden(&args(&["chronos", MINIMIZED_ARG]), visible));
    }

    #[test]
    fn settings_roundtrip_and_tolerate_bad_files() {
        let dir = tempfile_dir();
        let path = dir.join(SETTINGS_FILE);
        assert_eq!(DesktopSettings::load(&path), DesktopSettings::default());
        let s = DesktopSettings {
            close_to_tray: false,
            start_minimized: false,
        };
        s.save(&path).unwrap();
        assert_eq!(DesktopSettings::load(&path), s);
        std::fs::write(&path, b"{ roto").unwrap();
        assert_eq!(DesktopSettings::load(&path), DesktopSettings::default());
        std::fs::write(&path, br#"{"closeToTray": true}"#).unwrap();
        assert!(DesktopSettings::load(&path).close_to_tray);
        assert!(DesktopSettings::load(&path).start_minimized);
        let _ = std::fs::remove_dir_all(dir);
    }

    fn tempfile_dir() -> PathBuf {
        let d = std::env::temp_dir().join(format!("chronos-desktop-test-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }
}
