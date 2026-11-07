# Modelo de datos

Fuente de verdad: [`crates/chronos-core/migrations/0001_init.sql`](../crates/chronos-core/migrations/0001_init.sql). Versión de esquema: **1** (`PRAGMA user_version`).

## Convenciones

| Concepto | Representación |
|---|---|
| Identificadores | UUID v4 en `TEXT` |
| Instantes | `INTEGER` en milisegundos UTC (`start_at`, `end_at`, `created_at`, …) |
| Zona horaria | Nombre IANA en `events.timezone` (p. ej. `America/Mexico_City`). Se conserva para mostrar y para expandir recurrencias en hora local (DST correcto) |
| Día completo | Fecha "flotante": medianoche UTC del primer día; `end_at` exclusivo. Un evento del 5 al 6 inclusive = `5T00:00Z → 7T00:00Z`. No se desplaza al cambiar de zona horaria |
| Booleanos | `INTEGER` 0/1 con `CHECK` |
| Colores | `#rrggbb` validado con `CHECK … GLOB` |
| JSON | `TEXT` validado con `json_valid()` |

## Tablas

```
calendars 1──* events 1──0..1 event_recurrences
                 │  1──* event_exceptions ──0..1 events (override)
                 │  1──* event_attendees
                 │  1──* event_reminders *──0..1 tasks
                 │  *──* labels (event_labels)
calendars 1──* tasks (ON DELETE SET NULL)
settings (clave/valor JSON)        backup_history (solo este equipo)
```

### `calendars`
`id, name, color, description, is_visible, is_default, sort_order, created_at, updated_at`. Índice único parcial garantiza **como máximo un** predeterminado. El núcleo impide borrar el último calendario y reasigna el predeterminado al borrar el actual.

### `events`
Campos de contenido: `title, description, location, links_json` (lista `[{label,url}]`), `color` (NULL = hereda).
Tiempo: `start_at, end_at, timezone, is_all_day`.
Atributos: `visibility` (`default|public|private|confidential`), `availability` (`busy|free|tentative|out_of_office`), `status`.
Recurrencia: `is_recurring`, `series_until_at` (NULL = infinita), `recurrence_master_id` + `original_start_at` (cuando el evento sustituye a una ocurrencia).
Restricciones: `end_at >= start_at`; `recurrence_master_id` y `original_start_at` van juntos.
Índices: `(start_at, end_at)`, `(end_at)`, `(is_recurring, start_at, series_until_at)`, `calendar_id`, `recurrence_master_id`.

### `event_recurrences`
`event_id (PK), rrule`. `rrule` es el valor RFC 5545 sin prefijo: `FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=…` o `COUNT=10`. Cubre diarias, semanales, mensuales, anuales, intervalos, días concretos, fecha de fin y número de repeticiones.

### `event_exceptions`
`event_id, original_start_at, kind (cancelled|modified), override_event_id`. Único por `(event_id, original_start_at)`.

| Operación del usuario | Efecto en la base de datos |
|---|---|
| Editar **solo esta** ocurrencia | Nuevo evento con `recurrence_master_id` + excepción `modified` |
| Eliminar **solo esta** | Excepción `cancelled` |
| Editar **todas** | Se modifica la fila maestra (y su `rrule`) |
| Editar **esta y las siguientes** | La regla original se corta con `UNTIL` justo antes; se crea una serie nueva desde esta ocurrencia |

Las ocurrencias **nunca** se materializan en la base de datos; el motor de expansión (Fase 4) las genera para el rango consultado.

### `event_attendees`
Lista local de personas (`name`, `email`, `role`, `status`). Chronos **no envía invitaciones**: es solo información.

### `event_reminders`
`offset_minutes` (0 a 28 días) con propietario **exclusivo**: `event_id` o `task_id` (`CHECK`). Varios por evento. `method` solo admite `notification` (local).

### `tasks`
`title, notes, due_at, is_all_day, priority (0–3), completed_at, sort_order, calendar_id (opcional)`.

### `labels` / `event_labels`
Etiquetas con nombre único sin distinguir mayúsculas y color. Relación muchos-a-muchos.

### `settings`
Clave → JSON. Las claves con prefijo `local.` (p. ej. carpeta de copias de este equipo) **no** se exportan en las copias ni se sobrescriben al restaurar.

### `backup_history`
Registro de copias creadas en este equipo (ruta, tipo, tamaño, SHA-256, estado). No se incluye en las copias porque describe archivos de este disco.

## Migraciones

`database/migrations.rs` aplica, en orden y cada una en su transacción, las migraciones con versión mayor que `user_version`. Si la base de datos es de una versión **más nueva**, se rechaza abrirla (`unsupported_version`) en lugar de arriesgar datos.

## Consulta por rango (diseño, Fase 4)

```sql
-- Eventos simples que se solapan con [desde, hasta)
SELECT … FROM events
 WHERE is_recurring = 0 AND start_at < :hasta AND end_at > :desde
   AND calendar_id IN (calendarios visibles);
-- Series candidatas (se expanden en Rust solo para el rango)
SELECT … FROM events
 WHERE is_recurring = 1 AND start_at < :hasta
   AND (series_until_at IS NULL OR series_until_at > :desde);
```
