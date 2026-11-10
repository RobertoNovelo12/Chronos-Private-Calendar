# Seguridad y privacidad

## Qué protege Chronos

| Amenaza | Protección | Estado |
|---|---|---|
| Robo del disco o del portátil apagado/bloqueado | Base de datos cifrada con SQLCipher (AES-256 + HMAC por página); clave derivada de la contraseña | ✅ Implementado |
| Copia de los archivos de datos por otra persona o programa | Sin la contraseña, `chronos.db`, `-wal` y `keystore.json` no revelan contenido | ✅ |
| Filtración de copias de seguridad (USB, nube del usuario) | Cada `.chronosbak` va cifrado y autenticado con XChaCha20-Poly1305 | ✅ |
| Manipulación de una copia | Etiqueta Poly1305 sobre contenido + cabecera; SHA-256 del archivo | ✅ |
| Envío de datos a terceros | Sin código de red; CSP del WebView bloquea conexiones; sin telemetría | ✅ |
| Alguien frente al equipo con la app abierta | Bloqueo manual (botón / Ctrl+L) y por inactividad | ✅ |
| Fuerza bruta de la contraseña | Argon2id (64 MiB, t=3) + retardo creciente tras 3 fallos | ✅ |

## Qué NO protege (limitaciones honestas)

* **Malware con privilegios en el equipo mientras la app está desbloqueada.** Puede leer la memoria del proceso, capturar el teclado o la pantalla. Ninguna aplicación de escritorio puede impedirlo.
* **Memoria no siempre borrada.** Las claves (`SecretKey`) y las contraseñas recibidas por los comandos se borran con `zeroize`. Pero las cadenas de texto que viajan por el WebView (JavaScript no permite borrar memoria), las páginas en caché de SQLite mientras está abierta y la instantánea JSON intermedia al crear copias pueden permanecer en memoria hasta que el sistema la reutilice. El sistema operativo podría escribirlas en el archivo de paginación/hibernación.
* **«Recordar el desbloqueo en este equipo» (opcional, 1.3).** Si se activa, la protección de los datos al arrancar pasa a ser la de **tu cuenta del sistema**, no la contraseña de Chronos. Ver «Desbloqueo recordado y bandeja» abajo.
* **Contraseña olvidada = datos irrecuperables.** No hay servidor ni "puerta trasera". La única vía es una copia de seguridad cuya contraseña se recuerde.
* **Metadatos del sistema de archivos.** Tamaño y fechas de modificación de los archivos son visibles.
* **Contraseña débil.** Argon2id encarece cada intento, pero no compensa una contraseña trivial. Se exige un mínimo de 8 caracteres; se recomienda una frase larga.

## Esquema criptográfico

Todo con bibliotecas auditadas de **RustCrypto** y **SQLCipher**. No hay algoritmos ni protocolos propios.

```
contraseña ──Argon2id(sal 16 B, m=64 MiB, t=3, p=1)──▶ clave maestra (32 B)
clave maestra ──HKDF-SHA256 info="chronos/v1/key-wrap"──▶ KEK
clave maestra ──HKDF-SHA256 info="chronos/v1/backup"────▶ clave de copias

DEK = 32 B aleatorios (CSPRNG del SO), generada UNA vez
wrapped_key = XChaCha20-Poly1305(KEK, nonce 24 B aleatorio,
                                 AAD = "chronos-keystore/v1|" + parámetros KDF, DEK)
SQLCipher: PRAGMA key = "x'<DEK en hex>'"   (clave en bruto: sin PBKDF2 adicional)
```

* **Por qué una DEK envuelta:** cambiar la contraseña solo reescribe `keystore.json` (no se recifra la base de datos) y la DEK nunca depende directamente de la contraseña.
* **Por qué HKDF:** una única ejecución de Argon2id (la parte costosa) produce claves independientes para cada propósito.
* **Parámetros KDF autenticados:** forman parte del AAD; si alguien los altera en `keystore.json`, el desenvolvimiento falla.
* **Parámetros acotados al leer:** memoria 8 MiB–2 GiB, t 1–20, p 1–16, para que un archivo manipulado no agote los recursos del equipo.
* **Nonces:** 192 bits aleatorios por cifrado; la probabilidad de colisión es despreciable.
* **Comprobación de SQLCipher:** al abrir se ejecuta `PRAGMA cipher_version`. Si la biblioteca enlazada no fuese SQLCipher, la app **se niega** a abrir la base de datos en lugar de crearla sin cifrar.

