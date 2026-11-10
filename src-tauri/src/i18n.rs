//! Textos que genera el backend (notificaciones y títulos de diálogos) en el
//! idioma elegido en la interfaz. El frontend lo comunica con
//! `app_set_language` al arrancar y al cambiarlo.

use std::sync::atomic::{AtomicUsize, Ordering};

#[derive(Clone, Copy)]
pub enum Key {
    Untitled,
    Now,
    InMinutes,
    InHours,
    InHoursMinutes,
    Tomorrow,
    InDays,
    Today,
    WithinDays,
    StartsAt,
    AllDayAt,
    TaskDueAt,
    TaskFor,
    YouHaveEvent,
    YouHaveTask,
    Export,
    Import,
    CalendarsAndBackups,
    ChronosJson,
    BackupFolder,
    SaveBackupIn,
    ChooseBackup,
    ChronosBackup,
}

const N: usize = 23;
type Table = [&'static str; N];

/// Orden: el de `Key`. `{0}`, `{1}` son los valores.
const ES: Table = [
    "Sin título",
    "ahora",
    "en {0} min",
    "en {0} h",
    "en {0} h {1} min",
    "mañana",
    "en {0} días",
    "hoy",
    "dentro de {0} días",
    "Empieza {0}",
    "Todo el día · {0}",
    "Tarea · vence {0}",
    "Tarea para {0}",
    "Tienes un evento {0}",
    "Tienes una tarea {0}",
    "Exportar",
    "Importar",
    "Calendarios y copias",
    "JSON de Chronos",
    "Carpeta de copias",
    "Guardar copia cifrada en…",
    "Elegir copia de seguridad",
    "Copia de Chronos",
];
const EN: Table = [
    "Untitled",
    "now",
    "in {0} min",
    "in {0} h",
    "in {0} h {1} min",
    "tomorrow",
    "in {0} days",
    "today",
    "in {0} days",
    "Starts {0}",
    "All day · {0}",
    "Task · due {0}",
    "Task for {0}",
    "You have an event {0}",
    "You have a task {0}",
    "Export",
    "Import",
    "Calendars and backups",
    "Chronos JSON",
    "Backup folder",
    "Save encrypted backup to…",
    "Choose a backup",
    "Chronos backup",
];
const ZH: Table = [
    "无标题",
    "现在",
    "{0} 分钟后",
    "{0} 小时后",
    "{0} 小时 {1} 分钟后",
    "明天",
    "{0} 天后",
    "今天",
    "{0} 天后",
    "{0}开始",
    "全天 · {0}",
    "任务 · {0}到期",
    "{0}的任务",
    "你有一个日程{0}",
    "你有一项任务{0}",
    "导出",
    "导入",
    "日历和备份",
    "Chronos JSON",
    "备份文件夹",
    "将加密备份保存到…",
    "选择备份",
    "Chronos 备份",
];
const PT: Table = [
    "Sem título",
    "agora",
    "em {0} min",
    "em {0} h",
    "em {0} h {1} min",
    "amanhã",
    "em {0} dias",
    "hoje",
    "daqui a {0} dias",
    "Começa {0}",
    "Dia inteiro · {0}",
    "Tarefa · vence {0}",
    "Tarefa para {0}",
    "Você tem um evento {0}",
    "Você tem uma tarefa {0}",
    "Exportar",
    "Importar",
    "Calendários e backups",
    "JSON do Chronos",
    "Pasta de backups",
    "Salvar backup criptografado em…",
    "Escolher backup",
    "Backup do Chronos",
];
const FR: Table = [
    "Sans titre",
    "maintenant",
    "dans {0} min",
    "dans {0} h",
    "dans {0} h {1} min",
    "demain",
    "dans {0} jours",
    "aujourd’hui",
    "dans {0} jours",
    "Commence {0}",
    "Toute la journée · {0}",
    "Tâche · échéance {0}",
    "Tâche pour {0}",
    "Vous avez un événement {0}",
    "Vous avez une tâche {0}",
    "Exporter",
    "Importer",
    "Calendriers et sauvegardes",
    "JSON Chronos",
    "Dossier des sauvegardes",
    "Enregistrer la sauvegarde chiffrée dans…",
    "Choisir une sauvegarde",
    "Sauvegarde Chronos",
];
const DE: Table = [
    "Ohne Titel",
    "jetzt",
    "in {0} Min.",
    "in {0} Std.",
    "in {0} Std. {1} Min.",
    "morgen",
    "in {0} Tagen",
    "heute",
    "in {0} Tagen",
    "Beginnt {0}",
    "Ganztägig · {0}",
    "Aufgabe · fällig {0}",
    "Aufgabe für {0}",
    "Du hast einen Termin {0}",
    "Du hast eine Aufgabe {0}",
    "Exportieren",
    "Importieren",
    "Kalender und Sicherungen",
    "Chronos-JSON",
    "Sicherungsordner",
    "Verschlüsselte Sicherung speichern unter…",
    "Sicherung auswählen",
    "Chronos-Sicherung",
];
const JA: Table = [
    "無題",
    "今",
    "{0} 分後",
    "{0} 時間後",
    "{0} 時間 {1} 分後",
    "明日",
    "{0} 日後",
    "今日",
    "{0} 日後",
    "{0}に開始",
    "終日 · {0}",
    "タスク · {0}に期限",
    "{0}のタスク",
    "予定があります（{0}）",
    "タスクがあります（{0}）",
    "エクスポート",
    "インポート",
    "カレンダーとバックアップ",
    "Chronos JSON",
    "バックアップフォルダー",
    "暗号化バックアップの保存先…",
    "バックアップを選択",
    "Chronos バックアップ",
];
const KO: Table = [
    "제목 없음",
    "지금",
    "{0}분 후",
    "{0}시간 후",
    "{0}시간 {1}분 후",
    "내일",
    "{0}일 후",
    "오늘",
    "{0}일 후",
    "{0} 시작",
    "종일 · {0}",
    "할 일 · {0} 마감",
    "{0} 할 일",
    "일정이 있습니다 ({0})",
    "할 일이 있습니다 ({0})",
    "내보내기",
    "가져오기",
    "캘린더 및 백업",
    "Chronos JSON",
    "백업 폴더",
    "암호화된 백업 저장 위치…",
    "백업 선택",
    "Chronos 백업",
];
const RU: Table = [
    "Без названия",
    "сейчас",
    "через {0} мин",
    "через {0} ч",
    "через {0} ч {1} мин",
    "завтра",
    "через {0} дн.",
    "сегодня",
    "через {0} дн.",
    "Начало {0}",
    "Весь день · {0}",
    "Задача · срок {0}",
    "Задача на {0}",
    "У вас событие {0}",
    "У вас задача {0}",
    "Экспорт",
    "Импорт",
    "Календари и резервные копии",
    "JSON Chronos",
    "Папка резервных копий",
    "Сохранить зашифрованную копию в…",
    "Выбрать резервную копию",
    "Резервная копия Chronos",
];

const LANGS: [(&str, &Table); 9] = [
    ("es", &ES),
    ("en", &EN),
    ("zh-CN", &ZH),
    ("pt-BR", &PT),
    ("fr", &FR),
    ("de", &DE),
    ("ja", &JA),
    ("ko", &KO),
    ("ru", &RU),
];

static CURRENT: AtomicUsize = AtomicUsize::new(0);

/// Cambia el idioma; códigos desconocidos se ignoran.
pub fn set_language(code: &str) -> bool {
    match LANGS.iter().position(|(c, _)| c.eq_ignore_ascii_case(code)) {
        Some(i) => {
            CURRENT.store(i, Ordering::Relaxed);
            true
        }
        None => false,
    }
}

pub fn text(key: Key) -> &'static str {
    LANGS[CURRENT.load(Ordering::Relaxed)].1[key as usize]
}

