//! Pruebas de calidad (Fase 6): rendimiento con muchos eventos sobre la base
//! cifrada real, copias grandes y mensajes de error sin datos del usuario.
//!
//! Los umbrales de tiempo son holgados (compilación de depuración, equipos
//! lentos de CI); su objetivo es detectar regresiones graves, como cargar toda
//! la base en cada consulta. Los tiempos reales se imprimen con
//! `cargo test -p chronos-core --test quality -- --nocapture`.

use chronos_core::backup::{self, BackupKind};
use chronos_core::crypto::kdf::KdfParams;
use chronos_core::models::event::{NewEvent, DAY_MS};
use chronos_core::models::NewCalendar;
use chronos_core::reminders;
use chronos_core::repositories::{calendars, events};
use chronos_core::{Vault, VaultPaths};
use std::path::Path;
use std::time::{Duration, Instant};

const PW: &str = "contraseña de rendimiento";
const H: i64 = 3_600_000;
/// Lunes 2 de noviembre de 2026, 00:00 UTC.
const BASE: i64 = 1_793_577_600_000;

const SIMPLE_EVENTS: i64 = 20_000;
const SERIES: i64 = 150;

fn event(cal: &str, start: i64, minutes: i64, title: String, rule: Option<&str>) -> NewEvent {
    NewEvent {
        calendar_id: cal.into(),
        title,
        description: "Notas del evento".into(),
        location: String::new(),
        links: vec![],
        color: None,
        start_at: start,
        end_at: start + minutes * 60_000,
        timezone: "America/Mexico_City".into(),
        is_all_day: false,
        visibility: None,
        availability: None,
        recurrence: rule.map(String::from),
        reminders: vec![10],
        ical_uid: None,
    }
}

fn timed<T>(label: &str, f: impl FnOnce() -> T) -> (T, Duration) {
    let t = Instant::now();
    let out = f();
    let d = t.elapsed();
    println!("{label:<52} {:>8.1} ms", d.as_secs_f64() * 1000.0);
    (out, d)
}

/// Bóveda con 20 000 eventos repartidos en ~2 años y 150 series infinitas.
fn populated_vault(dir: &Path) -> (Vault, String) {
    let mut v = Vault::new(VaultPaths::new(dir.join("data")), KdfParams::FOR_TESTS);
    v.setup(PW).unwrap();
    let conn = v.session().unwrap().conn();
    let cal = calendars::create(
        conn,
        &NewCalendar {
            name: "Carga".into(),
            color: "#2f80ed".into(),
            description: None,
        },
    )
    .unwrap()
    .id;
    timed(&format!("insertar {SIMPLE_EVENTS} eventos simples"), || {
        for i in 0..SIMPLE_EVENTS {
            // ~27 eventos por día durante 2 años, a horas variadas.
            let day = i / 27;
            let hour = 7 + (i % 12);
            let start = BASE + day * DAY_MS + hour * H;
            events::create(
                conn,
                &event(&cal, start, 30 + (i % 4) * 15, format!("Evento {i}"), None),
            )
            .unwrap();
        }
    });
    timed(
        &format!("insertar {SERIES} series diarias infinitas"),
        || {
            for i in 0..SERIES {
                let start = BASE + (i % 10) * H + 6 * H;
                events::create(
                    conn,
                    &event(&cal, start, 30, format!("Serie {i}"), Some("FREQ=DAILY")),
                )
                .unwrap();
            }
        },
    );
    (v, cal)
}

