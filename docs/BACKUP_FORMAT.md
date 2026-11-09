# Formato de copia de seguridad `.chronosbak` (versión 1)

Implementación: [`crates/chronos-core/src/backup/format.rs`](../crates/chronos-core/src/backup/format.rs).

## Estructura binaria

| Desplazamiento | Tamaño | Campo | Contenido |
|---|---|---|---|
| 0 | 8 | Magia | ASCII `CHRNBKUP` |
| 8 | 2 | Versión de formato | `u16` little-endian = `1` |
| 10 | 4 | Longitud de cabecera `H` | `u32` little-endian (máx. 64 KiB) |
| 14 | H | Cabecera | JSON UTF-8 (ver abajo) |
| 14+H | N | Contenido cifrado | XChaCha20-Poly1305, incluye etiqueta de 16 B |
| 14+H+N | 32 | Suma de comprobación | SHA-256 de todos los bytes anteriores |

* **AAD** del cifrado = bytes `[0, 14+H)`: magia, versión, longitud y cabecera quedan **autenticados**. Cambiar cualquier parámetro hace fallar el descifrado.
* La **SHA-256 final** se verifica sin contraseña. Permite distinguir:
  * suma incorrecta → **archivo dañado** (`corrupt_backup`);
  * suma correcta pero etiqueta Poly1305 inválida → **contraseña incorrecta** o manipulación deliberada (`backup_authentication`).

## Cabecera (pública)

```json
{
  "format_version": 1,
  "created_at": "2026-11-07T07:27:30.714994608+00:00",
  "app_version": "0.1.0",
  "schema_version": 1,
  "kdf": {
    "algorithm": "argon2id", "version": 19,
    "m_cost_kib": 65536, "t_cost": 3, "p_cost": 1,
    "salt": "<base64, 16 B>"
  },
  "hkdf_info": "chronos/v1/backup",
  "cipher": { "algorithm": "xchacha20poly1305", "nonce": "<base64, 24 B>" },
  "payload": { "encoding": "json", "compression": "none" }
}
```

La cabecera **no** contiene títulos, descripciones, ubicaciones, nombres de calendario ni recuentos de eventos. Revela solo la fecha de creación, versiones y parámetros criptográficos (que no son secretos). El nombre del archivo (`chronos-AAAAMMDD-HHMMSS-mmm-<tipo>.chronosbak`) tampoco revela contenido.

## Derivación de la clave

```
clave_copia = HKDF-SHA256( Argon2id(contraseña, kdf.salt, kdf.m/t/p), info = hkdf_info )
```

La contraseña **no** se almacena en el archivo.

## Contenido descifrado

JSON con una instantánea lógica:

```json
{
  "schema_version": 1,
  "tables": {
    "calendars": { "columns": ["id", "name", ...], "rows": [["…", "…", ...]] },
    "events":    { ... }, "...": {}
  }
}
```

* Tablas incluidas, en orden de dependencias: `calendars, labels, events, event_recurrences, event_exceptions, event_attendees, tasks, event_reminders, event_labels, settings`.
* Excluidos: `backup_history` y ajustes `local.*` (son propios de cada equipo).
* Valores: `null`, entero, real, texto; binarios como `{"$blob": "<base64>"}`.
* Se exporta el **contenido**, no el archivo SQLite: la copia no depende de la DEK ni se escribe nunca una base de datos en claro.

## Procedimientos

### Crear
1. Transacción de lectura → instantánea coherente.
2. Serializar a JSON en un búfer que se borra al liberarse.
3. Nonce aleatorio, cifrar, calcular SHA-256.
4. Escritura atómica (temporal + `fsync` + renombrar) y registro en `backup_history`.

### Inspeccionar (sin contraseña)
Comprueba magia, versión, longitudes y SHA-256. Muestra fecha, versión de la app, versión de formato, tamaño y huella.

### Verificar (con contraseña)
Inspeccionar + derivar clave + descifrar + leer la instantánea.

### Restaurar
1. Exige confirmación explícita (`confirmOverwrite = true`); si no, `confirmation_required`.
2. Verifica y descifra **por completo** y valida tablas/columnas contra el esquema actual, **antes** de tocar nada.
3. Crea una copia `pre_restore` del estado actual. Si falla, se aborta.
4. En **una transacción**: borra los datos (salvo `backup_history` y `local.*`), inserta la instantánea, comprueba claves foráneas, confirma. Cualquier error → reversión completa.

### Compatibilidad
* Copia con `schema_version` mayor que la de la app → rechazada (`unsupported_version`).
* Copia de un esquema anterior → se restaura si sus columnas existen en el esquema actual (migraciones aditivas). Migraciones no aditivas futuras incluirán su conversión de instantáneas.
* `format_version` distinto de 1 → rechazado hasta que se implemente su lector.

### Copias automáticas y retención

* Frecuencia `backups.auto`: diaria (predeterminada), semanal o desactivada. Un hilo comprueba cada 5 min (el primero, 1 min tras abrir) si la última copia automática es más antigua que el intervalo. Solo funciona con la app desbloqueada: bloqueada no hay claves en memoria.
* Retención `backups.keep` (predeterminado 7): tras cada copia automática se eliminan las automáticas más antiguas. Solo se borran archivos con extensión `.chronosbak` que figuran en el historial como `automatic`; las manuales, las previas a restaurar y las previas a actualizar nunca se borran solas.
* `pre_update`: al desbloquear, si `local.app_version` difiere de la versión actual, se crea una copia antes de seguir (un fallo se registra pero no impide abrir los datos).

## Pruebas automatizadas

`crates/chronos-core/tests/vault_and_backup.rs` verifica: ida y vuelta completa, que la copia no contiene texto en claro, contraseña incorrecta, archivo con un bit cambiado, archivo truncado, archivo ajeno, restauración sin confirmación, copia previa restaurable, contraseña alternativa, copias anteriores a un cambio de contraseña y ajustes locales preservados.
