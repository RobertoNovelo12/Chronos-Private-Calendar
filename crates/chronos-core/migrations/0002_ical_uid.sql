-- Chronos Private Calendar — versión 2 del esquema
--
-- UID de iCalendar (RFC 5545) de los eventos importados o exportados. Permite
-- reconocer un evento al volver a importar el mismo archivo y conservar su
-- identidad al exportar. NULL en eventos creados en Chronos (se exportan con
-- "<id>@chronos.local").

ALTER TABLE events ADD COLUMN ical_uid TEXT CHECK (ical_uid IS NULL OR length(ical_uid) BETWEEN 1 AND 500);
CREATE INDEX idx_events_ical_uid ON events (calendar_id, ical_uid) WHERE ical_uid IS NOT NULL;
