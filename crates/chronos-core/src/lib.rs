//! # chronos-core
//!
//! Núcleo de Chronos Private Calendar, independiente de la interfaz:
//! persistencia SQLCipher, migraciones, criptografía, almacén de claves,
//! copias de seguridad cifradas y lógica de dominio.
//!
//! Este crate no realiza ninguna operación de red: no depende de ningún
//! cliente HTTP ni abre sockets.

#![forbid(unsafe_code)]

pub mod backup;
pub mod crypto;
pub mod database;
pub mod error;
mod fs_util;
pub mod models;
pub mod repositories;
pub mod security;
pub mod vault;

pub use error::{CoreError, Result};
pub use vault::{Vault, VaultPaths, VaultStatus};

/// Versión de la aplicación que se registra en las copias de seguridad.
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
