# Guía de uso — Chronos Private Calendar

Chronos es un calendario de escritorio que guarda todo **en tu equipo, cifrado con tu contraseña**. No necesitas cuenta ni conexión a internet, y ningún dato sale de tu computadora.

## 1. Instalar

| Sistema | Archivo | Notas |
|---|---|---|
| Windows 10/11 | `Chronos Private Calendar_x.y.z_x64-setup.exe` (recomendado) o `.msi` | El instalador no está firmado: Windows SmartScreen mostrará «Windows protegió su PC». Pulsa **Más información → Ejecutar de todas formas**. |
| Linux | `.AppImage` (cualquier distribución) o `.deb` (Debian/Ubuntu) | AppImage: dale permiso de ejecución (`chmod +x`) y ábrelo. |
| macOS | `.dmg` | Sin firma de Apple: la primera vez, clic derecho sobre la app → **Abrir**. |

Windows 10 y 11 ya incluyen WebView2, el componente que dibuja la interfaz. Solo en un Windows sin WebView2 el instalador lo descargaría de Microsoft durante la instalación; Chronos en sí nunca se conecta a internet.

Al actualizar a una versión nueva, Chronos crea automáticamente una **copia de seguridad previa a la actualización** la primera vez que lo desbloqueas.

## 2. Primer uso: tu contraseña

Al abrirlo por primera vez, elige una contraseña (mínimo 8 caracteres). Con ella se cifra la base de datos.

> **Importante:** no existe forma de recuperar una contraseña olvidada. No hay servidor ni «puerta trasera». Si la olvidas, solo podrás recuperar tus datos desde una copia de seguridad cuya contraseña recuerdes. Usa una frase larga que puedas recordar, o guárdala en tu gestor de contraseñas.

- **Bloquear:** botón del candado (abajo a la izquierda) o `Ctrl+L`.
- **Bloqueo automático:** Configuración → General → Bloqueo automático.
- **Cambiar la contraseña:** Configuración → Privacidad y seguridad.
- **Idioma:** Chronos usa el idioma del sistema si está disponible (si no, inglés). Cámbialo con el selector de la pantalla de desbloqueo o en Configuración → General → Idioma: español, English, 简体中文, Português (Brasil), Français, Deutsch, 日本語, 한국어 y Русский.

## 3. Calendario

