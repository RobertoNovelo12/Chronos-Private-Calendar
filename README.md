# Chronos Private Calendar

Calendario de escritorio **local, privado y cifrado**, escrito en Rust (Tauri 2) y React.
Sin cuentas, sin servidores, sin telemetría: tus datos no salen de tu equipo.

> **Versión 1.3.0** — las 7 fases de la 1.0; tareas, etiquetas, participantes y deshacer en series (1.1); 9 idiomas; menú de comandos, crear eventos escribiendo, ir a una fecha, navegación con teclado y horario laboral por día y actualizaciones firmadas (1.2); bandeja del sistema, inicio con el equipo y desbloqueo recordado opcional (1.3). Instaladores de Windows y Linux probados; macOS se genera con GitHub Actions (sin probar todavía en un Mac). Para usarlo, empieza por la [guía de uso](docs/USER_GUIDE.md); para el plan y los resultados, [docs/ROADMAP.md](docs/ROADMAP.md).

## Qué hay implementado

* Base de datos SQLite **cifrada con SQLCipher**; clave derivada con Argon2id y envuelta con XChaCha20-Poly1305
* Pantallas de primera configuración y de desbloqueo; bloqueo manual (botón o `Ctrl+L`) y automático por inactividad
* **Bandeja del sistema** (cerrar la ventana la oculta y la app sigue avisando), **inicio con el equipo** (opcionalmente minimizado), una sola instancia y **«Recordar el desbloqueo en este equipo»** opcional (Windows y macOS)
* Vistas **Día, Semana, Mes, Agenda y número de días a elegir** (2–21), mini calendario con números de semana, indicador de hora actual, formato 12/24 h
* Diseño minimalista de tres columnas con panel derecho (buscador, atajos útiles o detalles del evento) o tarjeta flotante junto al evento
* Segunda zona horaria en la rejilla, zona horaria por evento y control «±» del número de días
* **Eventos**: crear con clic o arrastrando, mover, redimensionar, día completo y de varios días, eventos simultáneos lado a lado, aviso de conflictos
* Panel de detalles con guardado automático (título, fechas, calendario, color, ubicación, disponibilidad, privacidad, enlaces, notas)
* **Eventos que se repiten** (cada día, semana, día laborable, mes, año o personalizado) con edición de «este», «este y los siguientes» o «todos»
* **Recordatorios** con notificaciones locales del sistema (con opción de ocultar el título)
* **Borradores**: un clic crea un evento provisional que solo se guarda si escribes un título o cambias algo
* Menú contextual en eventos y en huecos vacíos (**crear / pegar evento**), copiar y pegar (`Ctrl+C` / `Ctrl+V`), duplicar, eliminar con confirmación, **deshacer/rehacer** (`Ctrl+Z` / `Ctrl+Shift+Z`)
* **Menú de comandos** (`Ctrl+K` o `/`): busca eventos (sin distinguir acentos), ejecuta acciones, salta a fechas y crea eventos o tareas
* **Crear eventos escribiendo** (`N` o el botón ✎), en español o inglés: «Dentista mañana 5pm 1h», «Gimnasio lunes y miércoles 7am», «Viaje 10–12 dic», con vista previa de lo entendido
* **Ir a la fecha** (`.`): «15 dic», «próximo lunes», «en 2 semanas» o selector de fecha
* **Navegación con teclado**: `↓`/`Tab` enfoca eventos, flechas para moverse entre ellos, `Enter` abre, `Alt+flechas` los mueve 15 min o un día; foco visible y etiquetas para lectores de pantalla
* **Horario laboral por día** de la semana (o día libre), sombreado en la rejilla
* Atajos de teclado (lista completa con `?`)
* **Actualizaciones en línea** (Configuración → Acerca de): solo cuando las pides —o una vez al día si lo activas—, descargadas de los *Releases* oficiales y **verificadas con la firma del autor**; antes de instalar se guarda una copia cifrada
* **Tareas** con fecha opcional, prioridad, notas y recordatorios: lista en la barra lateral (vencidas, hoy, próximas, sin fecha, completadas) y en el calendario (Día, Semana, Agenda y recuento en Mes)
* **Participantes** como nota local (nombre, correo, papel y respuesta); Chronos no envía invitaciones
* **Etiquetas** de color en los eventos (varias por evento), con creación rápida y filtro desde la barra lateral
* Calendarios: crear, renombrar y recolorear (doble clic), mostrar/ocultar, reordenar, predeterminado, eliminar con confirmación
* Copias de seguridad cifradas `.chronosbak`: **automáticas** (diarias/semanales, con retención y carpeta elegible), manuales, antes de restaurar y antes de actualizar; historial, verificar y restaurar desde la interfaz
* **Importar** `.ics` y `.json` sin duplicados; **exportar** ICS, JSON, CSV o copia cifrada, por calendario, por fechas o un solo evento
* Cambio de contraseña y **«Eliminar todos mis datos»**
* Tema claro, oscuro o del sistema
* **9 idiomas**: español, English, 简体中文, Português (Brasil), Français, Deutsch, 日本語, 한국어 y Русский (se elige al desbloquear o en Configuración → General; por defecto, el del sistema). Fechas, plurales y notificaciones en cada idioma, todo incluido en la aplicación y sin red
* CSP estricta, sin acceso a red, fuentes empaquetadas localmente

## Instalar

Descarga el instalador de la página **Releases** del repositorio (o genéralo tú, ver «Crear instaladores») y sigue la [guía de uso](docs/USER_GUIDE.md). Los instaladores no están firmados: Windows y macOS mostrarán un aviso la primera vez.

## Documentación

