// Capa tipada sobre los comandos de Tauri. Es el ÚNICO punto por el que el
// frontend habla con Rust; nunca accede a la base de datos ni al disco.

import { invoke } from "@tauri-apps/api/core";
import type {
  AboutInfo,
  Label,
  LabelPatch,
  NewLabel,
  NewTask,
  SeriesSnapshot,
  Task,
  TaskPatch,
  BackupInfo,
  BackupRecord,
  BackupSettings,
  Calendar,
  DestroyReport,
  ExportKind,
  ExportOptions,
  ExportReport,
  ImportPreview,
  ImportReport,
  ImportTarget,
  CalendarEvent,
  CalendarPatch,
  EventPatch,
  NewEvent,
  CommandError,
  EditScope,
  NewCalendar,
  RestoreReport,
  VaultStatus,
} from "@/types/domain";
import { getLanguage, intlLocale, msg, t } from "@/i18n";
import "@/i18n/backend";

export class IpcError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "IpcError";
  }
}

function isCommandError(e: unknown): e is CommandError {
  return typeof e === "object" && e !== null && "code" in e && "message" in e;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    if (isCommandError(e)) throw new IpcError(e.code, e.message);
    throw new IpcError("internal", typeof e === "string" ? e : t("Error inesperado de la aplicación"));
  }
}

export const api = {
  vault: {
    status: () => call<VaultStatus>("vault_status"),
    setup: (password: string) => call<VaultStatus>("vault_setup", { password }),
    unlock: (password: string) => call<VaultStatus>("vault_unlock", { password }),
    lock: () => call<VaultStatus>("vault_lock"),
    changePassword: (current: string, newPassword: string) =>
      call<void>("vault_change_password", { current, newPassword }),
  },
  calendars: {
    list: () => call<Calendar[]>("calendars_list"),
    create: (input: NewCalendar) => call<Calendar>("calendars_create", { input }),
    update: (id: string, patch: CalendarPatch) => call<Calendar>("calendars_update", { id, patch }),
    remove: (id: string) => call<void>("calendars_delete", { id }),
    setDefault: (id: string) => call<Calendar>("calendars_set_default", { id }),
    reorder: (ids: string[]) => call<Calendar[]>("calendars_reorder", { ids }),
  },
  events: {
    listRange: (from: number, to: number) => call<CalendarEvent[]>("events_list_range", { from, to }),
    create: (input: NewEvent) => call<CalendarEvent>("events_create", { input }),
    update: (id: string, patch: EventPatch, scope?: EditScope) =>
      call<CalendarEvent>("events_update", { id, patch, scope: scope ?? null }),
    remove: (id: string, scope?: EditScope) => call<CalendarEvent>("events_delete", { id, scope: scope ?? null }),
    restore: (event: CalendarEvent) => call<CalendarEvent>("events_restore", { event }),
    duplicate: (id: string) => call<CalendarEvent>("events_duplicate", { id }),
    search: (query: string) => call<CalendarEvent[]>("events_search", { query }),
    snapshot: (id: string) => call<SeriesSnapshot>("events_snapshot", { id }),
    snapshots: (ids: string[]) => call<SeriesSnapshot[]>("events_snapshots", { ids }),
    replaceSeries: (removeIds: string[], snapshots: SeriesSnapshot[]) =>
      call<void>("events_replace_series", { removeIds, snapshots }),
  },
  labels: {
    list: () => call<Label[]>("labels_list"),
    create: (input: NewLabel) => call<Label>("labels_create", { input }),
    update: (id: string, patch: LabelPatch) => call<Label>("labels_update", { id, patch }),
    remove: (id: string) => call<void>("labels_delete", { id }),
  },
  tasks: {
    list: () => call<Task[]>("tasks_list"),
    create: (input: NewTask) => call<Task>("tasks_create", { input }),
    update: (id: string, patch: TaskPatch) => call<Task>("tasks_update", { id, patch }),
    remove: (id: string) => call<Task>("tasks_delete", { id }),
    restore: (task: Task) => call<Task>("tasks_restore", { task }),
    removeCompleted: () => call<number>("tasks_delete_completed"),
  },
  settings: {
    get: <T>(key: string) => call<T | null>("settings_get", { key }),
    set: (key: string, value: unknown) => call<void>("settings_set", { key, value }),
  },
  backup: {
    create: () => call<BackupRecord>("backup_create"),
    history: () => call<BackupRecord[]>("backup_history"),
    inspect: (path: string) => call<BackupInfo>("backup_inspect", { path }),
    verify: (path: string, password: string) => call<BackupInfo>("backup_verify", { path, password }),
    restore: (path: string, password: string, confirmOverwrite: boolean) =>
      call<RestoreReport>("backup_restore", { path, password, confirmOverwrite }),
    /** Copia manual. `pickDir` pregunta la carpeta; `password` usa otra contraseña. */
    createIn: (pickDir: boolean, password?: string) =>
      call<BackupRecord | null>("backup_create_in", { pickDir, password: password ?? null }),
    settings: () => call<BackupSettings>("backup_settings_get"),
    setSettings: (s: { auto?: BackupSettings["auto"]; keep?: number }) =>
      call<BackupSettings>("backup_settings_set", { auto: s.auto ?? null, keep: s.keep ?? null }),
    chooseDir: (reset: boolean) => call<BackupSettings>("backup_choose_dir", { reset }),
    pickFile: () => call<string | null>("backup_pick_file"),
  },
  data: {
    /** Abre el diálogo de guardar; `null` si se cancela. */
    export: (kind: ExportKind, options: ExportOptions, suggestedName: string) =>
      call<ExportReport | null>("export_data", { kind, options, suggestedName }),
    pickImport: (defaultTz: string) => call<ImportPreview | null>("import_pick", { defaultTz }),
    applyImport: (path: string, target: ImportTarget, defaultTz: string) =>
      call<ImportReport>("import_apply", { path, target, defaultTz }),
    destroy: (password: string, confirmation: string, removeBackups: boolean) =>
      call<DestroyReport>("vault_destroy", { password, confirmation, removeBackups }),
  },
  about: {
    info: () => call<AboutInfo>("app_about"),
    /** Idioma de las notificaciones y diálogos que genera el backend. */
    setLanguage: (lang: string) => call<boolean>("app_set_language", { lang }),
    /** Abre la página de donaciones (URL fija en Rust) en el navegador. */
    openDonation: () => call<void>("open_donation_link"),
  },
};

