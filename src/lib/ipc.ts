// Capa tipada sobre los comandos de Tauri. Es el ÚNICO punto por el que el
// frontend habla con Rust; nunca accede a la base de datos ni al disco.

import { invoke } from "@tauri-apps/api/core";
import type {
  BackupInfo,
  BackupRecord,
  Calendar,
  CalendarPatch,
  CommandError,
  NewCalendar,
  RestoreReport,
  VaultStatus,
} from "@/types/domain";

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
    throw new IpcError("internal", typeof e === "string" ? e : "Error inesperado de la aplicación");
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
  backup: {
    create: () => call<BackupRecord>("backup_create"),
    history: () => call<BackupRecord[]>("backup_history"),
    inspect: (path: string) => call<BackupInfo>("backup_inspect", { path }),
    verify: (path: string, password: string) => call<BackupInfo>("backup_verify", { path, password }),
    restore: (path: string, password: string, confirmOverwrite: boolean) =>
      call<RestoreReport>("backup_restore", { path, password, confirmOverwrite }),
  },
};

export function errorMessage(e: unknown): string {
  const text = e instanceof Error ? e.message : "Error inesperado";
  return text.charAt(0).toLocaleUpperCase("es") + text.slice(1);
}
