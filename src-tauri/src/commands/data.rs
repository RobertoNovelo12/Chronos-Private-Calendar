//! Importación, exportación, ajustes de copias y borrado total.
//!
//! Los diálogos de archivo se abren desde Rust: el frontend no recibe permiso
//! para elegir rutas de escritura arbitrarias, solo decide el formato y qué
//! exportar. Las rutas de lectura que devuelve el selector se validan de nuevo
//! al importar (extensión y tamaño).

use crate::errors::{CommandError, CommandResult};
use crate::state::AppState;
use chronos_core::backup::{self, BackupKind, BackupRecord};
use chronos_core::interop::{
    self, ExportOptions, ExportReport, Format, ImportReport, ImportTarget,
};
use chronos_core::repositories::settings;
use chronos_core::vault::{AutoBackup, DestroyReport, DEFAULT_KEEP, MAX_KEEP};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use zeroize::Zeroizing;

fn validation(msg: &str) -> CommandError {
    CommandError {
        code: "validation",
        message: msg.into(),
    }
}

/// Ejecuta un diálogo bloqueante fuera del hilo principal.
async fn run_dialog<T: Send + 'static>(
    f: impl FnOnce() -> Option<T> + Send + 'static,
) -> CommandResult<Option<T>> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|_| CommandError::internal())
}

fn file_path(p: tauri_plugin_dialog::FilePath) -> Option<PathBuf> {
    p.into_path().ok()
}

// ---------------------------------------------------------------------------
// Exportación
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportKind {
    Ics,
    Json,
    Csv,
}

/// Pide dónde guardar y exporta. `None` si el usuario cancela.
#[tauri::command]
pub async fn export_data(
    app: AppHandle,
    state: State<'_, AppState>,
    kind: ExportKind,
    options: ExportOptions,
    suggested_name: String,
) -> CommandResult<Option<ExportReport>> {
    let (format, ext, label) = match kind {
        ExportKind::Ics => (Format::Ics, "ics", "iCalendar"),
        ExportKind::Json => (Format::Json, "json", "JSON de Chronos"),
        ExportKind::Csv => (Format::Csv, "csv", "CSV"),
    };
    let base: String = suggested_name
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | ' '))
        .take(80)
        .collect();
    let name = format!(
        "{}.{ext}",
        if base.trim().is_empty() {
            "chronos"
        } else {
            base.trim()
        }
    );
    let Some(path) = run_dialog(move || {
        app.dialog()
            .file()
            .set_title("Exportar")
            .add_filter(label, &[ext])
            .set_file_name(name)
            .blocking_save_file()
            .and_then(file_path)
    })
    .await?
    else {
        return Ok(None);
    };
    let path = if path.extension().is_none() {
        path.with_extension(ext)
    } else {
        path
    };
    state
        .with_vault(move |v| {
            interop::export_to_file(v.session()?.conn(), format, &options, &path).map(Some)
        })
        .await
}

// ---------------------------------------------------------------------------
// Importación
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub path: String,
    pub file_name: String,
    /// "ics", "json" o "backup" (copia cifrada: se restaura, no se importa).
    pub format: String,
    pub events: usize,
    pub tasks: usize,
    pub calendars: Vec<String>,
    pub rules_dropped: usize,
}

/// Selector de archivo + análisis previo (sin modificar nada).
#[tauri::command]
pub async fn import_pick(
    app: AppHandle,
    state: State<'_, AppState>,
    default_tz: String,
) -> CommandResult<Option<ImportPreview>> {
    let Some(path) = run_dialog(move || {
        app.dialog()
            .file()
            .set_title("Importar")
            .add_filter(
                "Calendarios y copias",
                &["ics", "json", backup::FILE_EXTENSION],
            )
            .blocking_pick_file()
            .and_then(file_path)
    })
    .await?
    else {
        return Ok(None);
    };
    state
        .with_vault(move |v| {
            v.session()?;
            let file_name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            let is_backup = path
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case(backup::FILE_EXTENSION));
            if is_backup {
                backup::inspect_backup(&path)?;
                return Ok(Some(ImportPreview {
                    path: path.to_string_lossy().into_owned(),
                    file_name,
                    format: "backup".into(),
                    events: 0,
                    tasks: 0,
                    calendars: vec![],
                    rules_dropped: 0,
                }));
            }
            let (format, batches) = interop::read_file(&path, &default_tz)?;
            Ok(Some(ImportPreview {
                path: path.to_string_lossy().into_owned(),
                file_name,
                format: match format {
                    Format::Ics => "ics",
                    Format::Json => "json",
                    Format::Csv => "csv",
                }
                .into(),
                events: batches.iter().map(|b| b.events.len()).sum(),
                tasks: batches.iter().map(|b| b.tasks.len()).sum(),
                calendars: batches
                    .iter()
                    .filter_map(|b| b.calendar_name.clone())
                    .collect(),
                rules_dropped: batches.iter().map(|b| b.rules_dropped).sum(),
            }))
        })
        .await
}

#[tauri::command]
pub async fn import_apply(
    state: State<'_, AppState>,
    path: String,
    target: ImportTarget,
    default_tz: String,
) -> CommandResult<ImportReport> {
    state
        .with_vault(move |v| {
            let path = PathBuf::from(path);
            let (_, batches) = interop::read_file(&path, &default_tz)?;
            let stem = path
                .file_stem()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| "Importado".into());
            interop::apply(v.session()?.conn(), batches, &target, &stem)
        })
        .await
}

