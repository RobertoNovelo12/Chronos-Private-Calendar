//! iCalendar (RFC 5545): escritura y lectura.
//!
//! Exportación:
//! * Eventos sueltos con hora: en UTC (`...Z`), interpretables por cualquier cliente.
//! * Series y sus excepciones: `DTSTART;TZID=<zona IANA>` para que la serie
//!   conserve la hora local tras los cambios de horario. No se incluyen
//!   componentes VTIMEZONE (los principales clientes resuelven las zonas IANA).
//! * Día completo: `VALUE=DATE` con fin exclusivo.
//!
//! Importación: VEVENT con SUMMARY, DESCRIPTION, LOCATION, URL, DTSTART,
//! DTEND/DURATION, RRULE, EXDATE, RECURRENCE-ID, TRANSP, CLASS, STATUS y
//! VALARM (avisos relativos al inicio). Zonas IANA, UTC, hora flotante y los
//! nombres de zona de Windows más comunes.

use super::{ExportItem, ImportBatch, ImportEvent, ImportTask, TaskItem};
use crate::error::{CoreError, Result};
use crate::models::event::{
    Attendee, AttendeeRole, AttendeeStatus, Availability, EventLink, EventStatus, Visibility,
    DAY_MS,
};
use crate::recurrence;
use chrono::{NaiveDate, NaiveDateTime, TimeZone, Utc};

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace(';', "\\;")
        .replace(',', "\\,")
        .replace("\r\n", "\\n")
        .replace('\n', "\\n")
        .replace('\r', "")
}

/// Pliega líneas a 75 octetos sin partir caracteres UTF-8 (RFC 5545 §3.1).
fn fold(line: &str, out: &mut String) {
    let mut count = 0;
    for ch in line.chars() {
        let len = ch.len_utf8();
        if count + len > 75 {
            out.push_str("\r\n ");
            count = 1;
        }
        out.push(ch);
        count += len;
    }
    out.push_str("\r\n");
}

fn utc_stamp(ms: i64) -> String {
    Utc.timestamp_millis_opt(ms)
        .single()
        .map(|d| d.format("%Y%m%dT%H%M%SZ").to_string())
        .unwrap_or_default()
}

fn date_value(ms: i64) -> String {
    Utc.timestamp_millis_opt(ms)
        .single()
        .map(|d| d.format("%Y%m%d").to_string())
        .unwrap_or_default()
}

/// `;TZID=...:local`, `:...Z` o `;VALUE=DATE:...` según el caso.
fn dt_prop(name: &str, ms: i64, tz: &str, all_day: bool, local: bool) -> String {
    if all_day {
        return format!("{name};VALUE=DATE:{}", date_value(ms));
    }
    if local && tz != "UTC" {
        if let Ok(zone) = tz.parse::<chrono_tz::Tz>() {
            if let Some(d) = zone.timestamp_millis_opt(ms).single() {
                return format!("{name};TZID={tz}:{}", d.format("%Y%m%dT%H%M%S"));
            }
        }
    }
    format!("{name}:{}", utc_stamp(ms))
}

fn trigger(minutes: i32) -> String {
    if minutes == 0 {
        return "PT0S".into();
    }
    let d = minutes / 1440;
    let h = (minutes % 1440) / 60;
    let m = minutes % 60;
    let mut s = String::from("-P");
    if d > 0 {
        s.push_str(&format!("{d}D"));
    }
    if h > 0 || m > 0 {
        s.push('T');
        if h > 0 {
            s.push_str(&format!("{h}H"));
        }
        if m > 0 {
            s.push_str(&format!("{m}M"));
        }
    }
    s
}

