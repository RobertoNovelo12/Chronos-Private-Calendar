//! Cálculo de recordatorios pendientes (notificaciones locales).
//!
//! No hay servicios remotos: la aplicación consulta periódicamente qué
//! recordatorios vencen y el sistema operativo muestra la notificación.

use crate::error::Result;
use crate::models::event::{DAY_MS, MAX_REMINDER_MINUTES};
use crate::recurrence;
use crate::repositories::{events, tasks};
use chrono::{Local, NaiveDate, TimeZone, Utc};
use rusqlite::Connection;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DueReminder {
    /// Clave única (evento/ocurrencia o tarea + adelanto) para no repetir avisos.
    pub key: String,
    /// Id del evento o de la tarea.
    pub event_id: String,
    /// Recordatorio de una tarea (vencimiento) en lugar de un evento (inicio).
    pub is_task: bool,
    pub title: String,
    pub location: String,
    /// Inicio efectivo (ms UTC). En día completo: medianoche local de la fecha.
    pub starts_at: i64,
    pub is_all_day: bool,
    pub offset_minutes: i32,
    pub fire_at: i64,
}

/// Medianoche local de una fecha flotante (para eventos de día completo).
pub fn local_midnight(date: NaiveDate) -> i64 {
    let naive = date.and_hms_opt(0, 0, 0).unwrap_or_default();
    Local
        .from_local_datetime(&naive)
        .earliest()
        .map(|d| d.timestamp_millis())
        .unwrap_or_else(|| Utc.from_utc_datetime(&naive).timestamp_millis())
}

/// Recordatorios cuyo momento de aviso cae en `(from, to]`.
pub fn due_between(conn: &Connection, from: i64, to: i64) -> Result<Vec<DueReminder>> {
    due_between_with(conn, from, to, local_midnight)
}

/// Igual que [`due_between`] con la conversión de medianoche inyectable (pruebas).
pub fn due_between_with(
    conn: &Connection,
    from: i64,
    to: i64,
    midnight: impl Fn(NaiveDate) -> i64,
) -> Result<Vec<DueReminder>> {
    if to <= from {
        return Ok(Vec::new());
    }
    // Un aviso puede adelantarse hasta 4 semanas; se amplía el rango con margen
    // de un día por las fechas flotantes de los eventos de día completo.
    let horizon = to + MAX_REMINDER_MINUTES as i64 * 60_000 + DAY_MS;
    let mut out = Vec::new();
    for e in events::list_range(conn, from - DAY_MS, horizon)? {
        if e.reminders.is_empty() {
            continue;
        }
        let starts_at = if e.is_all_day {
            match Utc.timestamp_millis_opt(e.start_at).single() {
                Some(d) => midnight(d.date_naive()),
                None => continue,
            }
        } else {
            e.start_at
        };
        for &m in &e.reminders {
            let fire_at = starts_at - m as i64 * 60_000;
            if fire_at > from && fire_at <= to {
                let base = match (&e.recurrence_master_id, e.original_start_at) {
                    (Some(master), Some(t)) => recurrence::instance_id(master, t),
                    _ => e.id.clone(),
                };
                out.push(DueReminder {
                    key: format!("{base}#{m}"),
                    event_id: e.id.clone(),
                    is_task: false,
                    title: e.title.clone(),
                    location: e.location.clone(),
                    starts_at,
                    is_all_day: e.is_all_day,
                    offset_minutes: m,
                    fire_at,
                });
            }
        }
    }
    // Tareas pendientes con vencimiento.
    for t in tasks::pending_with_reminders(conn, from - DAY_MS, horizon)? {
        let Some(due) = t.due_at else { continue };
        let due_at = if t.is_all_day {
            match Utc.timestamp_millis_opt(due).single() {
                Some(d) => midnight(d.date_naive()),
                None => continue,
            }
        } else {
            due
        };
        for &m in &t.reminders {
            let fire_at = due_at - m as i64 * 60_000;
            if fire_at > from && fire_at <= to {
                out.push(DueReminder {
                    key: format!("task:{}@{due}#{m}", t.id),
                    event_id: t.id.clone(),
                    is_task: true,
                    title: t.title.clone(),
                    location: String::new(),
                    starts_at: due_at,
                    is_all_day: t.is_all_day,
                    offset_minutes: m,
                    fire_at,
                });
            }
        }
    }
    out.sort_by_key(|d| d.fire_at);
    Ok(out)
}

