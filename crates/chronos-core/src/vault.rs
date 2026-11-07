//! La bóveda: ciclo de vida de los datos cifrados.
//!
//! Estados:
//! * **Sin configurar**: no existe `keystore.json`.
//! * **Bloqueada**: existe, pero no hay claves en memoria ni conexión abierta.
//! * **Desbloqueada**: conexión SQLCipher abierta y clave de copias en memoria.
//!
//! Bloquear cierra la conexión y borra (zeroize) las claves de la memoria.

use crate::backup::{self, BackupKind, BackupRecord, RestoreReport};
use crate::crypto::kdf::KdfParams;
use crate::database::open_encrypted;
use crate::error::{CoreError, Result};
use crate::models::NewCalendar;
use crate::repositories::calendars;
use crate::security::{BackupKey, KeystoreFile};
use rusqlite::Connection;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const DB_FILE: &str = "chronos.db";
pub const KEYSTORE_FILE: &str = "keystore.json";
pub const BACKUP_DIR: &str = "backups";

#[derive(Clone, Debug)]
pub struct VaultPaths {
    pub data_dir: PathBuf,
}

impl VaultPaths {
    pub fn new(data_dir: impl Into<PathBuf>) -> Self {
        VaultPaths {
            data_dir: data_dir.into(),
        }
    }
    pub fn database(&self) -> PathBuf {
        self.data_dir.join(DB_FILE)
    }
    pub fn keystore(&self) -> PathBuf {
        self.data_dir.join(KEYSTORE_FILE)
    }
    pub fn default_backup_dir(&self) -> PathBuf {
        self.data_dir.join(BACKUP_DIR)
    }
    fn database_sidecars(&self) -> [PathBuf; 3] {
        let db = self.database();
        let s = db.to_string_lossy().into_owned();
        [
            db,
            PathBuf::from(format!("{s}-wal")),
            PathBuf::from(format!("{s}-shm")),
        ]
    }
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    pub initialized: bool,
    pub unlocked: bool,
}

/// Datos disponibles solo mientras la bóveda está desbloqueada.
pub struct Session {
    conn: Connection,
    backup_key: BackupKey,
}

impl Session {
    pub fn conn(&self) -> &Connection {
        &self.conn
    }
    pub fn conn_mut(&mut self) -> &mut Connection {
        &mut self.conn
    }
    pub fn backup_key(&self) -> &BackupKey {
        &self.backup_key
    }
}

pub struct Vault {
    paths: VaultPaths,
    kdf_params: KdfParams,
    session: Option<Session>,
    failed_attempts: u32,
}

impl Vault {
    pub fn new(paths: VaultPaths, kdf_params: KdfParams) -> Self {
        Vault {
            paths,
            kdf_params,
            session: None,
            failed_attempts: 0,
        }
    }

    pub fn paths(&self) -> &VaultPaths {
        &self.paths
    }

    pub fn status(&self) -> VaultStatus {
        VaultStatus {
            initialized: self.paths.keystore().exists(),
            unlocked: self.session.is_some(),
        }
    }

    /// Primera ejecución: crea el almacén de claves y la base de datos cifrada.
    pub fn setup(&mut self, password: &str) -> Result<()> {
        if self.paths.keystore().exists() {
            return Err(CoreError::AlreadyInitialized);
        }
        if self.paths.database_sidecars().iter().any(|p| p.exists()) {
            return Err(CoreError::Keystore(
                "existe una base de datos sin su almacén de claves; no se sobrescribirá".into(),
            ));
        }
        std::fs::create_dir_all(&self.paths.data_dir)?;
        let (keystore, keys) = KeystoreFile::create(password, self.kdf_params)?;

        let result = (|| -> Result<Connection> {
            let conn = open_encrypted(&self.paths.database(), &keys.database_key)?;
            calendars::create(
                &conn,
                &NewCalendar {
                    name: "Personal".into(),
                    color: "#2f80ed".into(),
                    description: None,
                },
            )?;
            keystore.save(&self.paths.keystore())?;
            Ok(conn)
        })();

        match result {
            Ok(conn) => {
                self.session = Some(Session {
                    conn,
                    backup_key: keys.backup,
                });
                self.failed_attempts = 0;
                tracing::info!("bóveda creada");
                Ok(())
            }
            Err(e) => {
                // Deshace una configuración a medias para poder reintentar.
                for p in self.paths.database_sidecars() {
                    let _ = std::fs::remove_file(p);
                }
                let _ = std::fs::remove_file(self.paths.keystore());
                Err(e)
            }
        }
    }