pub fn write(items: &[ExportItem], tasks: &[TaskItem], calendar_name: Option<&str>) -> String {
    let mut out = String::new();
    let stamp = utc_stamp(Utc::now().timestamp_millis());
    for l in [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Chronos Private Calendar//ES",
        "CALSCALE:GREGORIAN",
    ] {
        fold(l, &mut out);
    }
    if let Some(n) = calendar_name {
        fold(&format!("X-WR-CALNAME:{}", escape(n)), &mut out);
    }
    for it in items {
        let e = &it.event;
        let series = e.recurrence.is_some() && e.recurrence_master_id.is_none();
        let local = series || it.recurrence_id.is_some();
        fold("BEGIN:VEVENT", &mut out);
        fold(&format!("UID:{}", escape(&it.uid)), &mut out);
        fold(&format!("DTSTAMP:{stamp}"), &mut out);
        if let Some((t, tz, all_day)) = &it.recurrence_id {
            fold(&dt_prop("RECURRENCE-ID", *t, tz, *all_day, true), &mut out);
        }
        fold(
            &dt_prop("DTSTART", e.start_at, &e.timezone, e.is_all_day, local),
            &mut out,
        );
        fold(
            &dt_prop("DTEND", e.end_at, &e.timezone, e.is_all_day, local),
            &mut out,
        );
        if series {
            if let Some(rule) = &e.recurrence {
                fold(&format!("RRULE:{rule}"), &mut out);
            }
            for x in &it.exdates {
                fold(
                    &dt_prop("EXDATE", *x, &e.timezone, e.is_all_day, true),
                    &mut out,
                );
            }
        }
        fold(&format!("SUMMARY:{}", escape(&e.title)), &mut out);
        if !e.description.is_empty() {
            fold(&format!("DESCRIPTION:{}", escape(&e.description)), &mut out);
        }
        if !e.location.is_empty() {
            fold(&format!("LOCATION:{}", escape(&e.location)), &mut out);
        }
        if let Some(link) = e.links.iter().find(|l| l.url.starts_with("http")) {
            fold(&format!("URL:{}", link.url), &mut out);
        }
        // Participantes: solo los que tienen correo (iCalendar exige una dirección).
        for a in e.attendees.iter().filter(|a| !a.email.is_empty()) {
            fold(&attendee_prop(a), &mut out);
        }
        // CATEGORIES lleva las etiquetas (Outlook y Apple las muestran como categorías).
        if !it.labels.is_empty() {
            let cats: Vec<String> = it.labels.iter().map(|l| escape(l)).collect();
            fold(&format!("CATEGORIES:{}", cats.join(",")), &mut out);
        }
        fold(
            if e.availability == Availability::Free {
                "TRANSP:TRANSPARENT"
            } else {
                "TRANSP:OPAQUE"
            },
            &mut out,
        );
        match e.visibility {
            Visibility::Public => fold("CLASS:PUBLIC", &mut out),
            Visibility::Private => fold("CLASS:PRIVATE", &mut out),
            Visibility::Confidential => fold("CLASS:CONFIDENTIAL", &mut out),
            Visibility::Default => {}
        }
        match e.status {
            EventStatus::Tentative => fold("STATUS:TENTATIVE", &mut out),
            EventStatus::Cancelled => fold("STATUS:CANCELLED", &mut out),
            EventStatus::Confirmed => fold("STATUS:CONFIRMED", &mut out),
        }
        for m in &e.reminders {
            fold("BEGIN:VALARM", &mut out);
            fold("ACTION:DISPLAY", &mut out);
            fold("DESCRIPTION:Recordatorio", &mut out);
            fold(&format!("TRIGGER:{}", trigger(*m)), &mut out);
            fold("END:VALARM", &mut out);
        }
        fold("END:VEVENT", &mut out);
    }
    for it in tasks {
        write_todo(it, &stamp, &mut out);
    }
    fold("END:VCALENDAR", &mut out);
    out
}

/// Valor de parámetro entre comillas si lo necesita (RFC 5545 §3.2).
fn param_value(v: &str) -> String {
    let clean: String = v.chars().filter(|c| *c != '"' && !c.is_control()).collect();
    if clean.contains([':', ';', ',']) {
        format!("\"{clean}\"")
    } else {
        clean
    }
}

fn attendee_prop(a: &Attendee) -> String {
    let cn = if a.name.is_empty() {
        String::new()
    } else {
        format!(";CN={}", param_value(&a.name))
    };
    if a.role == AttendeeRole::Organizer {
        return format!("ORGANIZER{cn}:mailto:{}", a.email);
    }
    let role = match a.role {
        AttendeeRole::Optional => "OPT-PARTICIPANT",
        _ => "REQ-PARTICIPANT",
    };
    let stat = match a.status {
        AttendeeStatus::Accepted => "ACCEPTED",
        AttendeeStatus::Declined => "DECLINED",
        AttendeeStatus::Tentative => "TENTATIVE",
        AttendeeStatus::NeedsAction => "NEEDS-ACTION",
    };
    format!(
        "ATTENDEE{cn};ROLE={role};PARTSTAT={stat}:mailto:{}",
        a.email
    )
}

