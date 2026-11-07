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

## Fase 3 — Interfaz 🔜
* Barra lateral completa: mini calendario mensual, buscador
* Vistas Día, 3 días, Semana, Mes, Agenda (virtualizada); botón Hoy; navegación ← →; atajos (T, D, W, M, A, J/K)
* Indicador de hora actual; horario laboral configurable; zona horaria del usuario
* Panel lateral de detalles del evento; modales; menús contextuales; tooltips
* Creación por clic y por arrastre; mover y redimensionar (drag and drop); disposición de eventos simultáneos

## Fase 4 — Backend de eventos ⬜
* Repositorio de eventos (CRUD, duplicar, mover de calendario, color, enlaces, etiquetas, asistentes, recordatorios)
* Consultas por rango; motor de recurrencias RFC 5545 (crate `rrule` + `chrono-tz`) con excepciones y "esta / todas / esta y siguientes"
* Detección de conflictos; pila de deshacer/rehacer en el backend
* Tareas y etiquetas

## Fase 5 — Privacidad ⬜
* Bloqueo automático por inactividad (configurable)
* Copias automáticas (Tokio), carpeta elegible, retención, copia antes de actualizar
* Pantalla de copias: historial, verificar, restaurar (con selector de archivo nativo `tauri-plugin-dialog`)
* Importar ICS/JSON/copias; exportar ICS/JSON/CSV por calendario, selección o rango
* Recordatorios locales (`tauri-plugin-notification`, permisos del SO)
* Cambio de contraseña en la interfaz; "Eliminar todos mis datos"

## Fase 6 — Calidad ⬜
Pruebas de recurrencias/zonas horarias/día completo, pruebas de frontend, rendimiento con decenas de miles de eventos, revisión de seguridad, documentación de usuario.

## Fase 7 — Entrega ⬜
Instaladores para Windows (MSI/NSIS), Linux (AppImage/deb) y macOS (dmg); lista de verificación final (compila, se ejecuta, guarda, offline, copia, restaura, sin servicios externos).
