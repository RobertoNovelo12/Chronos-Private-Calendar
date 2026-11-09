//! Motor de recurrencias (RFC 5545).
//!
//! Una serie se guarda UNA vez: la fila maestra en `events` (inicio, duración,
//! zona horaria) y su regla `RRULE` en `event_recurrences`. Las ocurrencias se
//! calculan bajo demanda solo para el rango consultado, con el crate `rrule`.
//!
//! * Eventos con hora: `DTSTART;TZID=<zona IANA>` → las ocurrencias respetan
//!   los cambios de horario (una reunión a las 9:00 sigue a las 9:00).
//! * Día completo: fechas flotantes en UTC (`DTSTART:...Z`).
//!
//! Solo se permiten frecuencias diaria, semanal, mensual y anual, con límites
//! en intervalo y número de repeticiones, para que una regla no pueda generar
//! millones de ocurrencias.

use crate::error::{CoreError, Result};
use crate::models::event::Event;
use chrono::{DateTime, TimeZone, Utc};
use rrule::{RRuleSet, Tz};

/// Máximo de ocurrencias que se generan para una serie en una consulta.
pub const MAX_INSTANCES_PER_QUERY: u16 = 2000;
const MAX_INTERVAL: u32 = 999;
const MAX_COUNT: u32 = 5000;
const ALLOWED_KEYS: &[&str] = &[
    "FREQ",
    "INTERVAL",
    "COUNT",
    "UNTIL",
    "BYDAY",
    "BYMONTHDAY",
    "BYMONTH",
    "BYSETPOS",
    "WKST",
];

/// Separador entre el id de la serie y el inicio original en el id de una ocurrencia.
pub const INSTANCE_SEP: char = '@';

/// `serie@inicio_ms` → (serie, inicio_ms).
pub fn parse_instance_id(id: &str) -> Option<(&str, i64)> {
    let (master, t) = id.split_once(INSTANCE_SEP)?;
    Some((master, t.parse().ok()?))
}

pub fn instance_id(master_id: &str, original_start: i64) -> String {
    format!("{master_id}{INSTANCE_SEP}{original_start}")
}

fn parts(rule: &str) -> Vec<(String, String)> {
    rule.split(';')
        .filter(|p| !p.trim().is_empty())
        .filter_map(|p| {
            let (k, v) = p.split_once('=')?;
            Some((k.trim().to_ascii_uppercase(), v.trim().to_ascii_uppercase()))
        })
        .collect()
}

fn join(parts: &[(String, String)]) -> String {
    parts
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join(";")
}

/// Valida y normaliza el valor de una RRULE (sin prefijo "RRULE:").
pub fn validate_rule(rule: &str) -> Result<String> {
    let rule = rule.trim().trim_start_matches("RRULE:");
    if rule.is_empty() || rule.len() > 500 || rule.contains(['\n', '\r', ':']) {
        return Err(CoreError::Validation(
            "regla de repetición no válida".into(),
        ));
    }
    let ps = parts(rule);
    let mut freq_ok = false;
    for (k, v) in &ps {
        if !ALLOWED_KEYS.contains(&k.as_str()) {
            return Err(CoreError::Validation(format!(
                "parte de la regla no admitida: {k}"
            )));
        }
        match k.as_str() {
            "FREQ" => freq_ok = matches!(v.as_str(), "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY"),
            "INTERVAL" => {
                let n: u32 = v
                    .parse()
                    .map_err(|_| CoreError::Validation("intervalo no válido".into()))?;
                if n == 0 || n > MAX_INTERVAL {
                    return Err(CoreError::Validation("intervalo fuera de rango".into()));
                }
            }
            "COUNT" => {
                let n: u32 = v.parse().map_err(|_| {
                    CoreError::Validation("número de repeticiones no válido".into())
                })?;
                if n == 0 || n > MAX_COUNT {
                    return Err(CoreError::Validation(format!(
                        "las repeticiones deben estar entre 1 y {MAX_COUNT}"
                    )));
                }
            }
            _ => {}
        }
    }
    if !freq_ok {
        return Err(CoreError::Validation("frecuencia no admitida".into()));
    }
    if ps.iter().any(|(k, _)| k == "COUNT") && ps.iter().any(|(k, _)| k == "UNTIL") {
        return Err(CoreError::Validation(
            "una regla no puede tener a la vez fin por fecha y por número".into(),
        ));
    }
    let normalized = join(&ps);
    // Comprobación final con el analizador RFC 5545.
    format!("DTSTART:20260101T000000Z\nRRULE:{normalized}")
        .parse::<RRuleSet>()
        .map_err(|_| CoreError::Validation("regla de repetición no válida".into()))?;
    Ok(normalized)
}

