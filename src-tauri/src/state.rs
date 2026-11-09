//! Estado compartido de la aplicación.

use crate::errors::{CommandError, CommandResult};
use chronos_core::{Result as CoreResult, Vault};
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct AppState {
    vault: Arc<Mutex<Vault>>,
}

impl AppState {
    pub fn new(vault: Vault) -> Self {
        AppState {
            vault: Arc::new(Mutex::new(vault)),
        }
    }

    /// Ejecuta `f` con la bóveda en un hilo bloqueante, fuera del hilo de la
    /// interfaz (Argon2id y SQLite son operaciones síncronas y costosas).
    pub async fn with_vault<T, F>(&self, f: F) -> CommandResult<T>
    where
        T: Send + 'static,
        F: FnOnce(&mut Vault) -> CoreResult<T> + Send + 'static,
    {
        let vault = Arc::clone(&self.vault);
        tauri::async_runtime::spawn_blocking(move || {
            // Si un hilo anterior entró en pánico, se recupera el estado igualmente:
            // la bóveda no queda en un estado intermedio porque cada operación es transaccional.
            let mut guard = vault
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            f(&mut guard).map_err(CommandError::from)
        })
        .await
        .map_err(|_| CommandError::internal())?
    }

    /// Versión síncrona para hilos propios (programador de recordatorios).
    /// No usa `try_lock`: espera su turno como cualquier comando.
    pub fn with_vault_blocking<T>(
        &self,
        f: impl FnOnce(&mut Vault) -> CoreResult<T>,
    ) -> CoreResult<T> {
        let mut guard = self
            .vault
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        f(&mut guard)
    }
}
