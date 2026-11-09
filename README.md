# Chronos Private Calendar

Calendario de escritorio **local, privado y cifrado**, escrito en Rust (Tauri 2) y React.
Sin cuentas, sin servidores, sin telemetría: tus datos no salen de tu equipo.

> **Estado: Fases 1–4 completas.** Calendario utilizable con eventos cifrados, vistas Día/Semana/Mes/Agenda/N días, eventos que se repiten (RFC 5545), recordatorios con notificaciones locales, borradores, búsqueda, deshacer/rehacer y bloqueo automático. Faltan importación/exportación y la pantalla de restauración de copias (Fase 5). Ver [docs/ROADMAP.md](docs/ROADMAP.md).

## Qué hay implementado

* Base de datos SQLite **cifrada con SQLCipher**; clave derivada con Argon2id y envuelta con XChaCha20-Poly1305
* Pantallas de primera configuración y de desbloqueo; bloqueo manual (botón o `Ctrl+L`) y automático por inactividad
* Vistas **Día, Semana, Mes, Agenda y número de días a elegir** (2–21), mini calendario con números de semana, indicador de hora actual, formato 12/24 h
* Diseño minimalista de tres columnas con panel derecho (buscador, atajos útiles o detalles del evento) o tarjeta flotante junto al evento
* Segunda zona horaria en la rejilla, zona horaria por evento y control «±» del número de días
* **Eventos**: crear con clic o arrastrando, mover, redimensionar, día completo y de varios días, eventos simultáneos lado a lado, aviso de conflictos
* Panel de detalles con guardado automático (título, fechas, calendario, color, ubicación, disponibilidad, privacidad, enlaces, notas)
* **Eventos que se repiten** (cada día, semana, día laborable, mes, año o personalizado) con edición de «este», «este y los siguientes» o «todos»
* **Recordatorios** con notificaciones locales del sistema (con opción de ocultar el título)
* **Borradores**: un clic crea un evento provisional que solo se guarda si escribes un título o cambias algo
* Menú contextual en eventos y en huecos vacíos (**crear / pegar evento**), copiar y pegar (`Ctrl+C` / `Ctrl+V`), duplicar, eliminar con confirmación, **deshacer/rehacer** (`Ctrl+Z` / `Ctrl+Shift+Z`)
* Búsqueda local (`/` o `Ctrl+K`) y atajos de teclado (lista completa en Configuración)
* Calendarios: crear, renombrar y recolorear (doble clic), mostrar/ocultar, reordenar, predeterminado, eliminar con confirmación
* Copias de seguridad cifradas `.chronosbak`: **automáticas** (diarias/semanales, con retención y carpeta elegible), manuales, antes de restaurar y antes de actualizar; historial, verificar y restaurar desde la interfaz
* **Importar** `.ics` y `.json` sin duplicados; **exportar** ICS, JSON, CSV o copia cifrada, por calendario, por fechas o un solo evento
* Cambio de contraseña y **«Eliminar todos mis datos»**
* Tema claro, oscuro o del sistema
* CSP estricta, sin acceso a red, fuentes empaquetadas localmente

## Documentación

| Documento | Contenido |
|---|---|
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
npm run tauri build      # instalador de producción en target/release/bundle/
```

## Pruebas

```powershell
cargo test -p chronos-core      # 49 pruebas: cifrado, migraciones, eventos, recurrencias, recordatorios, copias, importar/exportar
npm.cmd test                    # 18 pruebas de fechas, zonas horarias, disposición, reglas de repetición y pegar eventos
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

## Licencia

MIT — ver [LICENSE](LICENSE).