/** Mensaje por código de error (cuando el texto del backend no está traducido). */
const CODE_MESSAGES: Record<string, string> = {
  not_initialized: msg("La bóveda todavía no se ha configurado"),
  already_initialized: msg("La bóveda ya está configurada"),
  locked: msg("La aplicación está bloqueada"),
  invalid_password: msg("Contraseña incorrecta"),
  weak_password: msg("La contraseña no cumple los requisitos"),
  validation: msg("Algún dato no es válido"),
  not_found: msg("No se encontró el elemento"),
  corrupt_backup: msg("El archivo de copia está dañado o no es válido"),
  backup_authentication: msg("Contraseña incorrecta o archivo de copia manipulado"),
  unsupported_version: msg("Versión no compatible"),
  keystore: msg("Almacén de claves no válido"),
  confirmation_required: msg("Se requiere confirmación explícita para sobrescribir los datos"),
  crypto: msg("Fallo criptográfico"),
  database: msg("Error de base de datos"),
  io: msg("Error al leer o escribir un archivo"),
  serialization: msg("Error de serialización"),
  internal: msg("Error interno de la aplicación"),
  open_failed: msg("No se pudo abrir el navegador"),
};

/** Prefijos con los que Rust envuelve el detalle («datos no válidos: …»). */
const DETAIL_PREFIX = /^(datos no válidos|la contraseña no cumple los requisitos): /;

const cap = (text: string) => text.charAt(0).toLocaleUpperCase(intlLocale()) + text.slice(1);

/**
 * Texto para mostrar un error. En español se usa el mensaje del backend; en
 * otros idiomas, su traducción si existe (detalles de validación incluidos) o
 * un mensaje genérico según el código.
 */
export function errorMessage(e: unknown): string {
  if (!(e instanceof Error)) return t("Error inesperado");
  if (getLanguage() === "es" || !(e instanceof IpcError)) return cap(e.message);
  const detail = e.message.replace(DETAIL_PREFIX, "");
  const translated = t(detail);
  if (translated !== detail) return cap(translated);
  const generic = CODE_MESSAGES[e.code];
  return generic ? t(generic) : cap(e.message);
}
