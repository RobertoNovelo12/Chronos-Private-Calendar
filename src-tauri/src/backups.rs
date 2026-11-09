//! Copias automáticas: mientras la bóveda está desbloqueada se comprueba
//! periódicamente si toca crear una (diaria o semanal, según el ajuste).
//! Con la bóveda bloqueada no se puede: no hay claves en memoria.

use crate::state::AppState;
use chronos_core::database::now_ms;
use std::time::Duration;

const FIRST_CHECK: Duration = Duration::from_secs(60);
const TICK: Duration = Duration::from_secs(5 * 60);

pub fn spawn(state: AppState) {
    let spawned = std::thread::Builder::new()
        .name("chronos-copias".into())
        .spawn(move || {
            std::thread::sleep(FIRST_CHECK);
            loop {
                match state.with_vault_blocking(|v| {
                    if !v.status().unlocked {
                        return Ok(None);
                    }
                    v.auto_backup_if_due(now_ms())
                }) {
                    Ok(_) => {}
                    Err(e) => tracing::warn!(error = e.code(), "falló la copia automática"),
                }
                std::thread::sleep(TICK);
            }
        });
    if spawned.is_err() {
        tracing::error!("no se pudo iniciar el programador de copias");
    }
}
