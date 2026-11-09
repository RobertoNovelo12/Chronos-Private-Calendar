# Arquitectura de Chronos Private Calendar

> Estado: Fases 1–4 completas.
> Este documento describe lo que **existe** y lo que está **planificado**; cada sección lo indica.

## 1. Principios

1. **Local primero y único.** Todos los datos viven en el equipo del usuario. No hay servidor, cuenta, telemetría ni sincronización.
2. **Cifrado en reposo real.** La base de datos SQLite está cifrada con SQLCipher; las copias de seguridad con XChaCha20-Poly1305. No se afirma ningún cifrado que no exista.
3. **Núcleo independiente de la interfaz.** Toda la lógica vive en un crate Rust puro (`chronos-core`) que se prueba sin Tauri ni WebView.
4. **El frontend no toca datos.** React solo invoca comandos de Tauri tipados; nunca accede a la base de datos ni al disco.
5. **Sin código de red.** Ningún crate del backend depende de un cliente HTTP. La CSP del WebView bloquea toda conexión externa.

## 2. Vista general

```
┌──────────────────────────── Proceso de la app (Tauri 2) ────────────────────────────┐
│                                                                                     │
│  WebView (React + TS)                     Rust                                      │
│  ┌──────────────────────┐   invoke()   ┌───────────────────────┐                    │
│  │ features/*  (UI)     │ ───────────▶ │ src-tauri/commands/*  │  capa fina:        │
│  │ stores/* (Zustand)   │ ◀─────────── │  AppState (Mutex)     │  valida, delega    │
│  │ lib/ipc.ts (tipado)  │  JSON/err    └──────────┬────────────┘                    │
│  └──────────────────────┘                         │ spawn_blocking                  │
│        CSP: solo 'self' + ipc:                    ▼                                 │
│                                       ┌────────────────────────────────────────┐    │
│                                       │ chronos-core                           │    │
│                                       │  vault ── security/keystore ── crypto  │    │
│                                       │    │                                   │    │
│                                       │  repositories ── database (SQLCipher)  │    │
│                                       │  backup (format + snapshot)            │    │
│                                       └───────────────┬────────────────────────┘    │
└───────────────────────────────────────────────────────┼─────────────────────────────┘
                                                        ▼
                       %LOCALAPPDATA%\io.github.robertonovelo12.chronos\
                         ├── chronos.db (+ -wal, -shm)   ← cifrado SQLCipher
                         ├── keystore.json               ← DEK envuelta, sin secretos en claro
                         └── backups\*.chronosbak        ← cifrado XChaCha20-Poly1305
```

En Linux la carpeta es `~/.local/share/io.github.robertonovelo12.chronos/` y en macOS `~/Library/Application Support/io.github.robertonovelo12.chronos/`. Se usa la carpeta **local** (no *roaming*) para que Windows no la sincronice con perfiles móviles de dominio.

## 3. Estructura de carpetas