/// Texto con valores: `{0}`, `{1}`.
pub fn fmt(key: Key, args: &[&str]) -> String {
    let mut s = text(key).to_string();
    for (i, a) in args.iter().enumerate() {
        s = s.replace(&format!("{{{i}}}"), a);
    }
    s
}

/// «en 10 min», «mañana»… para el adelanto de un recordatorio.
pub fn offset(minutes: i32) -> String {
    let n = |v: i32| v.to_string();
    match minutes {
        0 => text(Key::Now).into(),
        m if m < 60 => fmt(Key::InMinutes, &[&n(m)]),
        m if m < 24 * 60 && m % 60 == 0 => fmt(Key::InHours, &[&n(m / 60)]),
        m if m < 24 * 60 => fmt(Key::InHoursMinutes, &[&n(m / 60), &n(m % 60)]),
        m if m % (24 * 60) == 0 && m / (24 * 60) == 1 => text(Key::Tomorrow).into(),
        m if m % (24 * 60) == 0 => fmt(Key::InDays, &[&n(m / (24 * 60))]),
        m => fmt(Key::InHours, &[&n(m / 60)]),
    }
}

/// «hoy», «mañana» o «dentro de N días» (tareas de día completo).
pub fn day(offset_minutes: i32) -> String {
    match offset_minutes / (24 * 60) {
        0 => text(Key::Today).into(),
        1 => text(Key::Tomorrow).into(),
        d => fmt(Key::WithinDays, &[&d.to_string()]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_language_keeps_the_placeholders() {
        for (code, table) in LANGS {
            for (i, (es, other)) in ES.iter().zip(table.iter()).enumerate() {
                for p in ["{0}", "{1}"] {
                    assert_eq!(
                        es.contains(p),
                        other.contains(p),
                        "{code}: texto {i} «{other}» no conserva {p}"
                    );
                }
                assert!(!other.is_empty());
            }
        }
    }

    #[test]
    fn switches_language() {
        assert!(set_language("en"));
        assert_eq!(offset(10), "in 10 min");
        assert_eq!(fmt(Key::YouHaveTask, &[&offset(0)]), "You have a task now");
        assert!(set_language("ja"));
        assert_eq!(offset(90), "1 時間 30 分後");
        assert!(!set_language("xx"));
        assert!(set_language("es"));
        assert_eq!(day(1440), "mañana");
    }
}
