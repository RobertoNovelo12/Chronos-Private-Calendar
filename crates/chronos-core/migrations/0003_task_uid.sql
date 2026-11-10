-- Chronos Private Calendar — versión 3 del esquema
--
-- UID de iCalendar (VTODO) de las tareas importadas o exportadas, para no
-- duplicarlas al volver a importar el mismo archivo. NULL en tareas creadas
-- en Chronos (se exportan con "<id>@chronos.local").

ALTER TABLE tasks ADD COLUMN ical_uid TEXT CHECK (ical_uid IS NULL OR length(ical_uid) BETWEEN 1 AND 500);
CREATE INDEX idx_tasks_ical_uid ON tasks (ical_uid) WHERE ical_uid IS NOT NULL;
