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
* Firma de código de los instaladores (requiere certificados de pago de Microsoft/Apple): hoy Windows SmartScreen y macOS Gatekeeper muestran un aviso
* macOS: compilado por CI pero no probado en un Mac real
* Etiquetas, asistentes y tareas en la interfaz (el esquema ya existe); deshacer/rehacer para cambios en series
