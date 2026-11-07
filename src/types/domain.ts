// Tipos espejo de las estructuras serializadas por Rust (camelCase).

export interface VaultStatus {
  initialized: boolean;
  unlocked: boolean;
}

export interface Calendar {
  id: string;
  name: string;
  color: string;
  description: string;
  isVisible: boolean;
  isDefault: boolean;
  sortOrder: number;
  /** Milisegundos UTC */
  createdAt: number;
  updatedAt: number;
}

export interface NewCalendar {
  name: string;
  color: string;
  description?: string;
}

export interface CalendarPatch {
  name?: string;
  color?: string;
  description?: string;
  isVisible?: boolean;
}

export type BackupKind = "manual" | "automatic" | "pre_restore" | "pre_update";

export interface BackupRecord {
  id: string;
  fileName: string;
  filePath: string;
  kind: BackupKind;
  status: "ok" | "failed";
  formatVersion: number;
  schemaVersion: number;
  sizeBytes: number;
  sha256: string;
  errorCode: string | null;
  createdAt: number;
}

export interface BackupInfo {
  fileName: string;
  filePath: string;
  createdAt: string;
  appVersion: string;
  formatVersion: number;
  schemaVersion: number;
  sizeBytes: number;
  sha256: string;
}

export interface RestoreReport {
  source: BackupInfo;
  preRestoreBackup: BackupRecord;
  restoredRows: number;
}

/** Error que devuelven los comandos de Rust. */
export interface CommandError {
  code: string;
  message: string;
}
