# Plan de desarrollo

Leyenda: ✅ hecho y verificado · 🔜 siguiente · ⬜ pendiente

## Fase 1 — Arquitectura ✅
Arquitectura, estructura, dependencias, modelo de datos, seguridad, copias y cifrado: ver `docs/`.

## Fase 2 — Infraestructura ✅
* ✅ Workspace Rust: `chronos-core` (núcleo) + `src-tauri` (escritorio)
* ✅ SQLCipher empaquetado, migraciones versionadas, esquema completo (11 tablas, índices, restricciones)
* ✅ Almacén de claves Argon2id + HKDF + XChaCha20-Poly1305; cambio de contraseña
* ✅ Copias cifradas: crear, inspeccionar, verificar, restaurar transaccional con copia previa
* ✅ Repositorio de calendarios (CRUD, visibilidad, predeterminado, orden)
* ✅ Tauri 2 con CSP estricta y permisos mínimos; 16 comandos
* ✅ React + TS + Vite + Tailwind 4 + Zustand; configuración, desbloqueo, bloqueo (Ctrl+L), lista de calendarios, tema claro/oscuro/sistema, copia manual
* ✅ 21 pruebas Rust (unitarias + integración); prueba E2E manual del binario en Linux

## Fase 3 — Interfaz ✅
* ✅ Barra lateral: buscador (`/` o `Ctrl+K`), mini calendario mensual que resalta el rango visible, calendarios, copia de seguridad
* ✅ Vistas Día, Semana, Mes, Agenda (60 días) y **número de días personalizado** (2–21); botón Hoy; navegación ← →
* ✅ Diseño minimalista de tres columnas: barra lateral (mini calendario con números de semana), calendario con título grande y semana, panel derecho fijo (buscador, atajos útiles o detalles del evento con selectores de hora y fecha)
* ✅ Formato 12/24 h, inicio de semana y números de semana desde "Configuración de la vista"
* ✅ **Tarjeta flotante** de detalles junto al evento cuando el panel lateral está oculto (con botón para acoplarla)
* ✅ **Segunda zona horaria** en la rejilla (botón «+» con buscador de zonas) y control **«±»** para ajustar el número de días (1–31)
* ✅ Diálogo «Repetir» (Cada · En · Termina) y opciones del evento en filas: interruptor de día completo, zona horaria del evento y repetición
* ✅ Indicador de hora actual; horario laboral y fines de semana sombreados; zona horaria visible (GMT±n)
* ✅ Crear con clic o arrastrando; mover (también entre días) y redimensionar; arrastrar en la franja de día completo y en el mes
* ✅ Eventos simultáneos lado a lado; aviso de conflictos en el panel
* ✅ Panel lateral con guardado automático: título, fechas y horas, día completo, calendario, color, ubicación, disponibilidad, privacidad, enlaces, descripción
* ✅ Menú contextual (abrir, duplicar, mover a calendario, eliminar); confirmación al eliminar; deshacer/rehacer (`Ctrl+Z` / `Ctrl+Shift+Z`)
* ✅ Atajos: T, 1/D, 0/W, M, A, 2–9 (días), J/K, C, `, ?, /, Supr, Ctrl+D, Esc, Ctrl+L
* ✅ Configuración: tema, inicio de semana, horario laboral, duración predeterminada, **bloqueo automático por inactividad** (adelantado de la Fase 5)
* ⬜ Pendiente: virtualización de la Agenda para rangos largos, arrastrar para mover eventos de varios días en la rejilla horaria conservando el segmento

## Fase 4 — Backend de eventos ✅
* ✅ Repositorio de eventos: crear, editar, eliminar, duplicar, restaurar (deshacer), mover de calendario, color, enlaces seguros (solo https/http/mailto), disponibilidad, privacidad
* ✅ Consulta por rango (solo se cargan los días visibles ± 1) y búsqueda local
* ✅ **Recurrencias RFC 5545** con el crate `rrule`: diaria, semanal (días concretos), mensual (día del mes o n-ésimo día de la semana), anual, intervalos, fin por fecha o por número de veces. La serie se guarda una vez y se expande por rango, respetando cambios de horario (DST)
* ✅ Excepciones y alcance **este / este y los siguientes / todos** al editar, mover o eliminar
* ✅ **Recordatorios** (hasta 10 por evento, de "al empezar" a 4 semanas antes) y **notificaciones locales** del sistema
* ✅ **Borradores**: hacer clic o arrastrar crea un evento provisional que solo se guarda al escribir un título o cambiar un dato
* ✅ 39 pruebas Rust + 12 pruebas de frontend
* ⬜ Pendiente: etiquetas, asistentes y tareas en la interfaz (el esquema ya existe); deshacer/rehacer para cambios en series

## Fase 5 — Privacidad ✅
* ✅ Bloqueo automático por inactividad (adelantado)
* ✅ **Copias automáticas** (diarias, semanales o desactivadas; por defecto diarias) con un hilo propio que comprueba cada 5 min mientras la app está desbloqueada; **retención** configurable (por defecto 7) que solo borra archivos `.chronosbak` registrados como automáticos; **carpeta elegible** (comprobando que se puede escribir)
* ✅ **Copia antes de actualizar**: al desbloquear con una versión distinta de la registrada se crea una copia `pre_update`
* ✅ Configuración con secciones (General · Copias de seguridad · Importar y exportar · Privacidad y seguridad): historial, **verificar**, **restaurar** (con confirmación explícita y copia previa), restaurar desde archivo con el **selector nativo** (`tauri-plugin-dialog`, usado solo desde Rust)
* ✅ **Importar** `.ics` (Google, Outlook, Apple…: zonas IANA, Windows y `/mozilla…`, hora flotante, RRULE, EXDATE, RECURRENCE-ID, VALARM, DURATION) y `.json` de Chronos, sin duplicar (UID iCalendar guardado, migración 2); un `.chronosbak` elegido en Importar se restaura
* ✅ **Exportar** ICS / JSON / CSV (protección contra inyección de fórmulas) por calendario y rango de fechas; un evento suelto desde su menú contextual; **copia cifrada** a la carpeta elegida, con la contraseña de la app o con otra
* ✅ **Cambio de contraseña** y **«Eliminar todos mis datos»** (escribir ELIMINAR + contraseña; las copias solo se borran si se marca)
* ✅ **Clic derecho en huecos vacíos** (rejilla horaria, franja de día completo y mes): «Crear evento» y «Pegar evento»; **Copiar** en el menú del evento; **Ctrl+C / Ctrl+V** (pega bajo el puntero, sin usar el portapapeles del sistema)
* ✅ 49 pruebas Rust + 18 de frontend
* ⬜ No incluido: importar CSV (el CSV es solo de exportación); exportar varios eventos seleccionados a la vez (se exporta uno desde su menú o por calendario/rango)

## Fase 6 — Calidad ✅
* ✅ **54 pruebas Rust** (41 unitarias + 13 de integración) y **25 de frontend**; todas pasan en Linux y en Windows
* ✅ Pruebas nuevas: actualización de esquema v1 → v2 conservando datos; **rendimiento** sobre la base cifrada real; importación de 5 000 eventos; mensajes de error que no repiten datos del usuario; garantías de privacidad (CSP, permisos, sin APIs ni dependencias de red); disposición de 2 000 eventos en una semana
* ✅ `npm run test:tz`: las pruebas del frontend en 7 zonas horarias (incl. Kolkata +5:30 y Sídney)
* ✅ Rendimiento medido (compilación de lanzamiento, 20 000 eventos + 150 series diarias infinitas):

  | Operación | Tiempo |
  |---|---|
  | Consultar una semana (≈1 240 eventos con series expandidas) | 31 ms |
  | Consultar 6 semanas (vista Mes, ≈7 430 eventos) | 33 ms |
  | Buscar texto en toda la base | 29 ms |
  | Calcular recordatorios pendientes | 22 ms |
  | Importar un .ics de 5 000 eventos | 0,36 s |
  | Crear / verificar / restaurar copia de 20 150 eventos (7,2 MB) | 0,16 s / 0,08 s / 1,1 s |

  No se añadió virtualización a la Agenda: muestra como máximo 60 días y la disposición de 2 000 eventos tarda milisegundos.
* ✅ Revisión de seguridad: `npm audit` y `cargo audit` sin vulnerabilidades (499 crates); sin `unwrap()` en código de producción; `unsafe` prohibido en el núcleo; logs sin datos del usuario; sin `innerHTML`; `localStorage` solo con preferencias de presentación
* ✅ Guía de usuario (`docs/USER_GUIDE.md`) y CI de GitHub Actions (Windows, Linux, macOS)

## Fase 7 — Entrega ✅ (Windows y Linux verificados; macOS mediante CI)
* ✅ Versión **1.0.0**
* ✅ Instaladores de Linux (`.deb`, `.AppImage`) y de Windows (`.exe` NSIS y `.msi`) generados y probados
* ✅ Flujo `release.yml`: instaladores de los tres sistemas (macOS Apple Silicon e Intel) en un borrador de *Release* al subir una etiqueta `v*`
* ✅ Lista de verificación final, sobre el paquete `.deb` instalado y **sin red** (espacio de red aislado, solo `lo`):

  | Comprobación | Resultado |
  |---|---|
  | Compila | ✅ Linux y Windows, sin avisos de clippy |
  | Se ejecuta | ✅ paquete instalado |
  | Guarda los datos | ✅ un evento creado con 0.1.0 sigue tras instalar 1.0.0 |
  | Funciona sin conexión | ✅ crear eventos, copias y restauración sin ninguna interfaz de red |
  | Crea copias | ✅ manual, automática (al minuto) y previa a la actualización |
  | Restaura | ✅ con copia previa «Antes de restaurar» |
  | Sin servicios externos | ✅ 0 conexiones; sin clientes HTTP en las dependencias de Windows, Linux y macOS |

### Pendiente fuera del alcance de 1.0
* macOS: compilado por CI pero no probado en un Mac real (ver «Más adelante»)

---

# Próximas versiones

Plan acordado tras la 1.0. Cada versión se entrega igual que las anteriores: código con pruebas, prueba en la app real (Windows y Linux), documentación actualizada y un mensaje de commit para que el autor haga el commit.

Leyenda: ⬜ pendiente · 🔄 en curso · ✅ hecho

## Versión 1.1 — Completar el enunciado + donaciones ✅

### 1.1.1 Apoyar el proyecto (donaciones por PayPal)
Principio: la aplicación **no se conecta a PayPal**. Solo abre el enlace en el navegador cuando el usuario pulsa el botón; sin ventanas emergentes, sin recordatorios insistentes, sin rastreo.
1. ✅ Enlace del autor: `https://paypal.me/robertonovelo` (sin parámetros de seguimiento).
2. ✅ `tauri-plugin-opener` registrado **solo en Rust**: el frontend no recibe ningún permiso `opener:*` (más estricto que un permiso con alcance).
3. ✅ Comandos `open_donation_link` (abre únicamente la URL fija de `commands/about.rs`) y `app_about` (versión, licencia, repositorio).
4. ✅ **Configuración → Acerca de**: versión, licencia, repositorio (texto copiable) y botón **«Donar con PayPal»** con la explicación de que se abre el navegador y Chronos no envía datos.
5. ✅ README: apartado «Apoya el proyecto».
6. ✅ `.github/FUNDING.yml` con `custom: ["https://paypal.me/robertonovelo"]` (botón **Sponsor** de GitHub).
7. ✅ `privacy.test.ts`: capacidades sin cambios, sin `opener` en el frontend, URL fija exacta y única llamada a `open_url` en el código.
8. ✅ SECURITY.md: es la única acción que abre un sitio externo y la inicia el usuario.