## Configuración de SQLite

| PRAGMA | Valor | Motivo |
|---|---|---|
| `foreign_keys` | ON | Integridad referencial |
| `journal_mode` | WAL | Escrituras atómicas; el WAL también está cifrado |
| `temp_store` | MEMORY | Las tablas temporales nunca se escriben en claro al disco |
| `secure_delete` | ON | Las páginas liberadas se sobrescriben |
| `synchronous` | NORMAL | Equilibrio durabilidad/rendimiento con WAL |

## Copias de seguridad

* Cifradas **siempre**; no existe opción para crearlas sin cifrar.
* Por defecto usan la contraseña de la aplicación (vía la clave de copias derivada al desbloquear), lo que permite copias automáticas sin volver a pedirla.
* Opción de proteger una copia manual con otra contraseña (`BackupKey::from_password`, nueva sal).
* Una copia queda ligada a la contraseña vigente **cuando se creó**. Tras cambiar la contraseña, las copias anteriores siguen necesitando la antigua (la pantalla de cambio de contraseña lo advierte).
* Formato y procedimiento de restauración: [BACKUP_FORMAT.md](BACKUP_FORMAT.md).

## Privacidad: garantías de funcionamiento

* **Sin red en el núcleo:** `chronos-core` (datos, cifrado, copias) no depende de ningún cliente HTTP ni de Tauri. Verificable con `cargo tree -p chronos-core | grep -Ei "reqwest|hyper|ureq|surf"` (sin resultados).
* **Única conexión de red: actualizaciones (desde 1.2)**, en `src-tauri/src/commands/update.rs` con `tauri-plugin-updater`:
  * Solo cuando el usuario pulsa **Buscar actualizaciones**, o una vez al día si activa la casilla correspondiente (**desactivada por defecto**).
  * Solo consulta `https://github.com/RobertoNovelo12/Chronos-Private-Calendar/releases/latest/download/latest.json` (fijo en `tauri.conf.json`) y solo descarga desde `…/releases/download/` del mismo repositorio; cualquier otra dirección se rechaza.
  * Es una petición anónima: no se envía ningún dato del calendario, identificador ni estadística. GitHub ve la dirección IP y la versión del sistema (como en cualquier descarga).
  * El paquete se verifica con **minisign** contra la clave pública incluida en la app (ID `EC17C81746F15627`) **antes** de instalarlo; si la firma no coincide, se descarta. La clave privada no está en el repositorio: solo en el equipo del autor y como secreto cifrado de GitHub Actions.
  * Antes de instalar se crea una copia cifrada `pre_update` (si la app está desbloqueada); sin copia no se instala.
  * El frontend no tiene permisos `updater:*`: solo puede llamar a `update_check` y `update_install`, que no aceptan direcciones ni parámetros.
  * `privacy.test.ts` falla si cambia la dirección, la clave pública, los permisos, el valor por defecto de la comprobación automática o si otro código usa el actualizador.
