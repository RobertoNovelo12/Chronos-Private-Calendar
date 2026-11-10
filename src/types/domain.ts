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

export type AttendeeRole = "organizer" | "required" | "optional";
export type AttendeeStatus = "needs_action" | "accepted" | "declined" | "tentative";

/** Participante: nota local. Chronos no envía invitaciones. */
export interface Attendee {
  name: string;
  email: string;
  role: AttendeeRole;
  status: AttendeeStatus;
}

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
  /** Ids de etiquetas (las ocurrencias heredan las de la serie). */
  labels: string[];
  attendees: Attendee[];
  createdAt: number;
  updatedAt: number;
}

/** Estado completo de una serie (o evento simple) para deshacer/rehacer. */
export interface SeriesSnapshot {
  root: CalendarEvent;
  icalUid: string | null;
  overrides: CalendarEvent[];
  exceptions: { originalStartAt: number; overrideEventId: string | null }[];
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
  labels?: string[];
  attendees?: Attendee[];
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
  /** Sustituye la lista completa. */
  labels?: string[];
  /** Sustituye la lista completa. */
  attendees?: Attendee[];
}

export interface Task {
  id: string;
  /** null = sin calendario */
  calendarId: string | null;
  title: string;
  notes: string;
  /** ms UTC; en día completo, medianoche UTC de la fecha. null = sin fecha */
  dueAt: number | null;
  isAllDay: boolean;
  /** 0 ninguna · 1 baja · 2 media · 3 alta */
  priority: 0 | 1 | 2 | 3;
  completedAt: number | null;
  sortOrder: number;
  reminders: number[];
  createdAt: number;
  updatedAt: number;
}

export interface NewTask {
  title: string;
  calendarId?: string | null;
  notes?: string;
  dueAt?: number | null;
  isAllDay?: boolean;
  priority?: number;
  reminders?: number[];
}

/** `dueAt: null` quita la fecha; `calendarId: null` quita el calendario. */
export interface TaskPatch {
  calendarId?: string | null;
  title?: string;
  notes?: string;
  dueAt?: number | null;
  isAllDay?: boolean;
  priority?: number;
  reminders?: number[];
  completed?: boolean;
}

export interface Label {
  id: string;
  name: string;
  color: string;
  createdAt: number;
  updatedAt: number;
}

export interface NewLabel {
  name: string;
  color: string;
}

export interface LabelPatch {
  name?: string;
  color?: string;
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
  tasks: number;
  path: string;
}

export interface ImportPreview {
  path: string;
  fileName: string;
  format: "ics" | "json" | "csv" | "backup";
  events: number;
  tasks: number;
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
  labelsCreated: number;
  tasksImported: number;
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

// --- Actualizaciones (1.2) ---

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  /** Fecha de publicación (ms UTC), si el servidor la indica. */
  date: number | null;
  notes: string | null;
  /** Falso si esta instalación no puede actualizarse sola (p. ej. un .deb). */
  canInstall: boolean;
}

// --- Escritorio (1.3) ---

export interface DesktopInfo {
  closeToTray: boolean;
  startMinimized: boolean;
  autostart: boolean;
  rememberSupported: boolean;
  rememberEnabled: boolean;
}

export interface DesktopPatch {
  closeToTray?: boolean;
  startMinimized?: boolean;
  autostart?: boolean;
}
