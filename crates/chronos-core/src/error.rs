//! Errores del núcleo.
//!
//! Los mensajes NUNCA incluyen datos del usuario (títulos, descripciones,
//! contraseñas, claves). Cada variante tiene un código estable (`code()`)
//! que el frontend usa para mostrar mensajes traducidos.

use thiserror::Error;

pub type Result<T> = std::result::Result<T, CoreError>;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("la bóveda todavía no se ha configurado")]
    NotInitialized,

    #[error("la bóveda ya está configurada")]
    AlreadyInitialized,

    #[error("la aplicación está bloqueada")]
    Locked,

    #[error("contraseña incorrecta")]
    InvalidPassword,

    #[error("la contraseña no cumple los requisitos: {0}")]
    WeakPassword(String),

    #[error("datos no válidos: {0}")]
    Validation(String),

    #[error("no se encontró el elemento: {0}")]
    NotFound(&'static str),

    #[error("el archivo de copia está dañado o no es válido: {0}")]
    CorruptBackup(String),

    #[error("contraseña incorrecta o archivo de copia manipulado")]
    BackupAuthentication,

    #[error("versión no compatible: {0}")]
    UnsupportedVersion(String),

    #[error("almacén de claves no válido: {0}")]
    Keystore(String),

    #[error("se requiere confirmación explícita para sobrescribir los datos")]
    ConfirmationRequired,

    #[error("fallo criptográfico")]
    Crypto,

    #[error("error de base de datos: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("error de entrada/salida: {0}")]
    Io(#[from] std::io::Error),

    #[error("error de serialización: {0}")]
    Serialization(#[from] serde_json::Error),
}

impl CoreError {
    /// Código estable y sin datos sensibles, apto para el frontend y los logs.
    pub fn code(&self) -> &'static str {
        match self {
            CoreError::NotInitialized => "not_initialized",
            CoreError::AlreadyInitialized => "already_initialized",
            CoreError::Locked => "locked",
            CoreError::InvalidPassword => "invalid_password",
            CoreError::WeakPassword(_) => "weak_password",
            CoreError::Validation(_) => "validation",
            CoreError::NotFound(_) => "not_found",
            CoreError::CorruptBackup(_) => "corrupt_backup",
            CoreError::BackupAuthentication => "backup_authentication",
            CoreError::UnsupportedVersion(_) => "unsupported_version",
            CoreError::Keystore(_) => "keystore",
            CoreError::ConfirmationRequired => "confirmation_required",
            CoreError::Crypto => "crypto",
            CoreError::Database(_) => "database",
            CoreError::Io(_) => "io",
            CoreError::Serialization(_) => "serialization",
        }
    }
}