* **CSP de producción** (`tauri.conf.json`): `default-src 'self'`, `connect-src ipc: http://ipc.localhost` (solo el puente interno de Tauri), sin `frame-src`, `object-src`, ni formularios hacia fuera.
* **Sin recursos remotos:** fuentes e iconos van dentro del binario.
* **Capacidades mínimas de Tauri:** `core:default` y `notification:default` (notificaciones locales); el frontend no tiene acceso a shell, sistema de archivos, HTTP, apertura de enlaces ni actualizador.
* **Selector de archivos solo desde Rust:** `tauri-plugin-dialog` se usa en los comandos de Rust; el frontend no recibe el permiso `dialog:*` ni puede elegir rutas de escritura: solo decide formato y qué exportar. Las rutas de lectura que vuelven del selector se validan otra vez (extensión, tamaño máx. 20 MB, máx. 50 000 eventos).
* **Sin telemetría, analítica, informes de errores remotos ni publicidad.**
* **Única acción que abre un sitio externo: «Donar con PayPal»** (Configuración → Acerca de). La inicia siempre el usuario con un clic; Rust abre en el navegador del sistema la URL fija `https://paypal.me/robertonovelo` mediante `tauri-plugin-opener`. El frontend no tiene permisos `opener:*`, por lo que no puede abrir otras direcciones, y Chronos no envía ningún dato: es el navegador el que carga la página. Las pruebas (`privacy.test.ts`) fallan si cambia la URL, si se concede `opener` al frontend o si otro código abre enlaces.
* **Prueba realizada (Fase 2):** con la aplicación en ejecución en Linux, `ss -tunp` no mostró ninguna conexión TCP/UDP del proceso; solo sockets Unix locales entre los procesos de WebKit. (Desde 1.2 sigue siendo así mientras no se busquen actualizaciones.)
* **Logs:** solo locales (salida estándar; nivel con `CHRONOS_LOG`). Registran códigos de error, identificadores y recuentos, nunca títulos, descripciones, ubicaciones, contraseñas ni claves.

### WebView en Windows

Tauri usa Microsoft Edge WebView2. El *runtime* de WebView2 lo actualiza Windows/Edge, no Chronos. Chronos no carga contenido remoto y la CSP lo impide; aun así, el comportamiento de servicios del propio WebView2 depende de Microsoft. Si se desea máximo aislamiento, puede bloquearse la aplicación en el cortafuegos de Windows sin pérdida de funcionalidad.

## Desbloqueo recordado y bandeja (1.3)

* **Bandeja del sistema.** Con «mantener en la bandeja», cerrar la ventana solo la oculta: la app **sigue desbloqueada** (como si estuviera minimizada) y los recordatorios siguen funcionando. «Salir» en el icono de la bandeja termina el proceso y borra las claves de la memoria; «Bloquear» bloquea sin salir. El bloqueo automático por inactividad sigue funcionando aunque la ventana esté oculta.
* **Una sola instancia** (`tauri-plugin-single-instance`): abrir Chronos de nuevo muestra la ventana existente; nunca hay dos procesos con la misma base de datos.
* **Iniciar con el sistema** (`tauri-plugin-autostart`, desactivado por defecto): en Windows, entrada en `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` con el argumento `--minimized`; en macOS, un *LaunchAgent*. Los ajustes de ventana se guardan sin cifrar en `desktop.json` (no contienen datos del calendario).
* **Desbloqueo recordado** (desactivado por defecto; Windows y macOS):
  * Activarlo exige la app desbloqueada **y** confirmar la contraseña.
  * Se guarda en el almacén de credenciales del sistema (Windows: Administrador de credenciales, cifrado con DPAPI y ligado a la cuenta de Windows; macOS: Llavero) un secreto de 65 bytes: versión, DEK y clave de copias. Nunca se guarda la contraseña.
  * Solo se usa **al arrancar** la aplicación. Bloquear a mano, desde la bandeja o por inactividad sigue pidiendo la contraseña.
  * **Límite:** cualquier programa que se ejecute con la misma cuenta de usuario podría leer esa credencial, y alguien que inicie sesión con tu cuenta abriría Chronos sin contraseña. Recomendado solo en equipos de uso personal con contraseña de sesión.
  * Si la credencial no corresponde a los datos (otra instalación, datos borrados), se descarta. Cambiar la contraseña la actualiza; desactivar la opción o «Eliminar todos mis datos» la borra. Las copias de seguridad siguen cifradas con la clave derivada de la contraseña.
  * Solo `remember.rs` accede al almacén de credenciales, y solo `remember_unlock_enable` escribe en él (`privacy.test.ts` lo comprueba).

## Recordatorios y notificaciones