#[test]
fn stays_fast_with_tens_of_thousands_of_events() {
    let tmp = tempfile::tempdir().unwrap();
    let (v, _cal) = populated_vault(tmp.path());
    let conn = v.session().unwrap().conn();

    // Semana a mitad del periodo: ~190 simples + 150 × 7 ocurrencias.
    let week_from = BASE + 300 * DAY_MS;
    let (week, d_week) = timed("consultar una semana (con series expandidas)", || {
        events::list_range(conn, week_from, week_from + 7 * DAY_MS).unwrap()
    });
    assert_eq!(week.iter().filter(|e| !e.is_recurring).count(), 189);
    assert_eq!(
        week.iter().filter(|e| e.is_recurring).count(),
        (SERIES * 7) as usize
    );
    assert!(
        week.iter().all(|e| e.reminders == vec![10]),
        "los recordatorios llegan con cada evento"
    );

    // Vista de mes: 6 semanas.
    let (month, d_month) = timed("consultar 6 semanas (vista Mes)", || {
        events::list_range(conn, week_from, week_from + 42 * DAY_MS).unwrap()
    });
    assert_eq!(
        month.iter().filter(|e| e.is_recurring).count(),
        (SERIES * 42) as usize
    );

    let (found, d_search) = timed("buscar texto en toda la base", || {
        events::search(conn, "Evento 1999", 50).unwrap()
    });
    assert!(found.iter().any(|e| e.title == "Evento 1999"));

    let (_due, d_rem) = timed("calcular recordatorios pendientes (1 min)", || {
        reminders::due_between(conn, week_from, week_from + 60_000).unwrap()
    });

    // Umbrales holgados: lo esperado es del orden de decenas de milisegundos.
    assert!(d_week < Duration::from_millis(1500), "semana: {d_week:?}");
    assert!(d_month < Duration::from_millis(5000), "mes: {d_month:?}");
    assert!(
        d_search < Duration::from_millis(2000),
        "búsqueda: {d_search:?}"
    );
    assert!(
        d_rem < Duration::from_millis(5000),
        "recordatorios: {d_rem:?}"
    );

    // Una consulta no carga toda la base: lejos del periodo poblado solo hay series.
    let empty_from = BASE + 5000 * DAY_MS;
    let far = events::list_range(conn, empty_from, empty_from + DAY_MS).unwrap();
    assert!(far.iter().all(|e| e.is_recurring));
    assert_eq!(far.len(), SERIES as usize);
}

#[test]
fn large_backup_round_trip() {
    let tmp = tempfile::tempdir().unwrap();
    let (mut v, _cal) = populated_vault(tmp.path());
    let (rec, d_create) = timed("crear copia cifrada con 20 150 eventos", || {
        v.create_backup(None, BackupKind::Manual).unwrap()
    });
    println!(
        "tamaño de la copia: {:.1} MB",
        rec.size_bytes as f64 / 1_048_576.0
    );
    let path = Path::new(&rec.file_path).to_path_buf();
    let (_info, d_verify) = timed("verificar la copia (descifrar + leer)", || {
        backup::verify_backup(&path, PW).unwrap()
    });

    // Restaurar sobre una base modificada devuelve exactamente el contenido de la copia.
    v.session()
        .unwrap()
        .conn()
        .execute("DELETE FROM events WHERE title LIKE 'Evento 1%'", [])
        .unwrap();
    let (report, d_restore) = timed("restaurar la copia (transacción única)", || {
        v.restore_backup(&path, PW, true).unwrap()
    });
    let total: i64 = v
        .session()
        .unwrap()
        .conn()
        .query_row("SELECT count(*) FROM events", [], |r| r.get(0))
        .unwrap();
    assert_eq!(total, SIMPLE_EVENTS + SERIES);
    assert!(report.restored_rows as i64 > SIMPLE_EVENTS);

    assert!(d_create < Duration::from_secs(30), "crear: {d_create:?}");
    assert!(
        d_verify < Duration::from_secs(30),
        "verificar: {d_verify:?}"
    );
    assert!(
        d_restore < Duration::from_secs(60),
        "restaurar: {d_restore:?}"
    );
}