### 1.1.2 Etiquetas
1. ✅ Repositorio `labels` en Rust: crear, renombrar, recolorear, eliminar (nombre único sin distinguir mayúsculas, máx. 500).
2. ✅ Asignar etiquetas a eventos y a series (las ocurrencias heredan las de la serie; una excepción puede tener las suyas). Máx. 20 por evento.
3. ✅ Comandos Tauri (`labels_list/create/update/delete`) + tipos en `ipc.ts`.
4. ✅ Panel del evento: fila «Etiquetas» con chips, buscador y creación rápida (`Enter`).
5. ✅ Barra lateral: sección «Etiquetas» con filtro (solo eventos con esa etiqueta) y menú de opciones.
6. ✅ Exportar/importar: ICS `CATEGORIES` (antes llevaba el nombre del calendario), JSON con colores, CSV columna «Etiquetas»; las copias ya incluían las tablas.
7. ✅ Pruebas: CRUD y validación, herencia en series y excepciones, borrado sin perder eventos, límite por evento, ida y vuelta ICS/JSON/CSV.

### 1.1.3 Tareas
1. ✅ Repositorio `tasks`: crear, editar, completar, reabrir, eliminar (con deshacer), eliminar completadas. Migración 3: UID de iCalendar para no duplicar al reimportar.
2. ✅ Recordatorios de tareas en el programador de notificaciones (dejan de avisar al completarlas; texto genérico con la app bloqueada).
3. ✅ Barra lateral «Tareas»: vencidas, hoy, próximas, sin fecha y completadas; añadir rápido; panel derecho con todos los detalles.
4. ✅ En el calendario: franja «Tareas» en Día/Semana, filas en la Agenda y recuento por día en el Mes, con casilla para completarlas.
5. ✅ `Shift+C` y «Crear tarea» en el menú de clic derecho (vence en ese hueco).
6. ✅ Exportar/importar en ICS (`VTODO`, prioridad, estado, avisos `RELATED=END`) y JSON; las copias ya incluían la tabla. CSV: solo eventos (es una tabla de eventos).
7. ✅ Pruebas: CRUD, validación, `null` frente a campo ausente, recordatorios (también de día completo y al completar), agrupación y textos de vencimiento, ida y vuelta ICS/JSON, VTODO de otras aplicaciones.

