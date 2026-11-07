-- Chronos Private Calendar — esquema inicial (versión 1)
--
-- Convenciones:
--   * Identificadores: UUID v4 en texto.
--   * Instantes: INTEGER, milisegundos desde la época Unix en UTC.
--   * Zona horaria: nombre IANA (p. ej. 'America/Mexico_City') en events.timezone.
--   * Eventos de día completo: fechas "flotantes" codificadas como medianoche UTC;
--     end_at es exclusivo (un evento del día 5 va de 5T00:00Z a 6T00:00Z).
--   * Booleanos: INTEGER 0/1 con CHECK.
--   * Recurrencias: la serie se guarda UNA vez (regla RRULE RFC 5545); las
--     ocurrencias se generan en memoria, nunca se duplican en la base de datos.

CREATE TABLE calendars (
    id           TEXT    PRIMARY KEY NOT NULL,
    name         TEXT    NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
    color        TEXT    NOT NULL CHECK (color GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
    description  TEXT    NOT NULL DEFAULT '',
    is_visible   INTEGER NOT NULL DEFAULT 1 CHECK (is_visible IN (0, 1)),
    is_default   INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    sort_order   INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);
-- Como máximo un calendario predeterminado.
CREATE UNIQUE INDEX idx_calendars_single_default ON calendars (is_default) WHERE is_default = 1;
CREATE INDEX idx_calendars_sort ON calendars (sort_order);

CREATE TABLE events (
    id                    TEXT    PRIMARY KEY NOT NULL,
    calendar_id           TEXT    NOT NULL REFERENCES calendars (id) ON DELETE CASCADE,
    title                 TEXT    NOT NULL DEFAULT '' CHECK (length(title) <= 1000),
    description           TEXT    NOT NULL DEFAULT '',
    location              TEXT    NOT NULL DEFAULT '',
    -- Lista JSON de enlaces: [{"label": "...", "url": "..."}]
    links_json            TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(links_json) AND json_type(links_json) = 'array'),
    -- Color propio del evento; NULL = hereda el del calendario.
    color                 TEXT    CHECK (color IS NULL OR color GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
    start_at              INTEGER NOT NULL,
    end_at                INTEGER NOT NULL,
    timezone              TEXT    NOT NULL DEFAULT 'UTC',
    is_all_day            INTEGER NOT NULL DEFAULT 0 CHECK (is_all_day IN (0, 1)),
    visibility            TEXT    NOT NULL DEFAULT 'default'
                                  CHECK (visibility IN ('default', 'public', 'private', 'confidential')),
    availability          TEXT    NOT NULL DEFAULT 'busy'
                                  CHECK (availability IN ('busy', 'free', 'tentative', 'out_of_office')),
    status                TEXT    NOT NULL DEFAULT 'confirmed'
                                  CHECK (status IN ('confirmed', 'tentative', 'cancelled')),
    -- Serie recurrente: 1 si existe una fila en event_recurrences.
    is_recurring          INTEGER NOT NULL DEFAULT 0 CHECK (is_recurring IN (0, 1)),
    -- Fin del último instante que puede ocupar la serie (NULL = infinita).
    -- Permite filtrar series por rango sin expandirlas.
    series_until_at       INTEGER,
    -- Si este evento sustituye a una ocurrencia de una serie.
    recurrence_master_id  TEXT    REFERENCES events (id) ON DELETE CASCADE,
    original_start_at     INTEGER,
    created_at            INTEGER NOT NULL,
    updated_at            INTEGER NOT NULL,
    CHECK (end_at >= start_at),
    CHECK ((recurrence_master_id IS NULL) = (original_start_at IS NULL))
);
CREATE INDEX idx_events_calendar ON events (calendar_id);
CREATE INDEX idx_events_range ON events (start_at, end_at);
CREATE INDEX idx_events_end ON events (end_at);
CREATE INDEX idx_events_series ON events (is_recurring, start_at, series_until_at);
CREATE INDEX idx_events_master ON events (recurrence_master_id) WHERE recurrence_master_id IS NOT NULL;

CREATE TABLE event_recurrences (
    event_id    TEXT    PRIMARY KEY NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    -- Valor de RRULE según RFC 5545, sin el prefijo "RRULE:" (p. ej. "FREQ=WEEKLY;BYDAY=MO,WE").
    rrule       TEXT    NOT NULL CHECK (length(rrule) BETWEEN 6 AND 2000),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE TABLE event_exceptions (
    id                 TEXT    PRIMARY KEY NOT NULL,
    event_id           TEXT    NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    -- Inicio original (UTC ms) de la ocurrencia afectada.
    original_start_at  INTEGER NOT NULL,
    kind               TEXT    NOT NULL CHECK (kind IN ('cancelled', 'modified')),
    override_event_id  TEXT    REFERENCES events (id) ON DELETE CASCADE,
    created_at         INTEGER NOT NULL,
    UNIQUE (event_id, original_start_at),
    CHECK ((kind = 'modified') = (override_event_id IS NOT NULL))
);
CREATE INDEX idx_event_exceptions_event ON event_exceptions (event_id);

CREATE TABLE event_attendees (
    id          TEXT    PRIMARY KEY NOT NULL,
    event_id    TEXT    NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    name        TEXT    NOT NULL DEFAULT '',
    email       TEXT    NOT NULL DEFAULT '',
    role        TEXT    NOT NULL DEFAULT 'required' CHECK (role IN ('organizer', 'required', 'optional')),
    status      TEXT    NOT NULL DEFAULT 'needs_action'
                        CHECK (status IN ('needs_action', 'accepted', 'declined', 'tentative')),
    created_at  INTEGER NOT NULL,
    CHECK (length(name) > 0 OR length(email) > 0)
);
CREATE INDEX idx_event_attendees_event ON event_attendees (event_id);

CREATE TABLE tasks (
    id            TEXT    PRIMARY KEY NOT NULL,
    calendar_id   TEXT    REFERENCES calendars (id) ON DELETE SET NULL,
    title         TEXT    NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 1000),
    notes         TEXT    NOT NULL DEFAULT '',
    due_at        INTEGER,
    is_all_day    INTEGER NOT NULL DEFAULT 0 CHECK (is_all_day IN (0, 1)),
    priority      INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3),
    completed_at  INTEGER,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_tasks_due ON tasks (due_at) WHERE due_at IS NOT NULL;
CREATE INDEX idx_tasks_calendar ON tasks (calendar_id);

CREATE TABLE event_reminders (
    id              TEXT    PRIMARY KEY NOT NULL,
    event_id        TEXT    REFERENCES events (id) ON DELETE CASCADE,
    task_id         TEXT    REFERENCES tasks (id) ON DELETE CASCADE,
    -- Minutos antes del inicio (o del vencimiento de la tarea).
    offset_minutes  INTEGER NOT NULL CHECK (offset_minutes BETWEEN 0 AND 40320),
    method          TEXT    NOT NULL DEFAULT 'notification' CHECK (method IN ('notification')),
    created_at      INTEGER NOT NULL,
    -- Exactamente un propietario: evento o tarea.
    CHECK ((event_id IS NULL) <> (task_id IS NULL))
);
CREATE INDEX idx_event_reminders_event ON event_reminders (event_id) WHERE event_id IS NOT NULL;
CREATE INDEX idx_event_reminders_task ON event_reminders (task_id) WHERE task_id IS NOT NULL;

CREATE TABLE labels (
    id          TEXT    PRIMARY KEY NOT NULL,
    name        TEXT    NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(name)) BETWEEN 1 AND 100),
    color       TEXT    NOT NULL CHECK (color GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE TABLE event_labels (
    event_id  TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    label_id  TEXT NOT NULL REFERENCES labels (id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, label_id)
) WITHOUT ROWID;
CREATE INDEX idx_event_labels_label ON event_labels (label_id);

-- Preferencias. value es JSON. Las claves con prefijo 'local.' son propias de
-- este equipo (p. ej. carpeta de copias) y no se incluyen en las copias de seguridad.
CREATE TABLE settings (
    key         TEXT    PRIMARY KEY NOT NULL CHECK (length(key) BETWEEN 1 AND 200),
    value       TEXT    NOT NULL CHECK (json_valid(value)),
    updated_at  INTEGER NOT NULL
);

-- Historial de copias de este equipo. No contiene datos del calendario
-- y no forma parte de las copias (describe archivos de este disco).
CREATE TABLE backup_history (
    id              TEXT    PRIMARY KEY NOT NULL,
    file_name       TEXT    NOT NULL,
    file_path       TEXT    NOT NULL,
    kind            TEXT    NOT NULL CHECK (kind IN ('manual', 'automatic', 'pre_restore', 'pre_update')),
    status          TEXT    NOT NULL CHECK (status IN ('ok', 'failed')),
    format_version  INTEGER NOT NULL,
    schema_version  INTEGER NOT NULL,
    size_bytes      INTEGER NOT NULL DEFAULT 0,
    sha256          TEXT    NOT NULL DEFAULT '',
    error_code      TEXT,
    created_at      INTEGER NOT NULL
);
CREATE INDEX idx_backup_history_created ON backup_history (created_at DESC);