/// Los mensajes de error que llegan a la interfaz (y a los logs) describen el
/// problema sin repetir títulos, ubicaciones ni contraseñas.
#[test]
fn errors_do_not_echo_user_data() {
    let tmp = tempfile::tempdir().unwrap();
    let mut v = Vault::new(
        VaultPaths::new(tmp.path().join("data")),
        KdfParams::FOR_TESTS,
    );
    v.setup(PW).unwrap();
    let conn = v.session().unwrap().conn();
    let cal = calendars::list(conn).unwrap().remove(0).id;
    let secret = "CitaConfidencialConElAbogado";

    let mut too_long = event(
        &cal,
        BASE,
        30,
        format!("{secret}{}", "x".repeat(1200)),
        None,
    );
    too_long.location = secret.into();
    let mut bad_link = event(&cal, BASE, 30, secret.into(), None);
    bad_link.links = vec![chronos_core::models::event::EventLink {
        label: secret.into(),
        url: format!("javascript:{secret}"),
    }];
    let mut bad_rule = event(&cal, BASE, 30, secret.into(), Some("FREQ=SECONDLY"));
    bad_rule.location = secret.into();
    let mut backwards = event(&cal, BASE, 30, secret.into(), None);
    backwards.end_at = BASE - 1;

    for input in [too_long, bad_link, bad_rule, backwards] {
        let err = events::create(conn, &input).unwrap_err();
        let shown = err.to_string();
        assert!(!shown.contains(secret), "el error revela datos: {shown}");
        assert!(
            !shown.contains("javascript"),
            "el error repite la entrada: {shown}"
        );
        assert_eq!(err.code(), "validation");
    }

    v.lock();
    let err = v.unlock(secret).unwrap_err();
    assert!(
        !err.to_string().contains(secret),
        "el error de desbloqueo repite la contraseña"
    );
    assert_eq!(err.code(), "invalid_password");
}

/// Importar un .ics grande (p. ej. años de Google Calendar) usa una sola
/// transacción: es rápido y, si algo falla, no deja nada a medias.
#[test]
fn large_ics_import_is_fast() {
    use chronos_core::interop::{self, ImportTarget};
    use std::fmt::Write as _;

    const N: usize = 5000;
    let tmp = tempfile::tempdir().unwrap();
    let mut ics = String::from(
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Prueba//ES\r\nX-WR-CALNAME:Importado\r\n",
    );
    for i in 0..N {
        let day = 1 + (i % 28);
        let hour = 8 + (i % 10);
        let _ = write!(
            ics,
            "BEGIN:VEVENT\r\nUID:ev-{i}@prueba\r\nDTSTART;TZID=America/Mexico_City:202611{day:02}T{hour:02}0000\r\n\
             DTEND;TZID=America/Mexico_City:202611{day:02}T{hour:02}3000\r\nSUMMARY:Evento importado {i}\r\n\
             LOCATION:Sala {i}\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT10M\r\nEND:VALARM\r\nEND:VEVENT\r\n"
        );
    }
    ics.push_str("END:VCALENDAR\r\n");
    let file = tmp.path().join("grande.ics");
    std::fs::write(&file, ics).unwrap();

    let mut v = Vault::new(
        VaultPaths::new(tmp.path().join("data")),
        KdfParams::FOR_TESTS,
    );
    v.setup(PW).unwrap();
    let conn = v.session().unwrap().conn();
    let ((_, batches), d_read) = timed(&format!("leer .ics con {N} eventos"), || {
        interop::read_file(&file, "UTC").unwrap()
    });
    let (report, d_apply) = timed(&format!("importar {N} eventos (una transacción)"), || {
        interop::apply(
            conn,
            batches,
            &ImportTarget::New { name: None },
            "grande.ics",
        )
        .unwrap()
    });
    assert_eq!(report.imported, N);
    assert!(d_read < Duration::from_secs(10), "lectura: {d_read:?}");
    assert!(
        d_apply < Duration::from_secs(20),
        "importación: {d_apply:?}"
    );

    // Volver a importar no duplica.
    let (_, again) = interop::read_file(&file, "UTC").unwrap();
    let report =
        interop::apply(conn, again, &ImportTarget::New { name: None }, "grande.ics").unwrap();
    assert_eq!((report.imported, report.duplicates), (0, N));
}
