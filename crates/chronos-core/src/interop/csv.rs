//! CSV para hojas de cálculo (solo exportación).
//!
//! Se protege contra la inyección de fórmulas: los valores que empiezan por
//! `=`, `+`, `-`, `@`, tabulador o retorno de carro se prefijan con `'`.

use super::ExportItem;
use crate::models::event::{Availability, Visibility, DAY_MS};
use chrono::{TimeZone, Utc};

const HEADER: [&str; 11] = [
    "Título",
    "Inicio",
    "Fin",
    "Todo el día",
    "Calendario",
    "Ubicación",
    "Descripción",
    "Zona horaria",
    "Repetición",
    "Disponibilidad",
    "Privacidad",
];

pub(crate) fn cell(value: &str) -> String {
    let guarded = match value.chars().next() {
        Some('=' | '+' | '-' | '@' | '\t' | '\r') => format!("'{value}"),
        _ => value.to_string(),
    };
    if guarded.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", guarded.replace('"', "\"\""))
    } else {
        guarded
    }
}

fn local(ms: i64, tz: &str, all_day: bool) -> String {
    if all_day {
        return Utc.timestamp_millis_opt(ms).single().map(|d| d.format("%Y-%m-%d").to_string()).unwrap_or_default();
    }
    match tz.parse::<chrono_tz::Tz>() {
        Ok(zone) => zone.timestamp_millis_opt(ms).single().map(|d| d.format("%Y-%m-%d %H:%M").to_string()),
        Err(_) => Utc.timestamp_millis_opt(ms).single().map(|d| d.format("%Y-%m-%d %H:%M").to_string()),
    }
    .unwrap_or_default()
}

pub fn write(items: &[ExportItem]) -> String {
    let mut out = String::from('\u{feff}');
    out.push_str(&HEADER.join(","));
    out.push_str("\r\n");
    for it in items {
        let e = &it.event;
        // Fin inclusivo en día completo para que la hoja muestre el último día.
        let end = if e.is_all_day { e.end_at - DAY_MS } else { e.end_at };
        let series = e.recurrence.is_some() && e.recurrence_master_id.is_none();
        let row = [
            e.title.clone(),
            local(e.start_at, &e.timezone, e.is_all_day),
            local(end.max(e.start_at), &e.timezone, e.is_all_day),
            if e.is_all_day { "Sí" } else { "No" }.to_string(),
            it.calendar_name.clone(),
            e.location.clone(),
            e.description.clone(),
            e.timezone.clone(),
            if series { e.recurrence.clone().unwrap_or_default() } else { String::new() },
            match e.availability {
                Availability::Busy => "Ocupado",
                Availability::Free => "Libre",
                Availability::Tentative => "Provisional",
                Availability::OutOfOffice => "Fuera de la oficina",
            }
            .to_string(),
            match e.visibility {
                Visibility::Default => "Predeterminada",
                Visibility::Public => "Pública",
                Visibility::Private => "Privada",
                Visibility::Confidential => "Confidencial",
            }
            .to_string(),
        ];
        out.push_str(&row.iter().map(|v| cell(v)).collect::<Vec<_>>().join(","));
        out.push_str("\r\n");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::cell;

    #[test]
    fn escapes_and_blocks_formulas() {
        assert_eq!(cell("hola"), "hola");
        assert_eq!(cell("=HYPERLINK(\"x\")"), "\"'=HYPERLINK(\"\"x\"\")\"");
        assert_eq!(cell("+1"), "'+1");
        assert_eq!(cell("-5"), "'-5");
        assert_eq!(cell("@SUM"), "'@SUM");
        assert_eq!(cell("a,b"), "\"a,b\"");
        assert_eq!(cell("línea\nnueva"), "\"línea\nnueva\"");
    }
}