### 1.1.4 Participantes (solo como nota local)
1. ✅ Participantes en `event_attendees`: nombre, correo, papel (organizador, obligatorio, opcional) y respuesta (pendiente, acepta, quizá, rechaza). Validación: nombre o correo, correo con formato, sin repetidos, un solo organizador, máx. 100.
2. ✅ Panel del evento: sección «Participantes» con resumen de respuestas, añadir/quitar, cambiar respuesta y papel. Las ocurrencias heredan los de la serie; «solo este evento» puede cambiarlos.
3. ✅ Texto visible: **Chronos no envía invitaciones ni correos**.
4. ✅ ICS `ORGANIZER`/`ATTENDEE` (`CN`, `ROLE`, `PARTSTAT`) y JSON. De paso se corrigió la lectura de parámetros ICS entre comillas con `;` (p. ej. `CN="Pérez; Ana"`).
5. ✅ Pruebas: validación, herencia y excepción, ida y vuelta ICS/JSON, ICS al estilo de Google Calendar.

### 1.1.5 Deshacer/rehacer en eventos repetidos
1. ✅ Antes de cada cambio en una serie se toma una instantánea completa (maestra, regla, excepciones, recordatorios, etiquetas, participantes y UID).
2. ✅ Comandos `events_snapshot(s)` y `events_replace_series`: borran las raíces afectadas y reponen la instantánea en una transacción.
3. ✅ Integrado en `Ctrl+Z` / `Ctrl+Shift+Z` y en el botón «Deshacer» del aviso al eliminar (el historial se borra al bloquear).
4. ✅ Pruebas: deshacer, rehacer y volver a deshacer «editar todos», «editar siguientes», «quitar repetición», «eliminar siguientes», «eliminar todos» y convertir un evento simple en serie.
5. ✅ Corrección encontrada por estas pruebas: las reglas con fin (`UNTIL`) anterior a 2026 se rechazaban; ahora se aceptan (afectaba a la importación de series antiguas de Google/Outlook).

