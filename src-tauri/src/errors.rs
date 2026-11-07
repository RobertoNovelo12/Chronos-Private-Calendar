//! Error serializable que reciben los comandos del frontend.

use chronos_core::CoreError;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct CommandError {
    /// Código estable (`invalid_password`, `locked`, ...).
    pub code: &'static str,
    /// Mensaje legible en español, sin datos del usuario.
    pub message: String,
}

impl From<CoreError> for CommandError {
    fn from(e: CoreError) -> Self {
        // Solo se registra el código, nunca el contenido.
        match &e {
            CoreError::InvalidPassword
            | CoreError::Validation(_)
            | CoreError::WeakPassword(_)
            | CoreError::NotFound(_)
            | CoreError::Locked
            | CoreError::ConfirmationRequired
            | CoreError::BackupAuthentication => {
                tracing::debug!(code = e.code(), "comando rechazado")
            }
            _ => tracing::error!(code = e.code(), "error en comando"),
        }
        CommandError {
            code: e.code(),
            message: e.to_string(),
        }
    }
}

impl CommandError {
    pub fn internal() -> Self {
        CommandError {
            code: "internal",
            message: "error interno de la aplicación".into(),
        }
    }
}

pub type CommandResult<T> = Result<T, CommandError>;