/// ORGANIZER y ATTENDEE de un VEVENT. El organizador no se repite como asistente.
fn attendees_of(props: &[Prop]) -> Vec<Attendee> {
    let email = |v: &str| {
        let v = v.trim();
        let v = v
            .get(..7)
            .filter(|p| p.eq_ignore_ascii_case("mailto:"))
            .map_or(v, |_| &v[7..]);
        v.trim().to_ascii_lowercase()
    };
    let mut out: Vec<Attendee> = Vec::new();
    if let Some(o) = props.iter().find(|p| p.name == "ORGANIZER") {
        out.push(Attendee {
            name: o
                .param("CN")
                .map(|c| c.trim_matches('"').to_string())
                .unwrap_or_default(),
            email: email(&o.value),
            role: AttendeeRole::Organizer,
            status: AttendeeStatus::Accepted,
        });
    }
    for p in props.iter().filter(|p| p.name == "ATTENDEE") {
        let mail = email(&p.value);
        if out.iter().any(|a| !mail.is_empty() && a.email == mail) {
            continue;
        }
        let up = |k: &str| p.param(k).map(|v| v.trim_matches('"').to_ascii_uppercase());
        out.push(Attendee {
            name: p
                .param("CN")
                .map(|c| c.trim_matches('"').to_string())
                .unwrap_or_default(),
            email: mail,
            role: match up("ROLE").as_deref() {
                Some("OPT-PARTICIPANT" | "NON-PARTICIPANT") => AttendeeRole::Optional,
                _ => AttendeeRole::Required,
            },
            status: match up("PARTSTAT").as_deref() {
                Some("ACCEPTED") => AttendeeStatus::Accepted,
                Some("DECLINED") => AttendeeStatus::Declined,
                Some("TENTATIVE") => AttendeeStatus::Tentative,
                _ => AttendeeStatus::NeedsAction,
            },
        });
    }
    out
}

/// Prioridad de Chronos (0 ninguna, 1 baja, 2 media, 3 alta) ↔ iCalendar (1 alta … 9 baja).
fn ics_priority(p: u8) -> Option<u8> {
    match p {
        3 => Some(1),
        2 => Some(5),
        1 => Some(9),
        _ => None,
    }
}

fn chronos_priority(v: &str) -> u8 {
    match v.trim().parse::<u8>() {
        Ok(1..=4) => 3,
        Ok(5) => 2,
        Ok(6..=9) => 1,
        _ => 0,
    }
}

/// Tarea como VTODO. Los recordatorios se relacionan con el vencimiento (RELATED=END).
fn write_todo(it: &TaskItem, stamp: &str, out: &mut String) {
    let t = &it.task;
    fold("BEGIN:VTODO", out);
    fold(&format!("UID:{}", escape(&it.uid)), out);
    fold(&format!("DTSTAMP:{stamp}"), out);
    fold(&format!("SUMMARY:{}", escape(&t.title)), out);
    if !t.notes.is_empty() {
        fold(&format!("DESCRIPTION:{}", escape(&t.notes)), out);
    }
    if let Some(due) = t.due_at {
        fold(&dt_prop("DUE", due, "UTC", t.is_all_day, false), out);
    }
    if let Some(p) = ics_priority(t.priority) {
        fold(&format!("PRIORITY:{p}"), out);
    }
    match t.completed_at {
        Some(done) => {
            fold("STATUS:COMPLETED", out);
            fold(&format!("COMPLETED:{}", utc_stamp(done)), out);
        }
        None => fold("STATUS:NEEDS-ACTION", out),
    }
    if t.due_at.is_some() {
        for m in &t.reminders {
            fold("BEGIN:VALARM", out);
            fold("ACTION:DISPLAY", out);
            fold("DESCRIPTION:Recordatorio", out);
            fold(&format!("TRIGGER;RELATED=END:{}", trigger(*m)), out);
            fold("END:VALARM", out);
        }
    }
    fold("END:VTODO", out);
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct Prop {
    name: String,
    params: Vec<(String, String)>,
    value: String,
}

impl Prop {
    fn param(&self, key: &str) -> Option<&str> {
        self.params
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(key))
            .map(|(_, v)| v.as_str())
    }
}