* Los avisos los genera la propia aplicación cada 15 s y los muestra el sistema operativo; no hay servicios de notificaciones remotos ni conexión de red.
* **Con la aplicación desbloqueada** la notificación muestra título, hora y lugar, salvo que en Configuración se elija «Ocultar detalles».
* **Con la aplicación bloqueada** Chronos solo conserva en memoria las horas de los avisos de las próximas 24 h (sin títulos ni ubicaciones) y muestra un texto genérico («Tienes un evento en 10 min»).
* **Limitación:** el centro de notificaciones del sistema (Windows, macOS, Linux) puede guardar el historial de notificaciones fuera de la base cifrada. Si eso es un problema, elige «Ocultar detalles».
* Las tareas usan el mismo mecanismo: con la app bloqueada el aviso dice solo «Tienes una tarea en 10 min».
* Con la aplicación cerrada no hay avisos: no se instala ningún servicio en segundo plano.

## Exportaciones e importaciones

* **ICS, JSON y CSV no van cifrados**: son formatos para otras aplicaciones o para leerlos. La interfaz lo indica. La única exportación cifrada es la copia `.chronosbak`.
* **Participantes:** se guardan cifrados como el resto del evento y nunca se contacta con ellos. Al exportar a ICS o JSON sus nombres y correos quedan en el archivo sin cifrar; al importar ese ICS en otra aplicación, esa aplicación podría ofrecer enviar invitaciones.
* **CSV:** los valores que empiezan por `=`, `+`, `-`, `@`, tabulador o retorno de carro se prefijan con `'` para que una hoja de cálculo no los ejecute como fórmulas.
* **Importación:** se validan todos los datos con las mismas reglas que la interfaz (longitudes, enlaces solo `https`/`http`/`mailto`, zonas horarias, reglas de repetición acotadas). Lo que no cumple se descarta y se informa del recuento; la importación completa es atómica (todo o nada ante un error inesperado).
* **Copiar y pegar eventos** usa memoria interna de la aplicación, no el portapapeles del sistema, y se borra al bloquear.

## Eliminación permanente («Eliminar todos mis datos»)

Exige escribir `ELIMINAR` y la contraseña. Orden: se verifica la contraseña, se cierra la base de datos, se borra **primero `keystore.json`** y luego `chronos.db`, `-wal` y `-shm`; opcionalmente, los archivos de copia registrados en el historial y los de la carpeta predeterminada. También se borran las preferencias de la interfaz guardadas en el WebView.

* Sin `keystore.json` la DEK no puede recuperarse, así que restos de `chronos.db` en el disco quedan ilegibles (borrado criptográfico). **Límite honesto:** en SSD y sistemas de archivos con *journaling* no puede garantizarse la sobrescritura física de bloques; alguien con acceso al disco **y** a la contraseña podría, en teoría, recuperar bloques antiguos de `keystore.json`.
* Si no se marcan las copias, siguen en disco y se pueden restaurar después con la contraseña con la que se crearon.
* Las carpetas de caché propias de WebKit/WebView2 (que no contienen datos del calendario) no se eliminan.

## Distribución (versión 1.0)

* **Instaladores sin firma.** Windows SmartScreen y macOS Gatekeeper muestran un aviso la primera vez. Comprueba que descargas el instalador desde la página *Releases* del repositorio oficial.
* **WebView2 en Windows.** El instalador incluye el *bootstrapper* de Microsoft: solo si el equipo no tiene WebView2 (Windows 10/11 ya lo traen) lo descarga de Microsoft **durante la instalación**. La aplicación instalada solo se conecta a internet para buscar actualizaciones cuando el usuario lo pide.
* **Revisión de dependencias** (noviembre de 2026): `npm audit` y `cargo audit` sin vulnerabilidades. `cargo audit` señala 5 avisos de mantenimiento (`proc-macro-error`, `zbus_names`, `zvariant`, `zvariant_derive`, `glib`), todos en dependencias de Tauri exclusivas de Linux (GTK/D-Bus), sin uso en la versión de Windows.
* **Prueba sin red** (Fase 7): la aplicación instalada se ejecutó en un espacio de red aislado (solo `lo`, apagada) y funcionaron desbloqueo, creación de eventos, copias automáticas y manuales, y restauración.