```
Chronos-Private-Calendar/
├── Cargo.toml                    # workspace Rust (perfiles, versión común)
├── package.json  vite.config.ts  tsconfig.json  components.json  index.html
├── assets/app-icon.png           # fuente del icono (npx tauri icon)
├── docs/                         # esta documentación
├── crates/
│   └── chronos-core/             # NÚCLEO: sin Tauri, sin red, 100 % probado con cargo test
│       ├── migrations/0001_init.sql
│       ├── src/
│       │   ├── lib.rs            # #![forbid(unsafe_code)]
│       │   ├── error.rs          # CoreError + códigos estables
│       │   ├── vault.rs          # ciclo de vida: configurar / desbloquear / bloquear
│       │   ├── crypto/           # kdf.rs (Argon2id+HKDF), aead.rs (XChaCha20-Poly1305), random.rs
│       │   ├── security/         # keystore.rs (envoltura de la DEK, política de contraseñas)
│       │   ├── database/         # apertura SQLCipher, PRAGMAs, migrations.rs
│       │   ├── models/           # tipos de dominio serializables
│       │   ├── repositories/     # único lugar con SQL de dominio
│       │   ├── backup/           # format.rs (archivo .chronosbak), snapshot.rs, mod.rs (servicio)
│       │   ├── recurrence.rs     # RFC 5545: validación, expansión por rango, corte de series
│       │   ├── reminders.rs      # cálculo de avisos pendientes
│       │   └── fs_util.rs        # escritura atómica
│       └── tests/vault_and_backup.rs
├── src-tauri/                    # CAPA DE ESCRITORIO (fina)
│   ├── tauri.conf.json           # CSP estricta, ventana, bundle
│   ├── capabilities/default.json # solo core:default
│   ├── icons/
│   └── src/
│       ├── main.rs  lib.rs       # arranque, carpeta de datos, registro de comandos
│       ├── state.rs              # AppState: Arc<Mutex<Vault>> + spawn_blocking
│       ├── errors.rs             # CommandError {code, message}
│       ├── notifier.rs           # hilo de recordatorios → notificaciones locales
│       └── commands/             # vault.rs, calendars.rs, events.rs, backup.rs (23 comandos)
└── src/                          # FRONTEND
    ├── main.tsx  App.tsx
    ├── lib/ipc.ts                # única puerta hacia Rust (tipada)
    ├── types/domain.ts           # espejo de los modelos Rust
    ├── lib/dates.ts layout.ts    # fechas flotantes, rangos, ajuste a 15 min; columnas de solapamiento y barras
    ├── hooks/                    # datos visibles, atajos de teclado, bloqueo automático
    ├── stores/                   # Zustand: vault, calendars, events (caché por rango + deshacer), ui, prefs, theme, toast
    ├── components/ui/            # primitivas estilo shadcn/ui (button, input, confirm-dialog, toaster)
    ├── features/                 # security/, calendar/ (vistas), events/ (panel, menú, acciones), calendars/, search/, settings/, backup/, layout/
    └── styles/globals.css        # Tailwind v4 + tokens claro/oscuro
```

### Diferencia respecto a la estructura sugerida

El enunciado proponía `models/`, `services/`, `repositories/`, `crypto/`… dentro de `src-tauri/src/`. Se movieron a `crates/chronos-core/` por tres motivos:

* **Pruebas reales sin interfaz:** `cargo test -p chronos-core` ejecuta cifrado, migraciones, copias y restauraciones sin compilar WebView.
* **Superficie mínima:** el crate del núcleo prohíbe `unsafe` y no depende de Tauri ni de ninguna biblioteca de red.
* **Reutilización:** una futura herramienta de línea de comandos para recuperar copias podría usar el mismo núcleo.

`src-tauri/src/commands/` conserva el papel indicado: traducir comandos a llamadas del núcleo. Las migraciones viven junto al núcleo (`crates/chronos-core/migrations/`) y se incrustan en el binario con `include_str!`.

## 4. Dependencias

### Backend (Rust)

| Crate | Uso | Notas |
|---|---|---|
| `tauri` 2 | Aplicación de escritorio | Sin plugins de red, shell ni actualizador |
| `rusqlite` 0.41 (`bundled-sqlcipher-vendored-openssl`) | SQLite + **SQLCipher** compilados dentro del binario | Se eligió en lugar de SQLx: SQLx no ofrece SQLCipher empaquetado. rusqlite es síncrono; se ejecuta en `spawn_blocking` |
| `argon2` 0.5 | Argon2id | RustCrypto |
| `chacha20poly1305` 0.10 | XChaCha20-Poly1305 | RustCrypto |
| `hkdf` 0.12 + `sha2` 0.10 | Subclaves y suma SHA-256 de las copias | RustCrypto |
| `getrandom` 0.3 | CSPRNG del sistema operativo | |
| `zeroize` | Borrado de claves y contraseñas en memoria | |
| `serde`, `serde_json` | Serialización | |
| `chrono`, `chrono-tz` | Fechas y zonas IANA | `chrono-tz` se usará en recurrencias (Fase 4) |
| `uuid` | Identificadores v4 | |
| `thiserror` | Errores tipados | |
| `tracing`, `tracing-subscriber` | Logs locales sin datos sensibles | |