// ---------------------------------------------------------------------------
// Copias de seguridad: ajustes y archivos
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSettings {
    /// "off" | "daily" | "weekly"
    pub auto: String,
    pub keep: i64,
    /// Carpeta efectiva.
    pub dir: String,
    pub is_default_dir: bool,
}

fn auto_str(a: AutoBackup) -> &'static str {
    match a {
        AutoBackup::Off => "off",
        AutoBackup::Daily => "daily",
        AutoBackup::Weekly => "weekly",
    }
}

fn read_backup_settings(v: &chronos_core::Vault) -> chronos_core::Result<BackupSettings> {
    let conn = v.session()?.conn();
    let auto =
        AutoBackup::parse(&settings::get_string(conn, settings::BACKUPS_AUTO)?.unwrap_or_default());
    let keep = settings::get(conn, settings::BACKUPS_KEEP)?
        .and_then(|x| x.as_i64())
        .unwrap_or(DEFAULT_KEEP)
        .clamp(1, MAX_KEEP);
    let dir = v.backup_dir()?;
    Ok(BackupSettings {
        auto: auto_str(auto).into(),
        keep,
        is_default_dir: dir == v.paths().default_backup_dir(),
        dir: dir.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub async fn backup_settings_get(state: State<'_, AppState>) -> CommandResult<BackupSettings> {
    state.with_vault(|v| read_backup_settings(v)).await
}

#[tauri::command]
pub async fn backup_settings_set(
    state: State<'_, AppState>,
    auto: Option<String>,
    keep: Option<i64>,
) -> CommandResult<BackupSettings> {
    if let Some(a) = &auto {
        if !matches!(a.as_str(), "off" | "daily" | "weekly") {
            return Err(validation("frecuencia no válida"));
        }
    }
    if let Some(k) = keep {
        if !(1..=MAX_KEEP).contains(&k) {
            return Err(validation("número de copias fuera de rango (1 a 100)"));
        }
    }
    state
        .with_vault(move |v| {
            let conn = v.session()?.conn();
            if let Some(a) = auto {
                settings::set(conn, settings::BACKUPS_AUTO, &a.into())?;
            }
            if let Some(k) = keep {
                settings::set(conn, settings::BACKUPS_KEEP, &k.into())?;
                v.prune_automatic()?;
            }
            read_backup_settings(v)
        })
        .await
}

/// Elige la carpeta de copias (`reset` vuelve a la predeterminada).
#[tauri::command]
pub async fn backup_choose_dir(
    app: AppHandle,
    state: State<'_, AppState>,
    reset: bool,
) -> CommandResult<BackupSettings> {
    let chosen = if reset {
        None
    } else {
        match run_dialog(move || {
            app.dialog()
                .file()
                .set_title("Carpeta de copias")
                .blocking_pick_folder()
                .and_then(file_path)
        })
        .await?
        {
            Some(p) => Some(p),
            None => return state.with_vault(|v| read_backup_settings(v)).await,
        }
    };
    state
        .with_vault(move |v| {
            let conn = v.session()?.conn();
            match chosen {
                Some(dir) => {
                    // Comprueba que se puede escribir antes de guardarla.
                    let probe = dir.join(".chronos-escritura");
                    std::fs::write(&probe, b"")?;
                    let _ = std::fs::remove_file(&probe);
                    settings::set(
                        conn,
                        settings::BACKUPS_DIR,
                        &dir.to_string_lossy().into_owned().into(),
                    )?;
                }
                None => settings::set(conn, settings::BACKUPS_DIR, &"".into())?,
            }
            read_backup_settings(v)
        })
        .await
}

/// Copia manual en la carpeta configurada. Con `password`, la copia se cifra
/// con esa contraseña en vez de la de la aplicación. Con `pick_dir`, se
/// pregunta la carpeta de destino (`None` si se cancela).
#[tauri::command]
pub async fn backup_create_in(
    app: AppHandle,
    state: State<'_, AppState>,
    pick_dir: bool,
    password: Option<Zeroizing<String>>,
) -> CommandResult<Option<BackupRecord>> {
    let dir = if pick_dir {
        match run_dialog(move || {
            app.dialog()
                .file()
                .set_title("Guardar copia cifrada en…")
                .blocking_pick_folder()
                .and_then(file_path)
        })
        .await?
        {
            Some(d) => Some(d),
            None => return Ok(None),
        }
    } else {
        None
    };
    state
        .with_vault(move |v| {
            let dir = match dir {
                Some(d) => d,
                None => v.backup_dir()?,
            };
            match password {
                Some(pw) => v.create_backup_with_password(Some(&dir), &pw),
                None => v.create_backup(Some(&dir), BackupKind::Manual),
            }
            .map(Some)
        })
        .await
}

/// Selector de un archivo `.chronosbak`.
#[tauri::command]
pub async fn backup_pick_file(app: AppHandle) -> CommandResult<Option<String>> {
    let p = run_dialog(move || {
        app.dialog()
            .file()
            .set_title("Elegir copia de seguridad")
            .add_filter("Copia de Chronos", &[backup::FILE_EXTENSION])
            .blocking_pick_file()
            .and_then(file_path)
    })
    .await?;
    Ok(p.map(|p| p.to_string_lossy().into_owned()))
}

// ---------------------------------------------------------------------------
// Borrado total
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn vault_destroy(
    state: State<'_, AppState>,
    password: Zeroizing<String>,
    confirmation: String,
    remove_backups: bool,
) -> CommandResult<DestroyReport> {
    if confirmation != "ELIMINAR" {
        return Err(CommandError {
            code: "confirmation_required",
            message: "escribe ELIMINAR para confirmar".into(),
        });
    }
    state
        .with_vault(move |v| v.destroy(&password, remove_backups))
        .await
}