fn unfold(text: &str) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for raw in text.split('\n') {
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        if let Some(rest) = line.strip_prefix(' ').or_else(|| line.strip_prefix('\t')) {
            if let Some(last) = lines.last_mut() {
                last.push_str(rest);
                continue;
            }
        }
        if !line.is_empty() {
            lines.push(line.to_string());
        }
    }
    lines
}

fn parse_prop(line: &str) -> Option<Prop> {
    // El nombre y los parámetros terminan en el primer ':' fuera de comillas.
    let mut in_quotes = false;
    let mut split = None;
    for (i, c) in line.char_indices() {
        match c {
            '"' => in_quotes = !in_quotes,
            ':' if !in_quotes => {
                split = Some(i);
                break;
            }
            _ => {}
        }
    }
    let i = split?;
    let (head, value) = (&line[..i], &line[i + 1..]);
    // Los parámetros se separan por ';' fuera de comillas (CN="Apellido; Nombre").
    let mut pieces: Vec<&str> = Vec::new();
    let (mut start, mut quoted) = (0, false);
    for (j, c) in head.char_indices() {
        match c {
            '"' => quoted = !quoted,
            ';' if !quoted => {
                pieces.push(&head[start..j]);
                start = j + 1;
            }
            _ => {}
        }
    }
    pieces.push(&head[start..]);
    let mut parts = pieces.into_iter();
    let name = parts.next()?.trim().to_ascii_uppercase();
    let params = parts
        .filter_map(|p| {
            let (k, v) = p.split_once('=')?;
            Some((
                k.trim().to_ascii_uppercase(),
                v.trim().trim_matches('"').to_string(),
            ))
        })
        .collect();
    Some(Prop {
        name,
        params,
        value: value.to_string(),
    })
}

fn unescape(v: &str) -> String {
    let mut out = String::with_capacity(v.len());
    let mut chars = v.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') | Some('N') => out.push('\n'),
                Some(other) => out.push(other),
                None => {}
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Nombres de zona de Windows (Outlook) más comunes → IANA.
fn windows_zone(name: &str) -> Option<&'static str> {
    Some(match name {
        "Pacific Standard Time" => "America/Los_Angeles",
        "Mountain Standard Time" => "America/Denver",
        "Central Standard Time" => "America/Chicago",
        "Eastern Standard Time" => "America/New_York",
        "Central Standard Time (Mexico)" | "Central America Standard Time" => "America/Mexico_City",
        "Eastern Standard Time (Mexico)" => "America/Cancun",
        "Mountain Standard Time (Mexico)" => "America/Mazatlan",
        "Pacific Standard Time (Mexico)" => "America/Tijuana",
        "SA Pacific Standard Time" => "America/Bogota",
        "SA Western Standard Time" => "America/La_Paz",
        "Pacific SA Standard Time" => "America/Santiago",
        "Argentina Standard Time" => "America/Argentina/Buenos_Aires",
        "E. South America Standard Time" => "America/Sao_Paulo",
        "Venezuela Standard Time" => "America/Caracas",
        "GMT Standard Time" => "Europe/London",
        "Romance Standard Time" => "Europe/Madrid",
        "W. Europe Standard Time" => "Europe/Berlin",
        "Central Europe Standard Time" => "Europe/Budapest",
        "India Standard Time" => "Asia/Kolkata",
        "China Standard Time" => "Asia/Shanghai",
        "Tokyo Standard Time" => "Asia/Tokyo",
        "AUS Eastern Standard Time" => "Australia/Sydney",
        "UTC" | "Coordinated Universal Time" => "UTC",
        _ => return None,
    })
}

fn resolve_tz(tzid: &str) -> Option<String> {
    let t = tzid.trim();
    if t.parse::<chrono_tz::Tz>().is_ok() {
        return Some(t.to_string());
    }
    if let Some(w) = windows_zone(t) {
        return Some(w.to_string());
    }
    // Prefijos tipo "/mozilla.org/20050126_1/America/New_York".
    let segs: Vec<&str> = t.split('/').filter(|s| !s.is_empty()).collect();
    for start in 0..segs.len() {
        let cand = segs[start..].join("/");
        if cand.parse::<chrono_tz::Tz>().is_ok() {
            return Some(cand);
        }
    }
    None
}

