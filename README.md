# Chronos Private Calendar

Calendario de escritorio **local, privado y cifrado**, escrito en Rust (Tauri 2) y React.
Sin cuentas, sin servidores, sin telemetría: tus datos no salen de tu equipo.

> **Estado: Fase 2 de 7.** Ya funcionan la base de datos cifrada, la configuración y el desbloqueo con contraseña, el bloqueo, la gestión de calendarios y las copias de seguridad cifradas. Las vistas de calendario y los eventos llegan en las Fases 3 y 4. Ver [docs/ROADMAP.md](docs/ROADMAP.md).

## Qué hay implementado

* Base de datos SQLite **cifrada con SQLCipher**; clave derivada con Argon2id y envuelta con XChaCha20-Poly1305
* Pantallas de primera configuración y de desbloqueo; bloqueo manual (botón o `Ctrl+L`)
* Calendarios: crear, renombrar y recolorear (doble clic), mostrar/ocultar, reordenar, predeterminado, eliminar con confirmación
* Copias de seguridad cifradas `.chronosbak` (backend completo: crear, inspeccionar, verificar, restaurar con copia previa; en la interfaz, por ahora, "Crear copia")
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
cargo test -p chronos-core      # 21 pruebas: cifrado, migraciones, calendarios, copias, restauración
npm run typecheck
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