/// Texto breve del adelanto: "ahora", "en 10 min", "en 1 h", "en 2 días".
pub fn describe_offset(minutes: i32) -> String {
    match minutes {
        0 => "ahora".into(),
        m if m < 60 => format!("en {m} min"),
        m if m < 24 * 60 && m % 60 == 0 => format!("en {} h", m / 60),
        m if m < 24 * 60 => format!("en {} h {} min", m / 60, m % 60),
        m if m % (24 * 60) == 0 => {
            let d = m / (24 * 60);
            if d == 1 {
                "mañana".into()
            } else {
                format!("en {d} días")
            }
        }
        m => format!("en {} h", m / 60),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::migrate;
    use crate::models::{event::NewEvent, NewCalendar};
    use crate::repositories::calendars;

    const M: i64 = 60_000;
    const H: i64 = 60 * M;

    fn setup() -> (Connection, String) {
        let mut c = Connection::open_in_memory().unwrap();
        c.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate(&mut c).unwrap();
        let cal = calendars::create(
            &c,
            &NewCalendar {
                name: "A".into(),
                color: "#112233".into(),
                description: None,
            },
        )
        .unwrap();
        (c, cal.id)
    }

    fn ev(
        cal: &str,
        start: i64,
        reminders: Vec<i32>,
        rule: Option<&str>,
        all_day: bool,
    ) -> NewEvent {
        NewEvent {
            calendar_id: cal.into(),
            title: "Dentista".into(),
            description: String::new(),
            location: String::new(),
            links: vec![],
            color: None,
            start_at: start,
            end_at: start + if all_day { DAY_MS } else { H },
            timezone: "UTC".into(),
            is_all_day: all_day,
            visibility: None,
            availability: None,
            recurrence: rule.map(String::from),
            reminders,
            labels: vec![],
            attendees: vec![],
            ical_uid: None,
        }
    }

    #[test]
    fn finds_due_reminders_in_window() {
        let (c, cal) = setup();
        let start = 100 * DAY_MS + 10 * H;
        events::create(&c, &ev(&cal, start, vec![10, 60], None, false)).unwrap();
        // Ventana que contiene el aviso de 10 min.
        let due = due_between(&c, start - 11 * M, start - 9 * M).unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].offset_minutes, 10);
        assert_eq!(due[0].fire_at, start - 10 * M);
        // Ventana sin avisos.
        assert!(due_between(&c, start - 30 * M, start - 20 * M)
            .unwrap()
            .is_empty());
        // Límite: (from, to]
        assert!(due_between(&c, start - 10 * M, start).unwrap().is_empty());
        assert_eq!(
            due_between(&c, start - 61 * M, start - 60 * M)
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn recurring_and_all_day_reminders() {
        let (c, cal) = setup();
        let start = 200 * DAY_MS + 9 * H;
        events::create(
            &c,
            &ev(&cal, start, vec![0], Some("FREQ=DAILY;COUNT=3"), false),
        )
        .unwrap();
        let due = due_between(&c, start + DAY_MS - M, start + DAY_MS).unwrap();
        assert_eq!(due.len(), 1, "la segunda ocurrencia avisa");
        assert!(due[0].key.contains('@'));

        // Día completo: medianoche local simulada a las 06:00 UTC (UTC-6).
        let day = 300 * DAY_MS;
        events::create(&c, &ev(&cal, day, vec![24 * 60], None, true)).unwrap();
        let midnight = |d: NaiveDate| {
            Utc.from_utc_datetime(&d.and_hms_opt(6, 0, 0).unwrap())
                .timestamp_millis()
        };
        let fire = day + 6 * H - DAY_MS;
        let due = due_between_with(&c, fire - M, fire, midnight).unwrap();
        assert_eq!(due.len(), 1);
        assert!(due[0].is_all_day);
    }

    #[test]
    fn offsets_are_described() {
        assert_eq!(describe_offset(0), "ahora");
        assert_eq!(describe_offset(15), "en 15 min");
        assert_eq!(describe_offset(60), "en 1 h");
        assert_eq!(describe_offset(90), "en 1 h 30 min");
        assert_eq!(describe_offset(1440), "mañana");
        assert_eq!(describe_offset(2880), "en 2 días");
    }

    #[test]
    fn task_reminders_fire_until_completed() {
        use crate::models::task::{NewTask, TaskPatch};
        let (c, _) = setup();
        let due = 20_000 * DAY_MS + 15 * H;
        let t = tasks::create(
            &c,
            &NewTask {
                title: "Pagar luz".into(),
                due_at: Some(due),
                reminders: vec![0, 30],
                ..Default::default()
            },
        )
        .unwrap();
        let found = due_between(&c, due - 31 * M, due).unwrap();
        assert_eq!(found.len(), 2);
        assert!(found.iter().all(|d| d.is_task && d.title == "Pagar luz"));
        assert_eq!(found[0].fire_at, due - 30 * M);

        // Día completo: a medianoche local de la fecha (inyectada como UTC aquí).
        tasks::create(
            &c,
            &NewTask {
                title: "Cumple".into(),
                due_at: Some(20_001 * DAY_MS),
                is_all_day: true,
                reminders: vec![0],
                ..Default::default()
            },
        )
        .unwrap();
        let utc_midnight = |d: NaiveDate| {
            Utc.from_utc_datetime(&d.and_hms_opt(0, 0, 0).unwrap())
                .timestamp_millis()
        };
        let all_day =
            due_between_with(&c, 20_001 * DAY_MS - M, 20_001 * DAY_MS, utc_midnight).unwrap();
        assert_eq!(all_day.len(), 1);
        assert!(all_day[0].is_all_day);

        // Completada: ya no avisa.
        tasks::update(
            &c,
            &t.id,
            &TaskPatch {
                completed: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(due_between(&c, due - 31 * M, due).unwrap().is_empty());
    }
}