/// Valor de fecha/hora → (ms UTC, día completo, zona).
fn parse_dt_value(
    value: &str,
    tzid: Option<&str>,
    value_type: Option<&str>,
    default_tz: &str,
) -> Option<(i64, bool, String)> {
    let v = value.trim();
    if value_type.is_some_and(|t| t.eq_ignore_ascii_case("DATE"))
        || (v.len() == 8 && v.chars().all(|c| c.is_ascii_digit()))
    {
        let d = NaiveDate::parse_from_str(&v[..8.min(v.len())], "%Y%m%d").ok()?;
        let ms = Utc
            .from_utc_datetime(&d.and_hms_opt(0, 0, 0)?)
            .timestamp_millis();
        return Some((ms, true, default_tz.to_string()));
    }
    let (body, utc) = match v.strip_suffix('Z').or_else(|| v.strip_suffix('z')) {
        Some(b) => (b, true),
        None => (v, false),
    };
    let naive = NaiveDateTime::parse_from_str(body, "%Y%m%dT%H%M%S").ok()?;
    if utc {
        return Some((
            Utc.from_utc_datetime(&naive).timestamp_millis(),
            false,
            default_tz.to_string(),
        ));
    }
    let tz_name = tzid
        .and_then(resolve_tz)
        .unwrap_or_else(|| default_tz.to_string());
    let ms = if tz_name == "UTC" {
        Utc.from_utc_datetime(&naive).timestamp_millis()
    } else {
        let zone: chrono_tz::Tz = tz_name.parse().ok()?;
        match zone.from_local_datetime(&naive) {
            chrono::LocalResult::Single(d) => d.timestamp_millis(),
            chrono::LocalResult::Ambiguous(d, _) => d.timestamp_millis(),
            // Hora inexistente (cambio de horario): se avanza una hora.
            chrono::LocalResult::None => zone
                .from_local_datetime(&(naive + chrono::Duration::hours(1)))
                .earliest()?
                .timestamp_millis(),
        }
    };
    Some((ms, false, tz_name))
}

fn parse_dt(p: &Prop, default_tz: &str) -> Option<(i64, bool, String)> {
    parse_dt_value(&p.value, p.param("TZID"), p.param("VALUE"), default_tz)
}

/// Duración ISO 8601 de RFC 5545 → ms (con signo).
fn parse_duration(s: &str) -> Option<i64> {
    let s = s.trim();
    let (neg, rest) = match s.strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, s.strip_prefix('+').unwrap_or(s)),
    };
    let rest = rest.strip_prefix('P')?;
    let mut total: i64 = 0;
    let mut num = String::new();
    let mut in_time = false;
    for c in rest.chars() {
        match c {
            'T' => in_time = true,
            '0'..='9' => num.push(c),
            _ => {
                let n: i64 = num.parse().ok()?;
                num.clear();
                total += n * match (c, in_time) {
                    ('W', false) => 7 * DAY_MS,
                    ('D', false) => DAY_MS,
                    ('H', true) => 3_600_000,
                    ('M', true) => 60_000,
                    ('S', true) => 1000,
                    _ => return None,
                };
            }
        }
    }
    if !num.is_empty() {
        return None;
    }
    Some(if neg { -total } else { total })
}

/// UNTIL solo con fecha → fin de ese día en UTC (compatible con DTSTART con hora).
fn normalize_rule(rule: &str, all_day: bool) -> String {
    rule.split(';')
        .map(|part| match part.split_once('=') {
            Some((k, v)) if k.eq_ignore_ascii_case("UNTIL") && v.len() == 8 && !all_day => {
                format!("UNTIL={v}T235959Z")
            }
            Some((k, v)) if k.eq_ignore_ascii_case("UNTIL") && v.len() == 8 => {
                format!("UNTIL={v}T000000Z")
            }
            _ => part.to_string(),
        })
        .collect::<Vec<_>>()
        .join(";")
}