fn dtstart_line(master: &Event) -> Result<String> {
    if master.is_all_day || master.timezone == "UTC" {
        let dt = Utc
            .timestamp_millis_opt(master.start_at)
            .single()
            .ok_or(CoreError::Validation("fecha no válida".into()))?;
        return Ok(format!("DTSTART:{}", dt.format("%Y%m%dT%H%M%SZ")));
    }
    let tz: chrono_tz::Tz = master
        .timezone
        .parse()
        .map_err(|_| CoreError::Validation("zona horaria desconocida".into()))?;
    let local = tz
        .timestamp_millis_opt(master.start_at)
        .single()
        .ok_or(CoreError::Validation("fecha no válida".into()))?;
    Ok(format!(
        "DTSTART;TZID={}:{}",
        master.timezone,
        local.format("%Y%m%dT%H%M%S")
    ))
}

fn rule_set(master: &Event, rule: &str) -> Result<RRuleSet> {
    format!("{}\nRRULE:{}", dtstart_line(master)?, rule)
        .parse::<RRuleSet>()
        .map_err(|_| CoreError::Validation("regla de repetición no válida".into()))
}

fn utc(ms: i64) -> Result<DateTime<Tz>> {
    Tz::UTC
        .timestamp_millis_opt(ms)
        .single()
        .ok_or(CoreError::Validation("fecha fuera de rango".into()))
}

/// Inicios (ms UTC) de las ocurrencias que se solapan con `[from, to)`.
pub fn occurrences(master: &Event, rule: &str, from: i64, to: i64) -> Result<Vec<i64>> {
    let duration = (master.end_at - master.start_at).max(0);
    // Una ocurrencia [s, s+d) se solapa si s < to y s + d > from (o s >= from si d = 0).
    let after = if duration == 0 {
        from
    } else {
        from - duration + 1
    };
    let set = rule_set(master, rule)?
        .after(utc(after)?)
        .before(utc(to - 1)?);
    Ok(set
        .all(MAX_INSTANCES_PER_QUERY)
        .dates
        .iter()
        .map(|d| d.timestamp_millis())
        .collect())
}

/// ¿Es `original_start` exactamente una ocurrencia de la serie?
pub fn is_occurrence(master: &Event, rule: &str, original_start: i64) -> Result<bool> {
    let set = rule_set(master, rule)?
        .after(utc(original_start)?)
        .before(utc(original_start)?);
    Ok(set
        .all(1)
        .dates
        .iter()
        .any(|d| d.timestamp_millis() == original_start))
}

/// Fin del último instante que puede ocupar la serie, o `None` si es infinita
/// (o tan larga que no merece la pena acotarla).
pub fn series_end(master: &Event, rule: &str) -> Result<Option<i64>> {
    let ps = parts(rule);
    if !ps.iter().any(|(k, _)| k == "COUNT" || k == "UNTIL") {
        return Ok(None);
    }
    let res = rule_set(master, rule)?.all(u16::MAX);
    if res.limited {
        return Ok(None);
    }
    let duration = (master.end_at - master.start_at).max(0);
    Ok(Some(
        res.dates
            .last()
            .map(|d| d.timestamp_millis() + duration)
            .unwrap_or(master.end_at),
    ))
}

/// Número de ocurrencias anteriores a `t`.
pub fn count_before(master: &Event, rule: &str, t: i64) -> Result<u32> {
    if t <= master.start_at {
        return Ok(0);
    }
    let set = rule_set(master, rule)?.before(utc(t - 1)?);
    Ok(set.all(u16::MAX).dates.len() as u32)
}

/// Regla que termina justo antes de `t` (para "esta y las siguientes").
pub fn rule_ending_before(rule: &str, t: i64) -> Result<String> {
    let until = Utc
        .timestamp_millis_opt(t - 1000)
        .single()
        .ok_or(CoreError::Validation("fecha no válida".into()))?;
    let mut ps: Vec<(String, String)> = parts(rule)
        .into_iter()
        .filter(|(k, _)| k != "COUNT" && k != "UNTIL")
        .collect();
    ps.push(("UNTIL".into(), until.format("%Y%m%dT%H%M%SZ").to_string()));
    Ok(join(&ps))
}