Tokio: Tauri 2 ya incluye un runtime Tokio (`tauri::async_runtime`). Los comandos son `async` y las operaciones bloqueantes (Argon2id, SQLite) se envían a `spawn_blocking`, así que no se añade Tokio como dependencia directa hasta que haga falta (temporizadores de copias automáticas, Fase 5).

### Frontend

React 19 · TypeScript · Vite · Tailwind CSS 4 · primitivas estilo **shadcn/ui** (`components.json`, `cva`, `@radix-ui/react-slot`) · Lucide · Zustand · `@fontsource-variable/inter` (fuente **empaquetada localmente**: no se descarga nada de Google Fonts ni de ningún CDN).

## 5. Flujo de funcionamiento

### Arranque

1. Tauri resuelve la carpeta de datos local y crea `Vault` (sin abrir nada).
2. El frontend llama a `vault_status` → `{initialized, unlocked}`.
3. Sin `keystore.json` → pantalla **Protege tu calendario**; con él → pantalla **Bloqueado**.

### Primera configuración (`vault_setup`)

1. Valida la contraseña (≥ 8 caracteres).
2. Genera sal + DEK aleatorias; Argon2id → clave maestra → HKDF → KEK y clave de copias.
3. Crea `chronos.db` cifrada con la DEK, aplica migraciones, crea el calendario «Personal».
4. Escribe `keystore.json` de forma atómica (último paso). Si algo falla, se borra lo creado.

### Desbloqueo (`vault_unlock`)

1. Argon2id con la sal del almacén → KEK → desenvuelve la DEK. Si la etiqueta Poly1305 no verifica → `invalid_password`.
2. Abre SQLCipher con la DEK (`PRAGMA key = "x'…'"`), comprueba que la biblioteca **es** SQLCipher (si no, aborta), aplica PRAGMAs y migraciones pendientes.
3. Guarda en memoria la conexión y la clave de copias. Tras 3 fallos seguidos se añade un retardo creciente (hasta 30 s).

### Uso normal

`React → lib/ipc.ts → invoke → commands/* → Vault::session() → repositories/* → SQLCipher`. Los errores vuelven como `{code, message}` sin datos del usuario.

### Bloqueo (`vault_lock`, botón o Ctrl+L)

Se cierra la conexión SQLite y se destruyen (zeroize) DEK y clave de copias. El frontend vacía sus cachés (calendarios, eventos, deshacer y evento copiado). También hay bloqueo automático por inactividad.

### Copias y restauración

Ver [BACKUP_FORMAT.md](BACKUP_FORMAT.md) y [SECURITY.md](SECURITY.md). Hilos de fondo en `src-tauri`: `notifier.rs` (recordatorios, cada 15 s) y `backups.rs` (copias automáticas, cada 5 min). Ambos toman el mismo `Mutex` de la bóveda que los comandos.

### Importar y exportar (`chronos-core/src/interop`)

* `mod.rs`: modelo común (`ImportEvent`, `ExportItem`), recogida de lo que se exporta (`collect`: eventos simples, series con sus EXDATE y excepciones con RECURRENCE-ID) y aplicación atómica de la importación (`apply`, dentro de un `SAVEPOINT`; desduplicación por UID por calendario).
* `ics.rs`: escritor y lector RFC 5545 propios (plegado a 75 octetos, escapes, fechas `DATE`/UTC/`TZID`/flotantes, `DURATION`, `VALARM`). Es un analizador de texto, no criptografía.
* `json.rs`: formato `chronos-export` v1. `csv.rs`: solo exportación.
* Los comandos (`commands/data.rs`) abren los diálogos nativos desde Rust y llaman al núcleo.
* `database::Atomic`: bloque atómico anidable con `SAVEPOINT`, para que cada operación de eventos siga siendo atómica también dentro de una importación.

