//! Pruebas de integración: ciclo de vida de la bóveda y copias de seguridad.

use chronos_core::backup::{self, format, BackupKind};
use chronos_core::crypto::kdf::KdfParams;
use chronos_core::models::{CalendarPatch, NewCalendar};
use chronos_core::repositories::calendars;
use chronos_core::{CoreError, Vault, VaultPaths};
use std::path::Path;

const PW: &str = "mi contraseña larga";

fn new_vault(dir: &Path) -> Vault {
    Vault::new(VaultPaths::new(dir.join("data")), KdfParams::FOR_TESTS)
}

fn calendar_names(v: &Vault) -> Vec<String> {
    calendars::list(v.session().unwrap().conn())
        .unwrap()
        .into_iter()
        .map(|c| c.name)
        .collect()
}

fn add_calendar(v: &Vault, name: &str) -> String {
    calendars::create(
        v.session().unwrap().conn(),
        &NewCalendar {
            name: name.into(),
            color: "#aa0000".into(),
            description: Some("secreto".into()),
        },
    )
    .unwrap()
    .id
}

#[test]
fn setup_lock_unlock_persists_data() {
    let tmp = tempfile::tempdir().unwrap();
    let mut v = new_vault(tmp.path());
    assert!(!v.status().initialized);
    assert!(matches!(v.unlock(PW), Err(CoreError::NotInitialized)));

    v.setup(PW).unwrap();
    assert!(v.status().initialized && v.status().unlocked);
    assert_eq!(calendar_names(&v), vec!["Personal"]);
    add_calendar(&v, "Médico");
    assert!(matches!(v.setup(PW), Err(CoreError::AlreadyInitialized)));

    v.lock();
    assert!(!v.status().unlocked);
    assert!(matches!(v.session(), Err(CoreError::Locked)));
    assert!(matches!(
        v.unlock("contraseña equivocada"),
        Err(CoreError::InvalidPassword)
    ));

    // Una instancia nueva (como al reiniciar la app) lee los mismos datos.
    drop(v);
    let mut v = new_vault(tmp.path());
    assert!(v.status().initialized && !v.status().unlocked);
    v.unlock(PW).unwrap();
    assert_eq!(calendar_names(&v), vec!["Personal", "Médico"]);
}

#[test]
fn database_file_does_not_leak_plaintext() {
    let tmp = tempfile::tempdir().unwrap();
    let mut v = new_vault(tmp.path());
    v.setup(PW).unwrap();
    add_calendar(&v, "CalendarioUltraSecreto");
    v.lock();
    for name in ["chronos.db", "chronos.db-wal", "keystore.json"] {
        let p = tmp.path().join("data").join(name);
        if let Ok(bytes) = std::fs::read(&p) {
            assert!(
                !bytes.windows(22).any(|w| w == b"CalendarioUltraSecreto"),
                "{name} contiene datos en claro"
            );
            assert!(
                !bytes.windows(PW.len()).any(|w| w == PW.as_bytes()),
                "{name} contiene la contraseña"
            );
        }
    }
}

#[test]
fn change_password() {
    let tmp = tempfile::tempdir().unwrap();
    let mut v = new_vault(tmp.path());
    v.setup(PW).unwrap();
    assert!(matches!(
        v.change_password("no es esta", "nueva clave 123"),
        Err(CoreError::InvalidPassword)
    ));
    assert!(matches!(
        v.change_password(PW, "corta"),
        Err(CoreError::WeakPassword(_))
    ));
    v.change_password(PW, "nueva clave 123").unwrap();
    v.lock();
    assert!(matches!(v.unlock(PW), Err(CoreError::InvalidPassword)));
    v.unlock("nueva clave 123").unwrap();
    assert_eq!(calendar_names(&v), vec!["Personal"]);
}