/// Ajusta COUNT al partir una serie: la nueva serie hereda las repeticiones restantes.
pub fn rule_with_remaining_count(rule: &str, already: u32) -> String {
    let ps: Vec<(String, String)> = parts(rule)
        .into_iter()
        .map(|(k, v)| {
            if k == "COUNT" {
                let n: u32 = v.parse().unwrap_or(1);
                (k, n.saturating_sub(already).max(1).to_string())
            } else {
                (k, v)
            }
        })
        .collect();
    join(&ps)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::event::{Availability, EventStatus, Visibility};

    fn master(start: DateTime<Utc>, minutes: i64, tz: &str, all_day: bool) -> Event {
        Event {
            id: "m".into(),
            calendar_id: "c".into(),
            title: String::new(),
            description: String::new(),
            location: String::new(),
            links: vec![],
            color: None,
            start_at: start.timestamp_millis(),
            end_at: start.timestamp_millis() + minutes * 60_000,
            timezone: tz.into(),
            is_all_day: all_day,
            visibility: Visibility::Default,
            availability: Availability::Busy,
            status: EventStatus::Confirmed,
            is_recurring: true,
            recurrence_master_id: None,
            original_start_at: None,
            recurrence: None,
            reminders: vec![],
            created_at: 0,
            updated_at: 0,
        }
    }

    fn ms(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> i64 {
        Utc.with_ymd_and_hms(y, mo, d, h, mi, 0)
            .unwrap()
            .timestamp_millis()
    }

    #[test]
    fn validation() {
        assert_eq!(
            validate_rule("freq=weekly;byday=MO,WE").unwrap(),
            "FREQ=WEEKLY;BYDAY=MO,WE"
        );
        assert_eq!(validate_rule("RRULE:FREQ=DAILY").unwrap(), "FREQ=DAILY");
        assert!(validate_rule("FREQ=SECONDLY").is_err());
        assert!(validate_rule("FREQ=MINUTELY").is_err());
        assert!(validate_rule("FREQ=DAILY;INTERVAL=0").is_err());
        assert!(validate_rule("FREQ=DAILY;COUNT=999999").is_err());
        assert!(validate_rule("FREQ=DAILY;COUNT=3;UNTIL=20270101T000000Z").is_err());
        assert!(validate_rule("FREQ=DAILY;BYHOUR=3").is_err());
        assert!(validate_rule("FREQ=DAILY\nDTSTART:20200101T000000Z").is_err());
        assert!(validate_rule("").is_err());
    }

    #[test]
    fn weekly_keeps_local_time_across_dst() {
        // Nueva York cambia de horario el 1 de noviembre de 2026.
        let start = Utc.with_ymd_and_hms(2026, 10, 26, 13, 0, 0).unwrap(); // lunes 9:00 EDT
        let m = master(start, 60, "America/New_York", false);
        let occ = occurrences(
            &m,
            "FREQ=WEEKLY;COUNT=3",
            ms(2026, 10, 1, 0, 0),
            ms(2026, 12, 1, 0, 0),
        )
        .unwrap();
        assert_eq!(occ.len(), 3);
        assert_eq!(occ[0], ms(2026, 10, 26, 13, 0)); // 9:00 EDT = 13:00 UTC
        assert_eq!(occ[1], ms(2026, 11, 2, 14, 0)); // 9:00 EST = 14:00 UTC
    }

    #[test]
    fn range_overlap_and_bounds() {
        let start = Utc.with_ymd_and_hms(2026, 11, 2, 9, 0, 0).unwrap();
        let m = master(start, 120, "UTC", false);
        // Una ocurrencia que empezó antes del rango pero sigue en curso cuenta.
        let occ = occurrences(
            &m,
            "FREQ=DAILY",
            ms(2026, 11, 3, 10, 0),
            ms(2026, 11, 3, 12, 0),
        )
        .unwrap();
        assert_eq!(occ, vec![ms(2026, 11, 3, 9, 0)]);
        // La que termina justo al empezar el rango no cuenta.
        let occ = occurrences(
            &m,
            "FREQ=DAILY",
            ms(2026, 11, 3, 11, 0),
            ms(2026, 11, 3, 12, 0),
        )
        .unwrap();
        assert!(occ.is_empty());
        assert!(is_occurrence(&m, "FREQ=DAILY", ms(2026, 11, 5, 9, 0)).unwrap());
        assert!(!is_occurrence(&m, "FREQ=DAILY", ms(2026, 11, 5, 9, 30)).unwrap());
    }

    #[test]
    fn series_end_and_split_helpers() {
        let start = Utc.with_ymd_and_hms(2026, 11, 2, 9, 0, 0).unwrap();
        let m = master(start, 60, "UTC", false);
        assert_eq!(series_end(&m, "FREQ=DAILY").unwrap(), None);
        assert_eq!(
            series_end(&m, "FREQ=DAILY;COUNT=3").unwrap(),
            Some(ms(2026, 11, 4, 10, 0))
        );
        assert_eq!(
            count_before(&m, "FREQ=DAILY", ms(2026, 11, 5, 9, 0)).unwrap(),
            3
        );
        let cut = rule_ending_before("FREQ=DAILY;COUNT=10", ms(2026, 11, 5, 9, 0)).unwrap();
        assert_eq!(cut, "FREQ=DAILY;UNTIL=20261105T085959Z");
        assert_eq!(
            occurrences(&m, &cut, ms(2026, 1, 1, 0, 0), ms(2027, 1, 1, 0, 0))
                .unwrap()
                .len(),
            3
        );
        assert_eq!(
            rule_with_remaining_count("FREQ=DAILY;COUNT=10", 3),
            "FREQ=DAILY;COUNT=7"
        );
    }

    #[test]
    fn all_day_series_are_floating_dates() {
        let start = Utc.with_ymd_and_hms(2026, 11, 1, 0, 0, 0).unwrap();
        let m = master(start, 24 * 60, "America/Mexico_City", true);
        let occ = occurrences(
            &m,
            "FREQ=MONTHLY;COUNT=3",
            ms(2026, 1, 1, 0, 0),
            ms(2027, 6, 1, 0, 0),
        )
        .unwrap();
        assert_eq!(
            occ,
            vec![
                ms(2026, 11, 1, 0, 0),
                ms(2026, 12, 1, 0, 0),
                ms(2027, 1, 1, 0, 0)
            ]
        );
    }
}