### 1.1.6 Correcciones
1. ✅ La lista de copias se actualiza sola (cada 20 s) cuando se crea una copia automática con la pestaña abierta.

### 1.1.7 Idiomas ✅
1. ✅ Interfaz en 9 idiomas: español, inglés, chino simplificado, portugués (Brasil), francés, alemán, japonés, coreano y ruso. Todo va dentro del binario (sin descargas).
2. ✅ El texto en español es la clave (`t("…")`); cada idioma es un JSON en `src/i18n/locales/`. Plurales con `Intl.PluralRules` (ruso: one/few/many) y fechas con los locales de date-fns e `Intl`.
3. ✅ Idioma del sistema por defecto; selector en la pantalla de desbloqueo y en Configuración → General. Se guarda solo en el equipo.
4. ✅ Notificaciones de recordatorios y títulos de diálogos del sistema (Rust) en el idioma elegido; mensajes de validación del backend traducidos.
5. ✅ `scripts/i18n-check.mjs` y `i18n.test.ts`: ningún idioma puede tener textos sin traducir, sobrantes o con marcadores `{n}` rotos.
6. Añadir un idioma: copiar `en.json`, traducirlo, registrarlo en `LANGUAGES` (`src/i18n/index.ts`) y en `src-tauri/src/i18n.rs`.

## Versión 1.2 — Funciones de productividad ✅

