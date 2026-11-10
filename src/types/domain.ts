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

export type Visibility = "default" | "public" | "private" | "confidential";
export type Availability = "busy" | "free" | "tentative" | "out_of_office";
export type EventStatus = "confirmed" | "tentative" | "cancelled";

export interface EventLink {
  label: string;
  url: string;
}

export interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  description: string;
  location: string;
  links: EventLink[];
  /** null = color del calendario */
  color: string | null;
  /** Milisegundos UTC. Día completo: medianoche UTC de la fecha. */
  startAt: number;
  /** Exclusivo */
  endAt: number;
  timezone: string;
  isAllDay: boolean;
  visibility: Visibility;
  availability: Availability;
  status: EventStatus;
  /** Ocurrencia o excepción de una serie. */
  isRecurring: boolean;
  /** Serie a la que pertenece. */
  recurrenceMasterId: string | null;
  /** Inicio original de la ocurrencia dentro de la serie. */
  originalStartAt: number | null;
  /** RRULE de la serie (RFC 5545, sin prefijo). */
  recurrence: string | null;
  /** Recordatorios: minutos antes del inicio. */
  reminders: number[];
  createdAt: number;
  updatedAt: number;
}

/** Alcance de un cambio en un evento repetido. */
export type EditScope = "this" | "following" | "all";

export interface NewEvent {
  calendarId: string;
  title?: string;
  description?: string;
  location?: string;
  links?: EventLink[];
  color?: string | null;
  startAt: number;
  endAt: number;
  timezone: string;
  isAllDay?: boolean;
  visibility?: Visibility;
  availability?: Availability;
  recurrence?: string | null;
  reminders?: number[];
}

/** `color: ""` elimina el color propio. */
export interface EventPatch {
  calendarId?: string;
  title?: string;
  description?: string;
  location?: string;
  links?: EventLink[];
  color?: string;
  startAt?: number;
  endAt?: number;
  timezone?: string;
  isAllDay?: boolean;
  visibility?: Visibility;
  availability?: Availability;
  status?: EventStatus;
  /** `""` quita la repetición. */
  recurrence?: string;
  reminders?: number[];
}

// --- Importación / exportación (fase 5) ---

export type ExportKind = "ics" | "json" | "csv";

export interface ExportOptions {
  calendarIds?: string[] | null;
  from?: number | null;
  to?: number | null;
  eventIds?: string[] | null;
}

export interface ExportReport {
  events: number;
  path: string;
}

export interface ImportPreview {
  path: string;
  fileName: string;
  format: "ics" | "json" | "csv" | "backup";
  events: number;
  calendars: string[];
  rulesDropped: number;
}

export type ImportTarget = { kind: "existing"; calendarId: string } | { kind: "new"; name: string | null };

export interface ImportReport {
  imported: number;
  duplicates: number;
  skipped: number;
  rulesDropped: number;
  calendarsCreated: number;
}

export interface BackupSettings {
  auto: "off" | "daily" | "weekly";
  keep: number;
  dir: string;
  isDefaultDir: boolean;
}

export interface DestroyReport {
  backupsRemoved: number;
  backupsNotRemoved: number;
}

export interface AboutInfo {
  version: string;
  license: string;
  repository: string;
  donationUrl: string;
}