pub fn parse(text: &str, default_tz: &str) -> Result<ImportBatch> {
    let lines = unfold(text);
    if !lines
        .iter()
        .any(|l| l.eq_ignore_ascii_case("BEGIN:VCALENDAR"))
    {
        return Err(CoreError::Validation(
            "el archivo no es un calendario iCalendar (.ics)".into(),
        ));
    }
    let mut batch = ImportBatch::default();
    let mut current: Option<Vec<Prop>> = None;
    // true si el componente abierto es una tarea (VTODO).
    let mut in_todo = false;
    let mut alarms: Vec<i32> = Vec::new();
    let mut in_alarm = false;
    let mut alarm_trigger: Option<Prop> = None;
    let mut depth_other = 0usize;

    for line in &lines {
        let Some(p) = parse_prop(line) else { continue };
        match (p.name.as_str(), p.value.to_ascii_uppercase().as_str()) {
            ("BEGIN", "VEVENT" | "VTODO") if current.is_none() => {
                current = Some(Vec::new());
                in_todo = p.value.eq_ignore_ascii_case("VTODO");
                alarms.clear();
            }
            ("BEGIN", "VALARM") if current.is_some() => {
                in_alarm = true;
                alarm_trigger = None;
            }
            ("END", "VALARM") if in_alarm => {
                in_alarm = false;
                if let Some(t) = alarm_trigger.take() {
                    let related_end = t
                        .param("RELATED")
                        .is_some_and(|r| r.eq_ignore_ascii_case("END"));
                    let absolute = t
                        .param("VALUE")
                        .is_some_and(|v| v.eq_ignore_ascii_case("DATE-TIME"));
                    // En tareas el aviso se relaciona con el vencimiento (DUE).
                    if (in_todo || !related_end) && !absolute {
                        if let Some(ms) = parse_duration(&t.value) {
                            if ms <= 0 {
                                alarms.push((-ms / 60_000) as i32);
                            }
                        }
                    }
                }
            }
            ("END", "VTODO") if in_todo => {
                in_todo = false;
                if let Some(props) = current.take() {
                    if let Some(t) = build_task(&props, std::mem::take(&mut alarms), default_tz) {
                        batch.tasks.push(t);
                    }
                }
            }
            ("END", "VEVENT") => {
                if let Some(props) = current.take() {
                    if let Some(ev) = build_event(
                        &props,
                        std::mem::take(&mut alarms),
                        default_tz,
                        &mut batch.rules_dropped,
                    ) {
                        batch.events.push(ev);
                    }
                }
            }
            ("BEGIN", _) if current.is_some() && !in_alarm => depth_other += 1,
            ("END", _) if current.is_some() && !in_alarm && depth_other > 0 => depth_other -= 1,
            _ => {
                if in_alarm {
                    if p.name == "TRIGGER" {
                        alarm_trigger = Some(p);
                    }
                } else if let Some(props) = current.as_mut() {
                    if depth_other == 0 {
                        props.push(p);
                    }
                } else if p.name == "X-WR-CALNAME" && batch.calendar_name.is_none() {
                    batch.calendar_name = Some(unescape(&p.value));
                }
            }
        }
        if batch.events.len() + batch.tasks.len() > super::MAX_IMPORT_EVENTS {
            return Err(CoreError::Validation(
                "el archivo tiene demasiados eventos".into(),
            ));
        }
    }
    Ok(batch)
}