#[test]
fn backup_roundtrip_restore_and_pre_restore_copy() {
    let tmp = tempfile::tempdir().unwrap();
    let mut v = new_vault(tmp.path());
    v.setup(PW).unwrap();
    let work = add_calendar(&v, "Trabajo");
    v.session()
        .unwrap()
        .conn()
        .execute(
            "INSERT INTO events (id, calendar_id, title, start_at, end_at, created_at, updated_at)
             VALUES ('e1', ?1, 'Reunión confidencial', 1000, 2000, 0, 0)",
            [&work],
        )
        .unwrap();

    let rec = v.create_backup(None, BackupKind::Manual).unwrap();
    assert_eq!(rec.status, "ok");
    let path = Path::new(&rec.file_path).to_path_buf();
    let raw = std::fs::read(&path).unwrap();
    assert!(raw.starts_with(format::MAGIC));
    assert!(
        !raw.windows(12).any(|w| w == b"confidencial"),
        "la copia revela contenido"
    );
    assert!(
        !raw.windows(7).any(|w| w == b"Trabajo"),
        "la copia revela nombres de calendario"
    );

    // Metadatos legibles sin contraseña.
    let info = backup::inspect_backup(&path).unwrap();
    assert_eq!(info.format_version, format::FORMAT_VERSION);
    assert_eq!(info.app_version, chronos_core::APP_VERSION);
    assert_eq!(info.size_bytes as usize, raw.len());

    // Verificación completa.
    backup::verify_backup(&path, PW).unwrap();
    assert!(matches!(
        backup::verify_backup(&path, "contraseña mala"),
        Err(CoreError::BackupAuthentication)
    ));

    // Cambiar los datos después de la copia.
    {
        let s = v.session_mut().unwrap();
        calendars::update(
            s.conn(),
            &work,
            &CalendarPatch {
                name: Some("Cambiado".into()),
                ..Default::default()
            },
        )
        .unwrap();
        s.conn().execute("DELETE FROM events", []).unwrap();
    }
    add_calendar(&v, "Posterior");

    // Sin confirmación no se toca nada.
    assert!(matches!(
        v.restore_backup(&path, PW, false),
        Err(CoreError::ConfirmationRequired)
    ));
    // Contraseña incorrecta: no se toca nada.
    assert!(matches!(
        v.restore_backup(&path, "contraseña mala", true),
        Err(CoreError::BackupAuthentication)
    ));
    assert_eq!(
        calendar_names(&v),
        vec!["Personal", "Cambiado", "Posterior"]
    );

    let report = v.restore_backup(&path, PW, true).unwrap();
    assert!(report.restored_rows >= 3);
    assert_eq!(calendar_names(&v), vec!["Personal", "Trabajo"]);
    let title: String = v
        .session()
        .unwrap()
        .conn()
        .query_row("SELECT title FROM events WHERE id = 'e1'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(title, "Reunión confidencial");

    // La copia previa a la restauración conserva el estado anterior y se puede restaurar.
    let pre = Path::new(&report.pre_restore_backup.file_path).to_path_buf();
    assert_eq!(report.pre_restore_backup.kind, BackupKind::PreRestore);
    v.restore_backup(&pre, PW, true).unwrap();
    assert_eq!(
        calendar_names(&v),
        vec!["Personal", "Cambiado", "Posterior"]
    );

    // El historial sobrevive a las restauraciones.
    let hist = backup::history(v.session().unwrap().conn(), 50).unwrap();
    assert!(hist.len() >= 3);
}

#[test]
fn corrupted_and_foreign_files_are_detected() {
    let tmp = tempfile::tempdir().unwrap();
    let mut v = new_vault(tmp.path());
    v.setup(PW).unwrap();
    let rec = v.create_backup(None, BackupKind::Manual).unwrap();
    let path = Path::new(&rec.file_path).to_path_buf();
    let good = std::fs::read(&path).unwrap();

    // Un bit cambiado en el contenido cifrado.
    let mut bad = good.clone();
    let mid = bad.len() / 2;
    bad[mid] ^= 0x01;
    let p1 = tmp.path().join("flip.chronosbak");
    std::fs::write(&p1, &bad).unwrap();
    assert!(matches!(
        backup::inspect_backup(&p1),
        Err(CoreError::CorruptBackup(_))
    ));
    assert!(matches!(
        v.restore_backup(&p1, PW, true),
        Err(CoreError::CorruptBackup(_))
    ));

    // Archivo truncado.
    let p2 = tmp.path().join("trunc.chronosbak");
    std::fs::write(&p2, &good[..good.len() / 3]).unwrap();
    assert!(matches!(
        backup::verify_backup(&p2, PW),
        Err(CoreError::CorruptBackup(_))
    ));

    // Archivo que no es una copia.
    let p3 = tmp.path().join("otro.chronosbak");
    std::fs::write(
        &p3,
        b"esto no es una copia de seguridad de chronos, es texto",
    )
    .unwrap();
    assert!(matches!(
        backup::inspect_backup(&p3),
        Err(CoreError::CorruptBackup(_))
    ));

    // Datos intactos tras los intentos fallidos.
    assert_eq!(calendar_names(&v), vec!["Personal"]);
}

#[test]
fn backup_with_separate_password_and_after_password_change() {
    let tmp = tempfile::tempdir().unwrap();
    let mut v = new_vault(tmp.path());
    v.setup(PW).unwrap();
    let rec = v
        .create_backup_with_password(None, "otra clave distinta")
        .unwrap();
    let path = Path::new(&rec.file_path).to_path_buf();
    assert!(matches!(
        backup::verify_backup(&path, PW),
        Err(CoreError::BackupAuthentication)
    ));
    backup::verify_backup(&path, "otra clave distinta").unwrap();

    // Una copia automática hecha antes de cambiar la contraseña sigue
    // requiriendo la contraseña antigua.
    let old = v.create_backup(None, BackupKind::Automatic).unwrap();
    v.change_password(PW, "contraseña nueva!").unwrap();
    let old_path = Path::new(&old.file_path);
    backup::verify_backup(old_path, PW).unwrap();
    assert!(backup::verify_backup(old_path, "contraseña nueva!").is_err());
    let newer = v.create_backup(None, BackupKind::Automatic).unwrap();
    backup::verify_backup(Path::new(&newer.file_path), "contraseña nueva!").unwrap();
}

#[test]
fn local_settings_are_not_exported_or_overwritten() {
    let tmp = tempfile::tempdir().unwrap();
    let mut v = new_vault(tmp.path());
    v.setup(PW).unwrap();
    let conn = v.session().unwrap().conn();
    conn.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES ('local.backup_dir', '\"C:/a\"', 0), ('theme', '\"dark\"', 0)",
        [],
    )
    .unwrap();
    let rec = v.create_backup(None, BackupKind::Manual).unwrap();
    let conn = v.session().unwrap().conn();
    conn.execute(
        "UPDATE settings SET value = '\"D:/b\"' WHERE key = 'local.backup_dir'",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE settings SET value = '\"light\"' WHERE key = 'theme'",
        [],
    )
    .unwrap();
    v.restore_backup(Path::new(&rec.file_path), PW, true)
        .unwrap();
    let conn = v.session().unwrap().conn();
    let get = |k: &str| -> String {
        conn.query_row("SELECT value FROM settings WHERE key = ?1", [k], |r| {
            r.get(0)
        })
        .unwrap()
    };
    assert_eq!(get("theme"), "\"dark\"");
    assert_eq!(get("local.backup_dir"), "\"D:/b\"");
}