| Documento | Contenido |
|---|---|
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | **Guía de uso** para quien usa la aplicación |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Arquitectura, carpetas, dependencias, flujo de la app |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Esquema SQLite, recurrencias, zonas horarias |
| [docs/SECURITY.md](docs/SECURITY.md) | Privacidad, cifrado, modelo de amenazas y **limitaciones** |
| [docs/BACKUP_FORMAT.md](docs/BACKUP_FORMAT.md) | Formato `.chronosbak` y restauración |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Plan por fases |

## Preparar el equipo (Windows)

Hace falta una sola vez:

1. **Visual Studio Build Tools 2022** con la carga de trabajo *Desarrollo para el escritorio con C++* (incluye el SDK de Windows):
   ```powershell
   winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
   ```
2. **Rust** (toolchain MSVC):
   ```powershell
   winget install Rustlang.Rustup
   ```
3. **Strawberry Perl** — necesario para compilar OpenSSL, que SQLCipher usa como proveedor criptográfico (el Perl que trae Git para Windows no sirve):
   ```powershell
   winget install StrawberryPerl.StrawberryPerl
   ```
4. **NASM** (recomendado, acelera OpenSSL): `winget install NASM.NASM`
5. **Node.js** 20 o superior (ya instalado si `node --version` funciona). WebView2 viene con Windows 10/11.
6. Cierra y vuelve a abrir la terminal para que se actualice el `PATH`.

Si PowerShell muestra *"la ejecución de scripts está deshabilitada"* al usar `npm`, usa `npm.cmd` en lugar de `npm`, o permite scripts locales para tu usuario:
```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Linux (Debian/Ubuntu): `sudo apt install libwebkit2gtk-4.1-dev librsvg2-dev build-essential perl` + Rust + Node.
macOS: `xcode-select --install` + Rust + Node.

## Ejecutar

```powershell
npm install
npm run tauri dev        # desarrollo (la primera compilación tarda varios minutos: compila SQLCipher y OpenSSL)
npm run tauri build      # instaladores de producción en target/release/bundle/
```

## Crear instaladores

| Sistema | Dónde | Resultado |
|---|---|---|
| Windows | En Windows: `npm.cmd run tauri build` | `target\release\bundle\nsis\*-setup.exe` y `target\release\bundle\msi\*.msi` |
| Linux | En Linux: `npm run tauri build -- --bundles deb,appimage` | `target/release/bundle/{deb,appimage}/` |
| macOS | En un Mac, o con GitHub Actions | `.dmg` |

**Con GitHub Actions** (los tres sistemas a la vez): sube una etiqueta de versión y el flujo `.github/workflows/release.yml` crea un borrador de *Release* con todos los instaladores:

```powershell
git tag v1.3.0
git push origin v1.3.0
```

### Firmar las actualizaciones

Las instalaciones existentes solo aceptan una actualización si está firmada con la clave del autor. La clave pública va en `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`); la privada **nunca** entra en el repositorio:

1. Se genera una vez: `npx.cmd tauri signer generate -w %USERPROFILE%\.tauri\chronos-updater.key` (guarda el archivo y su contraseña en tu gestor de contraseñas: si se pierden, las instalaciones existentes ya no podrán actualizarse solas).
2. En GitHub → Settings → Secrets and variables → Actions: `TAURI_SIGNING_PRIVATE_KEY` (contenido del archivo `.key`) y `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
3. Al subir la etiqueta, el flujo firma los paquetes y añade `latest.json` al borrador del *Release*. **Las apps solo ven la versión nueva cuando publicas el borrador** (pulsando *Publish release*).

Las compilaciones locales (`npm run tauri build`) no necesitan la clave: los paquetes firmados solo se generan en la publicación (`src-tauri/tauri.release.conf.json`).

Además, `.github/workflows/ci.yml` compila y ejecuta todas las pruebas en Windows, Linux y macOS en cada `push`.

## Pruebas

```powershell
cargo test -p chronos-core      # 71 pruebas: cifrado, migraciones, eventos, recurrencias, recordatorios, tareas,
                                # etiquetas, participantes, deshacer en series, copias, importar/exportar,
                                # rendimiento con 20 000 eventos, errores sin datos
npm.cmd test                    # 170 pruebas: fechas, disposición, repetición, pegar, tareas, etiquetas, intérprete
                                # de fechas y eventos escritos, menú de comandos, navegación con teclado, horario
                                # laboral, rendimiento, garantías de privacidad y traducciones completas
node scripts/i18n-check.mjs     # textos sin traducir o con marcadores rotos en cada idioma
npm.cmd run test:tz             # las pruebas del frontend en 7 zonas horarias
npm.cmd run typecheck
```

## Dónde se guardan los datos

| Sistema | Carpeta |
|---|---|
| Windows | `%LOCALAPPDATA%\io.github.robertonovelo12.chronos\` |
| Linux | `~/.local/share/io.github.robertonovelo12.chronos/` |
| macOS | `~/Library/Application Support/io.github.robertonovelo12.chronos/` |

Contiene `chronos.db` (cifrada), `keystore.json` (clave envuelta, sin secretos en claro) y `backups/`.
**Si olvidas la contraseña no hay forma de recuperar los datos**, salvo desde una copia cuya contraseña recuerdes.

## Apoya el proyecto

Chronos es gratuito y de código abierto. Si te resulta útil, puedes apoyar su desarrollo con una donación voluntaria:

**[paypal.me/robertonovelo](https://paypal.me/robertonovelo)**

También desde la app: **Configuración → Acerca de → Donar con PayPal** (abre el enlace en tu navegador; la aplicación no envía datos). Donar no desbloquea ninguna función.

## Licencia

MIT — ver [LICENSE](LICENSE).