fn build_event(
    props: &[Prop],
    alarms: Vec<i32>,
    default_tz: &str,
    rules_dropped: &mut usize,
) -> Option<ImportEvent> {
    let get = |n: &str| props.iter().find(|p| p.name == n);
    let start_prop = get("DTSTART")?;
    let (start_at, is_all_day, timezone) = parse_dt(start_prop, default_tz)?;
    let end_at = if let Some(end) = get("DTEND").and_then(|p| parse_dt(p, default_tz)) {
        end.0
    } else if let Some(d) = get("DURATION").and_then(|p| parse_duration(&p.value)) {
        start_at + d.max(0)
    } else if is_all_day {
        start_at + DAY_MS
    } else {
        start_at
    };
    let end_at = if is_all_day && end_at <= start_at {
        start_at + DAY_MS
    } else {
        end_at.max(start_at)
    };

    let recurrence = get("RRULE").and_then(|p| {
        let rule = normalize_rule(&p.value, is_all_day);
        match recurrence::validate_rule(&rule) {
            Ok(r) => Some(r),
            Err(_) => {
                *rules_dropped += 1;
                None
            }
        }
    });
    let mut exdates = Vec::new();
    for p in props.iter().filter(|p| p.name == "EXDATE") {
        for v in p.value.split(',') {
            if let Some((ms, _, _)) =
                parse_dt_value(v, p.param("TZID"), p.param("VALUE"), &timezone)
            {
                exdates.push(ms);
            }
        }
    }
    let recurrence_id = get("RECURRENCE-ID")
        .and_then(|p| parse_dt(p, &timezone))
        .map(|(ms, _, _)| ms);
    let text = |n: &str| get(n).map(|p| unescape(&p.value)).unwrap_or_default();
    let links = get("URL")
        .map(|p| p.value.trim().to_string())
        .filter(|u| u.starts_with("https://") || u.starts_with("http://"))
        .map(|url| {
            vec![EventLink {
                label: String::new(),
                url,
            }]
        })
        .unwrap_or_default();

    Some(ImportEvent {
        uid: get("UID")
            .map(|p| unescape(&p.value))
            .filter(|u| !u.trim().is_empty()),
        title: text("SUMMARY"),
        description: text("DESCRIPTION"),
        location: text("LOCATION"),
        links,
        start_at,
        end_at,
        timezone,
        is_all_day,
        availability: get("TRANSP").and_then(|p| {
            p.value
                .eq_ignore_ascii_case("TRANSPARENT")
                .then_some(Availability::Free)
        }),
        visibility: get("CLASS").and_then(|p| match p.value.to_ascii_uppercase().as_str() {
            "PUBLIC" => Some(Visibility::Public),
            "PRIVATE" => Some(Visibility::Private),
            "CONFIDENTIAL" => Some(Visibility::Confidential),
            _ => None,
        }),
        status: get("STATUS").and_then(|p| match p.value.to_ascii_uppercase().as_str() {
            "TENTATIVE" => Some(EventStatus::Tentative),
            "CANCELLED" => Some(EventStatus::Cancelled),
            "CONFIRMED" => Some(EventStatus::Confirmed),
            _ => None,
        }),
        recurrence,
        reminders: alarms,
        exdates,
        recurrence_id,
        labels: categories(props),
        attendees: attendees_of(props),
    })
}

fn build_task(props: &[Prop], alarms: Vec<i32>, default_tz: &str) -> Option<ImportTask> {
    let get = |n: &str| props.iter().find(|p| p.name == n);
    let text = |n: &str| get(n).map(|p| unescape(&p.value)).unwrap_or_default();
    let title = text("SUMMARY");
    if title.trim().is_empty() {
        return None;
    }
    // Vencimiento: DUE, o DTSTART si no hay DUE.
    let due = get("DUE")
        .or_else(|| get("DTSTART"))
        .and_then(|p| parse_dt(p, default_tz));
    let status = get("STATUS").map(|p| p.value.to_ascii_uppercase());
    if status.as_deref() == Some("CANCELLED") {
        return None;
    }
    let completed_at = get("COMPLETED")
        .and_then(|p| parse_dt(p, "UTC"))
        .map(|d| d.0)
        .or_else(|| (status.as_deref() == Some("COMPLETED")).then(crate::database::now_ms));
    Some(ImportTask {
        uid: get("UID")
            .map(|p| unescape(&p.value))
            .filter(|u| !u.trim().is_empty()),
        title,
        notes: text("DESCRIPTION"),
        due_at: due.as_ref().map(|d| d.0),
        is_all_day: due.as_ref().is_some_and(|d| d.1),
        priority: get("PRIORITY")
            .map(|p| chronos_priority(&p.value))
            .unwrap_or(0),
        completed_at,
        reminders: if due.is_some() { alarms } else { vec![] },
    })
}

