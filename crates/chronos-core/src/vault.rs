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
use crate::repositories::{backup_history, calendars, settings};
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
            settings::set(&conn, settings::LOCAL_APP_VERSION, &crate::APP_VERSION.into())?;
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
        // Un fallo aquí no debe impedir abrir los datos; queda registrado.
        if let Err(e) = self.pre_update_backup_if_needed() {
            tracing::warn!(error = %e.code(), "no se pudo crear la copia previa a la actualización");
        }
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
        let configured = self.backup_dir()?;
        backup::create_backup(&s.conn, &s.backup_key, dir.unwrap_or(&configured), kind)
    }

    /// Copia manual protegida con una contraseña distinta de la de la app.
    pub fn create_backup_with_password(
        &self,
        dir: Option<&Path>,
        password: &str,
    ) -> Result<BackupRecord> {
        let s = self.session()?;
        let key = BackupKey::from_password(password, self.kdf_params)?;
        let configured = self.backup_dir()?;
        backup::create_backup(
            &s.conn,
            &key,
            dir.unwrap_or(&configured),
            BackupKind::Manual,
        )
    }

    pub fn restore_backup(
        &mut self,
        path: &Path,
        password: &str,
        confirm_overwrite: bool,
    ) -> Result<RestoreReport> {
        let backup_dir = self.backup_dir()?;
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

/// Frecuencia de las copias automáticas.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AutoBackup {
    Off,
    Daily,
    Weekly,
}

impl AutoBackup {
    pub fn parse(s: &str) -> Self {
        match s {
            "off" => AutoBackup::Off,
            "weekly" => AutoBackup::Weekly,
            _ => AutoBackup::Daily,
        }
    }
    fn interval_ms(self) -> Option<i64> {
        match self {
            AutoBackup::Off => None,
            AutoBackup::Daily => Some(crate::models::event::DAY_MS),
            AutoBackup::Weekly => Some(7 * crate::models::event::DAY_MS),
        }
    }
}

pub const DEFAULT_KEEP: i64 = 7;
pub const MAX_KEEP: i64 = 100;

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DestroyReport {
    pub backups_removed: usize,
    pub backups_not_removed: usize,
}

fn is_backup_file(p: &Path) -> bool {
    p.extension().is_some_and(|e| e.eq_ignore_ascii_case(backup::FILE_EXTENSION))
}

impl Vault {
    /// Carpeta de copias configurada (o la predeterminada).
    pub fn backup_dir(&self) -> Result<PathBuf> {
        let s = self.session()?;
        Ok(settings::get_string(&s.conn, settings::BACKUPS_DIR)?
            .filter(|d| !d.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| self.paths.default_backup_dir()))
    }

    /// Crea una copia automática si toca según la frecuencia elegida y
    /// elimina las automáticas más antiguas que superen el límite.
    pub fn auto_backup_if_due(&self, now: i64) -> Result<Option<BackupRecord>> {
        let s = self.session()?;
        let freq = AutoBackup::parse(&settings::get_string(&s.conn, settings::BACKUPS_AUTO)?.unwrap_or_default());
        let Some(interval) = freq.interval_ms() else { return Ok(None) };
        let last = backup_history::list_kind(&s.conn, BackupKind::Automatic)?.first().map(|r| r.created_at);
        if last.is_some_and(|t| now - t < interval && t <= now) {
            return Ok(None);
        }
        let dir = self.backup_dir()?;
        let rec = backup::create_backup(&s.conn, &s.backup_key, &dir, BackupKind::Automatic)?;
        tracing::info!("copia automática creada");
        self.prune_automatic()?;
        Ok(Some(rec))
    }

    /// Conserva solo las `backups.keep` copias automáticas más recientes.
    /// Únicamente borra archivos `.chronosbak` registrados como automáticos.
    pub fn prune_automatic(&self) -> Result<usize> {
        let s = self.session()?;
        let keep = settings::get(&s.conn, settings::BACKUPS_KEEP)?
            .and_then(|v| v.as_i64())
            .unwrap_or(DEFAULT_KEEP)
            .clamp(1, MAX_KEEP) as usize;
        let mut removed = 0;
        for rec in backup_history::list_kind(&s.conn, BackupKind::Automatic)?.into_iter().skip(keep) {
            let path = PathBuf::from(&rec.file_path);
            if is_backup_file(&path) {
                match std::fs::remove_file(&path) {
                    Ok(()) => removed += 1,
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => {
                        tracing::warn!(error = %e.kind(), "no se pudo eliminar una copia antigua");
                        continue;
                    }
                }
            }
            backup_history::delete(&s.conn, &rec.id)?;
        }
        Ok(removed)
    }

    /// Si la aplicación cambió de versión desde la última apertura, guarda una
    /// copia antes de seguir (las migraciones ya se aplicaron al abrir, pero no
    /// alteran datos existentes; la copia protege frente a errores de la nueva versión).
    fn pre_update_backup_if_needed(&self) -> Result<Option<BackupRecord>> {
        let s = self.session()?;
        let previous = settings::get_string(&s.conn, settings::LOCAL_APP_VERSION)?;
        if previous.as_deref() == Some(crate::APP_VERSION) {
            return Ok(None);
        }
        let dir = self.backup_dir()?;
        let rec = backup::create_backup(&s.conn, &s.backup_key, &dir, BackupKind::PreUpdate)?;
        settings::set(&s.conn, settings::LOCAL_APP_VERSION, &crate::APP_VERSION.into())?;
        tracing::info!("copia previa a la actualización creada");
        Ok(Some(rec))
    }

    /// Elimina todos los datos de este equipo.
    ///
    /// Orden: se verifica la contraseña, se cierra la sesión, se borra primero
    /// el almacén de claves (sin él la base cifrada es irrecuperable aunque
    /// quedaran restos en disco) y después la base de datos. Opcionalmente se
    /// borran también los archivos de copia registrados en el historial.
    pub fn destroy(&mut self, password: &str, remove_backups: bool) -> Result<DestroyReport> {
        let keystore = KeystoreFile::load(&self.paths.keystore())?;
        keystore.unlock(password)?;
        let backup_files: Vec<PathBuf> = if remove_backups {
            let s = self.session()?;
            let mut v: Vec<PathBuf> = backup_history::all_paths(&s.conn)?.into_iter().map(PathBuf::from).collect();
            if let Ok(entries) = std::fs::read_dir(self.paths.default_backup_dir()) {
                v.extend(entries.flatten().map(|e| e.path()));
            }
            v.sort();
            v.dedup();
            v.into_iter().filter(|p| is_backup_file(p)).collect()
        } else {
            Vec::new()
        };
        self.lock();
        std::fs::remove_file(self.paths.keystore())?;
        for p in self.paths.database_sidecars() {
            match std::fs::remove_file(&p) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(e.into()),
            }
        }
        let mut report = DestroyReport::default();
        for p in backup_files {
            match std::fs::remove_file(&p) {
                Ok(()) => report.backups_removed += 1,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => report.backups_not_removed += 1,
            }
        }
        let _ = std::fs::remove_dir(self.paths.default_backup_dir());
        tracing::info!(removed = report.backups_removed, "datos eliminados");
        Ok(report)
    }
}