## 6. Manejo de errores

* `CoreError` (núcleo) con `code()` estable: `invalid_password`, `locked`, `corrupt_backup`, `backup_authentication`, `confirmation_required`, `validation`, …
* `CommandError {code, message}` en la frontera Tauri. El frontend decide el texto por código cuando lo necesita.
* No hay `unwrap()` en código de producción; solo en pruebas. Un `Mutex` envenenado se recupera porque cada operación de escritura es transaccional.

## 7. Rendimiento (diseño)

* Consultas de eventos siempre por rango (`idx_events_range`, `idx_events_series`).
* Las series recurrentes se guardan una vez y se expanden solo para el rango visible (`series_until_at` descarta series terminadas sin expandirlas).
* Operaciones costosas fuera del hilo de la interfaz (`spawn_blocking`).
* Frontend: stores por dominio en Zustand con selectores; la caché de eventos solo contiene el rango visible ± 1 día y se sustituye al navegar; las disposiciones (columnas, barras) se memorizan con `useMemo`. Virtualización de la Agenda pendiente para rangos largos.

## 8. Decisiones de interfaz (Fase 3)

* **Interacción con punteros propios** (Pointer Events + `setPointerCapture`) en lugar de una biblioteca de arrastrar y soltar: menos dependencias y control total del ajuste a 15 minutos y de la vista previa.
* **Guardado automático:** cada cambio del panel se envía al backend (el título tras 600 ms sin escribir). No hay botón "Guardar".
* **Borradores:** crear con clic o arrastre abre un evento provisional (solo en memoria) con el título enfocado. Se guarda al escribir un título o cambiar cualquier dato del panel; arrastrarlo solo lo recoloca. Si se cierra, se pulsa Esc o se hace clic fuera, desaparece.
* **Eventos repetidos:** cada edición, arrastre o eliminación pregunta «este / este y los siguientes / todos» y, tras aplicarla, se recarga el rango visible (la serie la recalcula el backend). Estos cambios no entran en deshacer/rehacer.
* **Deshacer/rehacer** vive en memoria del frontend (100 pasos) usando operaciones inversas (`events_restore` reinserta con el mismo id). Se borra al bloquear para no conservar datos.
* **Enlaces** de eventos se muestran como texto seleccionable, no como hipervínculos: la app no abre navegadores ni conexiones.
* **Tarjeta flotante:** con el panel derecho oculto, los detalles se muestran en una tarjeta que se coloca junto al bloque del evento (localizado por `data-event-key`) y lo sigue al desplazar o mover; un botón la acopla al panel.
* **Zonas horarias** (`lib/timezones.ts`): solo la API `Intl` del motor, sin bases de datos externas. Cambiar la zona de un evento conserva la hora de reloj que se ve y la reinterpreta en la nueva zona.
* **Diseño de tres columnas:** barra lateral izquierda plegable (`` ` ``), área del calendario y panel derecho fijo que muestra el buscador y, según el contexto, los atajos útiles o los detalles del evento. Los menús flotantes usan un `Popover` propio con grupos para submenús.
* **Menús contextuales:** clic derecho sobre un evento (abrir, copiar, duplicar, exportar .ics, mover de calendario, eliminar) y sobre un hueco vacío (crear evento, pegar evento). La vista informa al módulo `clipboard.ts` de la franja bajo el puntero para que `Ctrl+V` pegue ahí.
* **Configuración en secciones:** General, Copias de seguridad, Importar y exportar, Privacidad y seguridad.
* **Preferencias de presentación** (tema, vista, número de días, formato horario, números de semana, paneles, horario laboral, bloqueo automático) en `localStorage` del WebView: no contienen datos del calendario y deben aplicarse antes de desbloquear.