### 1.2.1 Menú de comandos (`Ctrl+K`)
1. ✅ Caja única con resultados agrupados: crear (evento escrito o tarea), ir a una fecha, acciones (vistas, hoy, nuevo evento/tarea, copia de seguridad, configuración, tema, idioma, bloquear…) y eventos.
2. ✅ Flechas, `Tab` y `Enter`; filtrado sin acentos ni mayúsculas (empieza igual > empieza una palabra > contiene > iniciales). La búsqueda de eventos en la base también ignora acentos y mayúsculas en cualquier alfabeto (función `chronos_fold` en SQLite).
3. ✅ El buscador del panel derecho abre el menú; se mantienen `/` y `Ctrl+K`.
4. ✅ Pruebas de filtrado y orden (`commands.test.ts`) y de búsqueda sin acentos en Rust.

### 1.2.2 Ir a la fecha (`.`)
1. ✅ Ventana con texto libre («15 dic», «próximo lunes», «en 2 semanas», «2027-03-01», «march») y selector de fecha; muestra la fecha entendida antes de ir.
2. ✅ Pruebas del intérprete de fechas (español e inglés; día/mes o mes/día según el idioma).

### 1.2.3 Crear eventos escribiendo
1. ✅ Intérprete local en español e inglés (`src/lib/nlp.ts`, sin red): fechas, intervalos de días, horas e intervalos de horas, duraciones, «por la tarde», repeticiones (diaria, días laborables, días concretos, cada N semanas, mensual, anual, «10 veces», «hasta el 15 dic»).
2. ✅ Vista previa de lo entendido (fecha, hora, duración y repetición) antes de crear; se puede deshacer, también si es una serie.
3. ✅ Disponible desde el menú de comandos, el botón «Nuevo evento» y la tecla `N` (`C` sigue abriendo el formulario).
4. ✅ Batería de 97 pruebas con frases reales, incluidas trampas («Reunión 10-12», «Partido 2-1», «Cumpleaños de Mayo»).

### 1.2.4 Navegación con teclado
1. ✅ `↓` (o `Tab`) enfoca los eventos de la vista; `↑`/`↓` evento anterior/siguiente, `←`/`→` día anterior/siguiente; `Enter` abre los detalles; `Shift+F10` abre el menú contextual.
2. ✅ `Alt+↑/↓` mueve el evento 15 min y `Alt+←/→` un día (pregunta el alcance en eventos repetidos).
3. ✅ Accesibilidad: foco visible en eventos, menú y diálogos; eventos con nombre accesible (título, fecha y hora); menú como `combobox` + `listbox`; el foco vuelve a su sitio al cerrar.

### 1.2.5 Horario laboral por día
1. ✅ Configuración → General: horario para cada día de la semana en tramos de 30 min, o día libre. Por defecto, lunes a viernes de 9:00 a 18:00; el horario único anterior se migra a todos los días.
2. ✅ Sombreado de la rejilla según el día (los días libres, enteros).

## Versión 1.3 — Privacidad y comodidad

### 1.3.1 Desbloqueo con Windows Hello (opcional)
1. ⬜ Investigar y documentar el modelo: la clave se protege con el almacén del sistema (Windows Hello / Llavero de macOS) **además** de la contraseña, nunca en su lugar.
2. ⬜ Desactivado por defecto; activarlo exige la contraseña.
3. ⬜ La contraseña sigue siendo necesaria tras reiniciar y para restaurar copias.
4. ⬜ SECURITY.md: ventajas, riesgos y cómo desactivarlo.

### 1.3.2 Copia automática a memoria USB
1. ⬜ Elegir una unidad/carpeta externa como destino secundario.
2. ⬜ Al detectar que está conectada, copiar la última copia cifrada (sin pedir nada).
3. ⬜ Retención propia en el destino externo.

### 1.3.3 Exportar disponibilidad
1. ⬜ Exportar «ocupado/libre» de un rango como `.ics` (`VFREEBUSY`) **sin títulos ni detalles**.
2. ⬜ Elegir calendarios y respetar la disponibilidad «Libre» de cada evento.
3. ⬜ Pruebas: que el archivo no contenga ningún dato del evento.

## Más adelante

### Distribución
* ⬜ Firma de código de los instaladores (Windows: certificado de firma; macOS: cuenta de desarrollador de Apple y notarización).
* ⬜ Probar en un Mac real.
* ⬜ Buscar actualizaciones **solo cuando el usuario lo pide** (única excepción de red del enunciado), con verificación de firma.

### Nuevas plataformas
* ⬜ Android e iPhone con Tauri 2 (adaptar la interfaz a pantallas táctiles).
* ⬜ Sincronización entre equipos sin servidores: red local o archivo cifrado en una carpeta que el usuario sincronice, con resolución de conflictos.