- **Vistas:** botón de vista arriba a la derecha (Día `1`/`D`, Semana `0`/`W`, Mes `M`, Agenda `A`) o «Número de días» (`2`…`9`). El botón **±** al final de los días ajusta cuántos se ven.
- **Navegar:** **Hoy** (`T`), flechas (`J`/`K` o `←`/`→`), o un día del mini calendario.
- **Segunda zona horaria:** botón **+** junto a la zona (arriba a la izquierda de la rejilla).
- **Ir a una fecha:** pulsa `.` y escribe «15 dic», «próximo lunes», «en 2 semanas»… o elígela en el selector.
- **Menú de comandos:** `Ctrl+K` o `/` (o el buscador del panel derecho). Escribe para buscar eventos, ejecutar acciones (cambiar de vista, crear una copia, cambiar el tema o el idioma, bloquear…), saltar a una fecha o crear un evento. Muévete con las flechas y pulsa `Enter`.
- **Con el teclado:** `↓` enfoca el primer evento de la vista; las flechas pasan de un evento a otro, `Enter` abre los detalles y `Alt+flechas` mueve el evento 15 minutos o un día.
- **Horario laboral:** Configuración → General. Elige el horario de cada día o márcalo como libre; las horas fuera del horario se ven sombreadas.
- **Configuración de la vista:** formato 12/24 h, inicio de semana, números de semana.
- **Paneles:** `` ` `` muestra u oculta la barra izquierda; el icono de panel (arriba a la derecha) oculta el panel derecho. Con el panel oculto, los detalles se abren en una tarjeta flotante junto al evento.

## 4. Eventos

**Crear escribiendo:** pulsa `N` o el botón ✎ (arriba a la izquierda) y escribe el evento en español o en inglés. Chronos muestra lo que ha entendido antes de crearlo:

| Escribes | Se crea |
|---|---|
| Dentista mañana 5pm 1h | Mañana de 17:00 a 18:00 |
| Gimnasio lunes y miércoles 7am | Cada semana, lunes y miércoles a las 7:00 |
| Viaje 10–12 dic | Del 10 al 12 de diciembre, días completos |
| Reunión jueves 10:00-11:30 | El jueves de 10:00 a 11:30 |
| Yoga los martes 18:00 hasta el 15 dic | Cada martes hasta el 15 de diciembre |
| Standup every weekday 9:30 | De lunes a viernes a las 9:30 |

Sin hora, el evento es de día completo; sin fecha, es para hoy (o mañana, si la hora ya pasó). «A las 5» sin am/pm se entiende como 17:00 (de 1 a 6, por la tarde). Puedes deshacerlo con `Ctrl+Z`.

- **Crear:** clic en un hueco (evento de la duración predeterminada), arrastrar para elegir la duración, clic en la franja «Todo el día» o en un día del Mes, o la tecla `C`.
  Lo que creas empieza como **borrador**: se guarda cuando escribes un título o cambias algún dato. Si cierras sin cambiar nada, desaparece.
- **Clic derecho en un hueco:** Crear evento (`C`) o Pegar evento (`Ctrl+V`) justo en ese lugar.
- **Clic derecho en un evento:** abrir, Copiar (`Ctrl+C`), Duplicar (`Ctrl+D`), exportar como `.ics`, moverlo a otro calendario o eliminarlo (`Supr`).
- **Participantes:** en los detalles, **Participantes** → nombre y, si quieres, correo. Puedes marcar su respuesta (pendiente, acepta, quizá, rechaza) y su papel (obligatorio, opcional u organizador). Es solo una lista para ti: **Chronos no envía invitaciones ni correos**. Al exportar a ICS solo van los que tienen correo; el JSON los incluye a todos.
- **Mover / cambiar duración:** arrastra el evento; arrastra su borde inferior para alargarlo.
- **Detalles** (panel derecho): título, horas con duración, fecha, todo el día, zona horaria, repetición, ubicación, enlaces, descripción, calendario, disponibilidad, visibilidad, recordatorios y color. Todo se guarda solo.
- **Deshacer / rehacer:** `Ctrl+Z` / `Ctrl+Shift+Z`, también en eventos que se repiten (cualquier alcance: este, este y los siguientes, todos). El historial dura mientras la app esté desbloqueada.
- **Buscar:** `Ctrl+K` o `/`.

### Eventos que se repiten
En los detalles, **Repetir**: cada día, cada semana, días laborables, cada mes, cada año o **Personalizar…** (cada N días/semanas/meses/años, qué días, y si termina nunca, en una fecha o tras N veces).
Al cambiar o borrar uno, Chronos pregunta: **Este evento · Este y los siguientes · Todos los eventos**.

### Recordatorios
En los detalles, **Recordatorios**: desde «al empezar» hasta «1 semana antes» (hasta 10 por evento). Las notificaciones las muestra tu sistema operativo **solo mientras Chronos está abierto** (bloqueado o no).
Si no quieres que el título aparezca en las notificaciones: Configuración → General → Notificaciones de recordatorios → **Ocultar detalles**.

## 5. Calendarios

En la barra izquierda: casilla de color para mostrar u ocultar; doble clic para renombrar; **⋯** para cambiar color, hacerlo predeterminado, ordenarlo o eliminarlo (borra también sus eventos); **Añadir calendario** abajo.

### Tareas
En la barra izquierda, sección **Tareas**, agrupadas en **Vencidas**, **Hoy**, **Próximas**, **Sin fecha** y **Completadas**.
- **Crear:** `Shift+C` (tarea para hoy, con el título listo para escribir), **Añadir tarea** en la barra izquierda (sin fecha; `Enter` para encadenar varias) o clic derecho en un hueco del calendario → **Crear tarea** (vence en ese día y hora).
- **Completar:** pulsa el círculo, en la lista o en el calendario. Las completadas se pueden borrar todas con **Eliminar completadas**.
- **Detalles** (panel derecho): título, fecha y hora (o todo el día), prioridad, calendario, recordatorios y notas. Todo se guarda solo.
- **Eliminar:** icono de papelera o `Supr` con la tarea abierta; aparece **Deshacer** durante unos segundos.
- **En el calendario:** las tareas con fecha aparecen en la franja **Tareas** de las vistas Día y Semana, en la Agenda, y como recuento en cada día del Mes. Si su calendario está oculto, tampoco se muestran ahí.
- **Recordatorios:** avisan antes del vencimiento (las de todo el día, respecto a la medianoche) y dejan de avisar al completarlas.
- Se exportan e importan en ICS (`VTODO`, compatible con Apple Recordatorios, Thunderbird u Outlook) y en JSON. El CSV solo incluye eventos.

### Etiquetas
En la barra izquierda, sección **Etiquetas**: **Añadir etiqueta**, doble clic para renombrar y **⋯** para cambiar el color o eliminarla (los eventos no se borran, solo pierden la etiqueta).
- **Asignar:** en los detalles del evento, fila **Etiquetas**: busca una existente o escribe un nombre nuevo y pulsa `Enter` para crearla. Un evento puede tener hasta 20.
- **Filtrar:** pulsa una etiqueta en la barra izquierda para ver solo los eventos que la tienen; vuelve a pulsarla (o **Quitar filtro**) para verlos todos.
- En un evento que se repite, las etiquetas se aplican a la serie según el alcance que elijas (este, este y los siguientes, o todos).
- Al exportar, las etiquetas van en ICS como categorías (`CATEGORIES`, las muestran Outlook y Apple Calendar), en JSON con su color y en CSV en la columna «Etiquetas». Al importar se crean las que falten.

## 6. Copias de seguridad (Configuración → Copias de seguridad)

- **Copias automáticas:** frecuencia (diaria o semanal), cuántas conservar y carpeta. Recomendado: elegir una carpeta en **otro disco o una memoria USB**, porque si se daña o se formatea el equipo, la carpeta predeterminada se pierde con él.
- **Crear copia ahora**, **Verificar** (comprueba que el archivo está íntegro y que la contraseña es correcta) y **Restaurar**.
- **Restaurar desde archivo…** para traer una copia de otra carpeta o de otro equipo.
- Antes de restaurar, Chronos guarda automáticamente una copia «Antes de restaurar» del estado actual.
- Cada copia se abre con **la contraseña que tenía la app cuando se creó** (o con la que elegiste si usaste «otra contraseña»).

## 7. Importar y exportar (Configuración → Importar y exportar)

- **Importar:** archivos `.ics` (Google Calendar, Outlook, Apple Calendar…), `.json` exportados por Chronos o copias `.chronosbak`. Si importas dos veces el mismo archivo, no se duplica nada.
  En Google Calendar: Configuración → Importar y exportar → Exportar (descarga un `.zip`; descomprímelo e importa el `.ics` de cada calendario).
- **Exportar:** ICS (para otras apps), JSON (todo, para Chronos), CSV (hojas de cálculo) o copia cifrada. Puedes elegir calendarios y un rango de fechas.

> Los archivos ICS, JSON y CSV **no van cifrados**: guárdalos en un lugar seguro y bórralos cuando ya no los necesites. Solo la copia cifrada `.chronosbak` está protegida con contraseña.

## 8. Privacidad

- La base de datos completa está cifrada (SQLCipher, AES-256); la clave se deriva de tu contraseña con Argon2id.
- No hay cuentas, sincronización, estadísticas, anuncios ni informes de errores. Chronos solo se conecta a internet si buscas actualizaciones (ver abajo).
- **Eliminar todos mis datos** (Configuración → Privacidad y seguridad): pide escribir ELIMINAR y tu contraseña. Puedes conservar o borrar también las copias.

- **Actualizaciones** (Configuración → Acerca de, o «Buscar actualizaciones» en `Ctrl+K`): pulsa **Buscar actualizaciones**; si hay una versión nueva, **Descargar e instalar** guarda antes una copia cifrada, comprueba la firma del autor, instala y vuelve a abrir Chronos. Puedes activar que lo compruebe solo una vez al día (desactivado por defecto). En Linux se actualiza sola la versión AppImage; el paquete `.deb` se actualiza reinstalándolo.
- **Configuración → Acerca de** muestra la versión y el repositorio. El botón **Donar con PayPal** es la única opción que abre una página web: lo hace en tu navegador, solo cuando lo pulsas, y Chronos no envía ningún dato.

Detalles técnicos y limitaciones: [SECURITY.md](SECURITY.md).

## 9. Dónde están tus datos

| Sistema | Carpeta |
|---|---|
| Windows | `%LOCALAPPDATA%\io.github.robertonovelo12.chronos\` |
| Linux | `~/.local/share/io.github.robertonovelo12.chronos/` |
| macOS | `~/Library/Application Support/io.github.robertonovelo12.chronos/` |

Contiene `chronos.db` (cifrada), `keystore.json` (tu clave envuelta, sin secretos en claro) y `backups/`.

## 10. Problemas frecuentes

| Problema | Solución |
|---|---|
| «Contraseña incorrecta» y no la recuerdas | No se puede recuperar. Si tienes una copia `.chronosbak` cuya contraseña recuerdes: usa **Eliminar todos mis datos** (con la contraseña actual) o borra la carpeta de datos, crea una contraseña nueva y restaura la copia. |
| Tras varios intentos fallidos tarda en responder | Es intencionado: cada intento fallido añade una espera (hasta 30 s) para frenar ataques. |
| No llegan los recordatorios | Chronos debe estar abierto. En Windows, revisa Configuración → Sistema → Notificaciones; en macOS, permite las notificaciones de Chronos. |
| La importación omite un evento | Algunos eventos traen reglas o datos que Chronos no admite; el resumen de la importación indica cuántos se omitieron o se importaron sin repetición. |
| Windows SmartScreen bloquea el instalador | El instalador no está firmado. **Más información → Ejecutar de todas formas.** |