/// Valores de todas las propiedades CATEGORIES (separados por comas no escapadas).
fn categories(props: &[Prop]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for p in props.iter().filter(|p| p.name == "CATEGORIES") {
        let mut cur = String::new();
        let mut chars = p.value.chars();
        while let Some(c) = chars.next() {
            match c {
                '\\' => {
                    cur.push(c);
                    if let Some(n) = chars.next() {
                        cur.push(n);
                    }
                }
                ',' => out.push(std::mem::take(&mut cur)),
                _ => cur.push(c),
            }
        }
        out.push(cur);
    }
    let mut seen = Vec::new();
    for name in out.into_iter().map(|v| unescape(&v).trim().to_string()) {
        if !name.is_empty() && !seen.iter().any(|s: &String| s.eq_ignore_ascii_case(&name)) {
            seen.push(name);
        }
    }
    seen
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folding_and_escaping() {
        let mut out = String::new();
        fold(&format!("SUMMARY:{}", "á".repeat(60)), &mut out);
        assert!(
            out.lines().all(|l| l.len() <= 75),
            "ninguna línea supera 75 octetos"
        );
        assert_eq!(escape("a;b,c\\d\ne"), "a\\;b\\,c\\\\d\\ne");
        assert_eq!(unescape("a\\;b\\,c\\\\d\\ne"), "a;b,c\\d\ne");
        let lines = unfold("SUMMARY:Hola\r\n  mundo\r\nEND:X");
        assert_eq!(lines, vec!["SUMMARY:Hola mundo", "END:X"]);
    }

    #[test]
    fn dates_durations_and_zones() {
        assert_eq!(parse_duration("-PT15M"), Some(-900_000));
        assert_eq!(parse_duration("P1DT2H"), Some(DAY_MS + 7_200_000));
        assert_eq!(parse_duration("P1W"), Some(7 * DAY_MS));
        assert_eq!(parse_duration("PT"), Some(0));
        assert_eq!(parse_duration("X"), None);
        let (ms, all_day, _) = parse_dt_value("20261109", None, None, "UTC").unwrap();
        assert!(all_day);
        assert_eq!(ms % DAY_MS, 0);
        let (ms, _, tz) =
            parse_dt_value("20261109T093000", Some("America/New_York"), None, "UTC").unwrap();
        assert_eq!(tz, "America/New_York");
        assert_eq!(
            ms,
            Utc.with_ymd_and_hms(2026, 11, 9, 14, 30, 0)
                .unwrap()
                .timestamp_millis()
        );
        let (_, _, tz) = parse_dt_value(
            "20261109T093000",
            Some("Central Standard Time (Mexico)"),
            None,
            "UTC",
        )
        .unwrap();
        assert_eq!(tz, "America/Mexico_City");
        let (_, _, tz) = parse_dt_value(
            "20261109T093000",
            Some("/mozilla.org/20050126_1/Europe/Madrid"),
            None,
            "UTC",
        )
        .unwrap();
        assert_eq!(tz, "Europe/Madrid");
        assert_eq!(trigger(0), "PT0S");
        assert_eq!(trigger(90), "-PT1H30M");
        assert_eq!(trigger(1440), "-P1D");
    }

    #[test]
    fn parses_events_alarms_and_series() {
        let ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:Trabajo\r\n\
BEGIN:VTIMEZONE\r\nTZID:America/Mexico_City\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\n\
BEGIN:VEVENT\r\nUID:abc@x\r\nDTSTART;TZID=America/Mexico_City:20261102T090000\r\nDTEND;TZID=America/Mexico_City:20261102T093000\r\n\
RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231\r\nEXDATE;TZID=America/Mexico_City:20261109T090000\r\nSUMMARY:Reunión\\, semanal\r\n\
TRANSP:TRANSPARENT\r\nCLASS:PRIVATE\r\nBEGIN:VALARM\r\nTRIGGER:-PT10M\r\nACTION:DISPLAY\r\nEND:VALARM\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:abc@x\r\nRECURRENCE-ID;TZID=America/Mexico_City:20261116T090000\r\nDTSTART;TZID=America/Mexico_City:20261116T110000\r\n\
DTEND;TZID=America/Mexico_City:20261116T113000\r\nSUMMARY:Movida\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:d1\r\nDTSTART;VALUE=DATE:20261224\r\nSUMMARY:Nochebuena\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:bad\r\nDTSTART:20261201T100000Z\r\nRRULE:FREQ=SECONDLY\r\nSUMMARY:Regla rara\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        let b = parse(ics, "UTC").unwrap();
        assert_eq!(b.calendar_name.as_deref(), Some("Trabajo"));
        assert_eq!(b.events.len(), 4);
        let s = &b.events[0];
        assert_eq!(s.title, "Reunión, semanal");
        assert_eq!(
            s.recurrence.as_deref(),
            Some("FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231T235959Z")
        );
        assert_eq!(s.exdates.len(), 1);
        assert_eq!(s.reminders, vec![10]);
        assert_eq!(s.availability, Some(Availability::Free));
        assert_eq!(s.visibility, Some(Visibility::Private));
        assert_eq!(s.end_at - s.start_at, 30 * 60_000);
        assert!(b.events[1].recurrence_id.is_some());
        assert!(b.events[2].is_all_day);
        assert_eq!(b.events[2].end_at - b.events[2].start_at, DAY_MS);
        assert!(b.events[3].recurrence.is_none());
        assert_eq!(b.rules_dropped, 1);
        assert!(parse("hola", "UTC").is_err());
    }
}