    pub fn unlock(&mut self, password: &str) -> Result<()> {
        if self.session.is_some() {
            return Ok(());
        }
        let ks_path = self.paths.keystore();
        if !ks_path.exists() {
            return Err(CoreError::NotInitialized);
        }
        // Retardo creciente tras varios fallos seguidos (además del coste de Argon2id).
        if self.failed_attempts >= 3 {
            let secs = 1u64 << (self.failed_attempts - 3).min(5);
            std::thread::sleep(Duration::from_secs(secs.min(30)));
        }
        let keystore = KeystoreFile::load(&ks_path)?;
        let keys = match keystore.unlock(password) {
            Ok(k) => k,
            Err(e) => {
                if matches!(e, CoreError::InvalidPassword) {
                    self.failed_attempts = self.failed_attempts.saturating_add(1);
                    tracing::warn!(
                        attempts = self.failed_attempts,
                        "intento de desbloqueo fallido"
                    );
                }
                return Err(e);
            }
        };
        let conn =
            open_encrypted(&self.paths.database(), &keys.database_key).map_err(|e| match e {
                // La contraseña fue correcta pero la base de datos no corresponde a la clave.
                CoreError::InvalidPassword => CoreError::Keystore(
                    "la base de datos no corresponde a este almacén de claves".into(),
                ),
                other => other,
            })?;
        self.session = Some(Session {
            conn,
            backup_key: keys.backup,
        });
        self.failed_attempts = 0;
        tracing::info!("bóveda desbloqueada");
        Ok(())
    }

    /// Cierra la conexión y elimina las claves de la memoria.
    pub fn lock(&mut self) {
        if self.session.take().is_some() {
            tracing::info!("bóveda bloqueada");
        }
    }

    pub fn change_password(&mut self, current: &str, new: &str) -> Result<()> {
        let session = self.session.as_mut().ok_or(CoreError::Locked)?;
        let keystore = KeystoreFile::load(&self.paths.keystore())?;
        let (updated, keys) = keystore.change_password(current, new, self.kdf_params)?;
        updated.save(&self.paths.keystore())?;
        session.backup_key = keys.backup;
        tracing::info!("contraseña cambiada");
        Ok(())
    }

    pub fn session(&self) -> Result<&Session> {
        self.session.as_ref().ok_or(CoreError::Locked)
    }

    pub fn session_mut(&mut self) -> Result<&mut Session> {
        self.session.as_mut().ok_or(CoreError::Locked)
    }

    /// Copia cifrada con la clave de la sesión (la contraseña actual de la app).
    pub fn create_backup(&self, dir: Option<&Path>, kind: BackupKind) -> Result<BackupRecord> {
        let s = self.session()?;
        let default_dir = self.paths.default_backup_dir();
        backup::create_backup(&s.conn, &s.backup_key, dir.unwrap_or(&default_dir), kind)
    }

    /// Copia manual protegida con una contraseña distinta de la de la app.
    pub fn create_backup_with_password(
        &self,
        dir: Option<&Path>,
        password: &str,
    ) -> Result<BackupRecord> {
        let s = self.session()?;
        let key = BackupKey::from_password(password, self.kdf_params)?;
        let default_dir = self.paths.default_backup_dir();
        backup::create_backup(
            &s.conn,
            &key,
            dir.unwrap_or(&default_dir),
            BackupKind::Manual,
        )
    }

    pub fn restore_backup(
        &mut self,
        path: &Path,
        password: &str,
        confirm_overwrite: bool,
    ) -> Result<RestoreReport> {
        let backup_dir = self.paths.default_backup_dir();
        let s = self.session.as_mut().ok_or(CoreError::Locked)?;
        backup::restore_backup(
            &mut s.conn,
            &s.backup_key,
            &backup_dir,
            path,
            password,
            confirm_overwrite,
        )
    }
}
