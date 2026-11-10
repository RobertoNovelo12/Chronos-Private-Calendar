//! Programador de recordatorios: notificaciones locales del sistema operativo.
//!
//! * Con la bóveda desbloqueada consulta cada 15 s qué avisos vencen y guarda
//!   en memoria el horario de las próximas 24 h **sin títulos ni ubicaciones**.
//! * Con la bóveda bloqueada sigue avisando a la hora prevista, pero con un
//!   texto genérico: los detalles del evento no permanecen en memoria.
//! * Ningún aviso sale del equipo: no hay servicios de notificaciones remotos.

use crate::i18n::{self, Key};
use crate::state::AppState;
use chronos_core::database::now_ms;
use chronos_core::reminders::{self, DueReminder};
use chronos_core::repositories::settings;
use std::collections::HashSet;
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

const TICK: Duration = Duration::from_secs(15);
/// No se notifican avisos con más de 2 minutos de retraso (p. ej. tras suspender el equipo).
const MAX_LATENESS_MS: i64 = 120_000;
const SCHEDULE_HORIZON_MS: i64 = 24 * 3_600_000;

/// Aviso futuro sin datos del evento (sobrevive al bloqueo).
struct Pending {
    key: String,
    fire_at: i64,
    offset_minutes: i32,
    is_task: bool,
}

pub fn spawn(app: AppHandle, state: AppState) {
    let spawned = std::thread::Builder::new()
        .name("chronos-recordatorios".into())
        .spawn(move || {
            let mut last = now_ms();
            let mut fired: HashSet<String> = HashSet::new();
            let mut pending: Vec<Pending> = Vec::new();
            loop {
                std::thread::sleep(TICK);
                let now = now_ms();
                let from = last.max(now - MAX_LATENESS_MS);

                let result = state.with_vault_blocking(|v| {
                    let s = v.session()?;
                    let show =
                        settings::get_bool(s.conn(), settings::NOTIFICATIONS_SHOW_DETAILS, true)?;
                    let due = reminders::due_between(s.conn(), from, now)?;
                    let upcoming =
                        reminders::due_between(s.conn(), now, now + SCHEDULE_HORIZON_MS)?;
                    Ok((show, due, upcoming))
                });

                match result {
                    Ok((show, due, upcoming)) => {
                        for d in due {
                            if fired.insert(d.key.clone()) {
                                notify_detailed(&app, &d, show);
                            }
                        }
                        pending = upcoming
                            .into_iter()
                            .map(|d| Pending {
                                key: d.key,
                                fire_at: d.fire_at,
                                offset_minutes: d.offset_minutes,
                                is_task: d.is_task,
                            })
                            .collect();
                    }
                    // Bloqueada (o sin configurar): se usa el horario guardado, con texto genérico.
                    Err(_) => {
                        for p in pending
                            .iter()
                            .filter(|p| p.fire_at > from && p.fire_at <= now)
                        {
                            if fired.insert(p.key.clone()) {
                                notify_generic(&app, p.offset_minutes, p.is_task);
                            }
                        }
                        pending.retain(|p| p.fire_at > now);
                    }
                }
                last = now;
                if fired.len() > 10_000 {
                    fired.clear();
                }
            }
        });
    if spawned.is_err() {
        tracing::error!("no se pudo iniciar el programador de recordatorios");
    }
}

fn notify_detailed(app: &AppHandle, d: &DueReminder, show_details: bool) {
    if !show_details {
        return notify_generic(app, d.offset_minutes, d.is_task);
    }
    let title = if d.title.trim().is_empty() {
        i18n::text(Key::Untitled)
    } else {
        d.title.as_str()
    };
    let mut body = if d.is_task {
        if d.is_all_day {
            i18n::fmt(Key::TaskFor, &[&i18n::day(d.offset_minutes)])
        } else {
            i18n::fmt(Key::TaskDueAt, &[&i18n::offset(d.offset_minutes)])
        }
    } else if d.is_all_day {
        i18n::fmt(Key::AllDayAt, &[&i18n::offset(d.offset_minutes)])
    } else {
        i18n::fmt(Key::StartsAt, &[&i18n::offset(d.offset_minutes)])
    };
    if !d.location.trim().is_empty() {
        body.push_str(" · ");
        body.push_str(d.location.trim());
    }
    show(app, title, &body);
}

fn notify_generic(app: &AppHandle, offset_minutes: i32, is_task: bool) {
    let key = if is_task {
        Key::YouHaveTask
    } else {
        Key::YouHaveEvent
    };
    show(
        app,
        "Chronos",
        &i18n::fmt(key, &[&i18n::offset(offset_minutes)]),
    );
}

fn show(app: &AppHandle, title: &str, body: &str) {
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        // El error no incluye datos del evento.
        tracing::warn!(error = %e, "no se pudo mostrar la notificación");
    }
}
