//! «Acerca de» y enlace de donaciones.
//!
//! El único enlace externo de la aplicación es la página de donaciones, y se
//! abre en el navegador del sistema desde Rust con una URL fija. El frontend no
//! recibe el permiso `opener:*`, así que no puede abrir otras direcciones, y
//! Chronos no envía ningún dato: es el navegador el que carga la página.

use crate::errors::{CommandError, CommandResult};
use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

/// Página de donaciones del proyecto (PayPal). Fija: no depende de la interfaz.
pub const DONATION_URL: &str = "https://paypal.me/robertonovelo";
/// Repositorio oficial (se muestra como texto copiable, no se abre).
pub const REPOSITORY_URL: &str = "https://github.com/RobertoNovelo12/Chronos-Private-Calendar";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AboutInfo {
    pub version: String,
    pub license: &'static str,
    pub repository: &'static str,
    pub donation_url: &'static str,
}

#[tauri::command]
pub fn app_about(app: AppHandle) -> AboutInfo {
    AboutInfo {
        version: app.package_info().version.to_string(),
        license: "MIT",
        repository: REPOSITORY_URL,
        donation_url: DONATION_URL,
    }
}

/// Abre la página de donaciones en el navegador predeterminado.
#[tauri::command]
pub fn open_donation_link(app: AppHandle) -> CommandResult<()> {
    app.opener()
        .open_url(DONATION_URL, None::<&str>)
        .map_err(|_| CommandError {
            code: "open_failed",
            message: "no se pudo abrir el navegador".into(),
        })
}

/// Idioma de los textos del backend (notificaciones y diálogos).
#[tauri::command]
pub fn app_set_language(lang: String) -> bool {
    crate::i18n::set_language(&lang)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn donation_url_is_fixed_https_paypal() {
        assert_eq!(DONATION_URL, "https://paypal.me/robertonovelo");
        assert!(REPOSITORY_URL.starts_with("https://github.com/"));
    }
}
