import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  CalendarDays,
  CalendarPlus,
  CalendarRange,
  Columns3,
  Database,
  HardDriveDownload,
  Info,
  Keyboard,
  Languages,
  LayoutGrid,
  List,
  ListTodo,
  Lock,
  Monitor,
  Moon,
  PanelLeft,
  PanelRight,
  Search,
  Settings,
  ShieldCheck,
  Square,
  SquarePen,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { createEventNow, createQuickEvent } from "@/features/events/actions";
import { createTask } from "@/features/tasks/actions";
import { useCalendarMap } from "@/hooks/useCalendarData";
import { rankCommands } from "@/lib/commands";
import { eventStart, formatEventTime, formatLongDate, formatMediumDate, formatTime, localeDayFirst } from "@/lib/dates";
import { api, errorMessage } from "@/lib/ipc";
import { eventColor } from "@/lib/layout";
import { parseDate, parseQuickEvent, type QuickEvent } from "@/lib/nlp";
import { describeRule } from "@/lib/rrule";
import { cn, formatBytes } from "@/lib/utils";
import { usePrefsStore } from "@/stores/prefsStore";
import { useThemeStore } from "@/stores/themeStore";
import { toast } from "@/stores/toastStore";
import { useUiStore, type CommandMode, type SettingsTab } from "@/stores/uiStore";
import type { CalendarEvent } from "@/types/domain";
import { getLanguage, LANGUAGES, msg, setLanguage, t, tp } from "@/i18n";

interface Row {
  id: string;
  group: string;
  icon: LucideIcon;
  label: ReactNode;
  detail?: string;
  hint?: string[];
  color?: string;
  run: () => void | Promise<unknown>;
}

interface Action {
  id: string;
  /** Clave en español: se traduce al mostrar y también sirve para buscar. */
  key: string;
  icon: LucideIcon;
  hint?: string[];
  /** Visible con la caja vacía. */
  core?: boolean;
  /** Texto visible ya resuelto (si no, `t(key)`). */
  label?: string;
  keywords?: string[];
  run: () => void | Promise<unknown>;
}

const GROUP = {
  create: msg("Crear"),
  goto: msg("Ir a"),
  actions: msg("Acciones"),
  events: msg("Eventos"),
};

/** Resumen de lo entendido: «mañana · 17:00–18:00 · Cada semana el lunes». */
export function describeQuick(q: QuickEvent): string {
  const parts: string[] = [];
  const lastDay = new Date(q.end.getTime() - 1);
  if (q.allDay) {
    parts.push(
      lastDay.toDateString() === q.start.toDateString()
        ? t("{date} · todo el día", { date: formatLongDate(q.start) })
        : `${formatMediumDate(q.start)} – ${formatMediumDate(lastDay)}`,
    );
  } else {
    parts.push(formatLongDate(q.start), `${formatTime(q.start)} – ${formatTime(q.end)}`);
  }
  if (q.recurrence) parts.push(describeRule(q.recurrence, q.start, q.allDay));
  return parts.join(" · ");
}

function useActions(onLock: () => void, close: () => void): Action[] {
  const ui = useUiStore.getState;
  const prefs = usePrefsStore.getState;
  const settings = (tab: SettingsTab) => () => ui().openSettings(tab);
  return useMemo<Action[]>(
    () => [
      { id: "new-event", key: msg("Nuevo evento"), icon: SquarePen, hint: ["C"], core: true, run: () => createEventNow() },
      { id: "new-task", key: msg("Nueva tarea"), icon: ListTodo, hint: ["Shift", "C"], core: true, run: () => createTask() },
      { id: "today", key: msg("Ir a hoy"), icon: CalendarDays, hint: ["T"], core: true, run: () => ui().today() },
      { id: "goto", key: msg("Ir a la fecha…"), icon: ArrowRight, hint: ["."], core: true, run: () => ui().setGoToOpen(true) },
      { id: "view-day", key: msg("Vista: Día"), icon: Square, hint: ["D"], core: true, run: () => ui().setView("day") },
      { id: "view-week", key: msg("Vista: Semana"), icon: Columns3, hint: ["W"], core: true, run: () => ui().setView("week") },
      { id: "view-month", key: msg("Vista: Mes"), icon: LayoutGrid, hint: ["M"], core: true, run: () => ui().setView("month") },
      { id: "view-agenda", key: msg("Vista: Agenda"), icon: List, hint: ["A"], core: true, run: () => ui().setView("agenda") },
      ...[2, 3, 4, 5, 6, 7].map((n) => ({
        id: `view-days-${n}`,
        key: msg("Vista: {n} días"),
        label: t("Vista: {n} días", { n }),
        icon: CalendarRange,
        hint: [String(n)],
        run: () => {
          prefs().set({ customDays: n });
          ui().setView("days");
        },
      })),
      { id: "backup", key: msg("Crear copia de seguridad ahora"), icon: HardDriveDownload, core: true, run: backupNow },
      {
        id: "sidebar",
        key: msg("Mostrar/ocultar barra lateral"),
        icon: PanelLeft,
        hint: ["`"],
        run: () => prefs().set({ leftSidebarOpen: !prefs().leftSidebarOpen }),
      },
      { id: "panel", key: msg("Mostrar/ocultar panel derecho"), icon: PanelRight, run: () => prefs().set({ rightPanelOpen: !prefs().rightPanelOpen }) },
      { id: "settings", key: msg("Configuración"), icon: Settings, core: true, run: settings("general") },
      { id: "settings-backups", key: msg("Configuración: Copias de seguridad"), icon: HardDriveDownload, run: settings("backups") },
      { id: "settings-data", key: msg("Configuración: Importar y exportar"), icon: Database, run: settings("data") },
      { id: "settings-privacy", key: msg("Configuración: Privacidad y seguridad"), icon: ShieldCheck, keywords: [msg("Cambiar contraseña")], run: settings("privacy") },
      { id: "settings-about", key: msg("Configuración: Acerca de"), icon: Info, keywords: [msg("Apoya el proyecto"), "PayPal"], run: settings("about") },
      { id: "shortcuts", key: msg("Atajos de teclado"), icon: Keyboard, hint: ["?"], run: () => ui().setShortcutsOpen(true) },
      { id: "theme-light", key: msg("Tema: Claro"), icon: Sun, run: () => useThemeStore.getState().setPreference("light") },
      { id: "theme-dark", key: msg("Tema: Oscuro"), icon: Moon, run: () => useThemeStore.getState().setPreference("dark") },
      { id: "theme-system", key: msg("Tema: Del sistema"), icon: Monitor, run: () => useThemeStore.getState().setPreference("system") },
      ...LANGUAGES.filter((l) => l.code !== getLanguage()).map((l) => ({
        id: `lang-${l.code}`,
        key: msg("Idioma: {name}"),
        label: t("Idioma: {name}", { name: l.name }),
        icon: Languages,
        keywords: ["Idioma", "Language", l.name, l.code],
        run: () => {
          close();
          // Cambiar el idioma vuelve a montar la aplicación.
          setTimeout(() => setLanguage(l.code), 0);
        },
      })),
      { id: "lock", key: msg("Bloquear Chronos"), icon: Lock, hint: ["Ctrl", "L"], core: true, run: onLock },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onLock],
  );
}

async function backupNow() {
  try {
    const r = await api.backup.create();
    toast.info(t("Copia cifrada creada ({size})", { size: formatBytes(r.sizeBytes) }));
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

/**
 * Menú de comandos: busca eventos y acciones, salta a fechas y crea eventos
 * escribiendo. En modo «create» solo crea («Dentista mañana 5pm»).
 */
export function CommandMenu({ onLock }: { onLock: () => void }) {
  const mode = useUiStore((s) => s.commandMenu);
  if (!mode) return null;
  return <CommandMenuDialog key={mode} mode={mode} onLock={onLock} />;
}

function CommandMenuDialog({ mode, onLock }: { mode: CommandMode; onLock: () => void }) {
  const close = () => useUiStore.getState().openCommandMenu(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<Element | null>(document.activeElement);
  const calendars = useCalendarMap();
  const { weekStartsOn, defaultDurationMin } = usePrefsStore();
  const actions = useActions(onLock, close);

  useEffect(() => {
    inputRef.current?.focus();
    const el = restoreFocus.current;
    return () => {
      if (el instanceof HTMLElement && el.isConnected) el.focus();
    };
  }, []);

  // Búsqueda en la base cifrada (en el backend), con una pequeña espera.
  const q = query.trim();
  useEffect(() => {
    if (mode !== "all" || q.length < 2) {
      setEvents([]);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api.events
        .search(q)
        .then((r) => !cancelled && (setEvents(r.slice(0, 8)), setSearchError(null)))
        .catch((e) => !cancelled && setSearchError(errorMessage(e)));
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, mode]);

  const rows = useMemo<Row[]>(() => {
    const now = new Date();
    const opts = { now, weekStartsOn, dayFirst: localeDayFirst(), defaultDurationMin };
    const quick = q ? parseQuickEvent(q, opts) : null;
    const out: Row[] = [];
    const createRow = (qe: QuickEvent): Row => ({
      id: "quick",
      group: GROUP.create,
      icon: CalendarPlus,
      label: t("Crear «{title}»", { title: qe.title }),
      detail: describeQuick(qe),
      hint: ["Enter"],
      run: () => createQuickEvent(qe),
    });

    if (mode === "create") {
      if (quick) out.push(createRow(quick));
      out.push({ id: "form", group: GROUP.create, icon: SquarePen, label: t("Abrir el formulario vacío"), hint: ["C"], run: () => createEventNow() });
      return out;
    }

    const date = q ? parseDate(q, opts) : null;
    const understood = quick && (quick.found.date || quick.found.time || quick.found.recurrence);
    if (date) {
      out.push({ id: "goto-date", group: GROUP.goto, icon: ArrowRight, label: formatLongDate(date), run: () => useUiStore.getState().setAnchor(date) });
    }
    const taskRow = (): Row => ({
      id: "task",
      group: GROUP.create,
      icon: ListTodo,
      label: t("Crear tarea «{title}»", { title: quick && understood ? quick.title : q }),
      run: () =>
        createTask({
          title: quick && understood ? quick.title : q,
          ...(quick && understood && quick.found.date
            ? quick.found.time
              ? { dueAt: quick.start.getTime(), isAllDay: false }
              : { dueAt: Date.UTC(quick.start.getFullYear(), quick.start.getMonth(), quick.start.getDate()), isAllDay: true }
            : {}),
        }),
    });
    if (quick && understood) out.push(createRow(quick), taskRow());

    const ranked = rankCommands(
      actions.map((a) => ({ ...a, label: a.label ?? t(a.key), keywords: [a.key, ...(a.keywords ?? []).flatMap((k) => [k, t(k)])] })),
      q,
    );
    for (const a of (q ? ranked.slice(0, 8) : ranked.filter((r) => r.core))) {
      out.push({ id: a.id, group: GROUP.actions, icon: a.icon, label: a.label, hint: a.hint, run: a.run });
    }
    for (const e of events) {
      out.push({
        id: `event-${e.id}`,
        group: GROUP.events,
        icon: CalendarDays,
        color: eventColor(e, calendars.get(e.calendarId)?.color),
        label: e.title || t("Sin título"),
        detail: `${formatMediumDate(eventStart(e))} · ${formatEventTime(e)}`,
        run: () => {
          useUiStore.getState().setAnchor(eventStart(e));
          useUiStore.getState().select(e.id);
        },
      });
    }
    if (q && !(quick && understood)) {
      if (quick) out.push(createRow(quick));
      out.push(taskRow());
    }
    return out;
  }, [q, mode, actions, events, calendars, weekStartsOn, defaultDurationMin]);

  useEffect(() => setActive(0), [q]);
  const current = Math.min(active, rows.length - 1);

  useLayoutEffect(() => {
    listRef.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  async function run(row: Row | undefined) {
    if (!row) return;
    close();
    await row.run();
  }

  const listId = "command-menu-list";
  let lastGroup = "";

  return (
    <div className="fixed inset-0 z-[70] flex justify-center bg-black/25 pt-[12vh]" onMouseDown={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={mode === "create" ? t("Crear evento escribiendo") : t("Menú de comandos")}
        className="flex h-fit max-h-[70vh] w-[min(580px,calc(100vw-32px))] flex-col overflow-hidden rounded-xl border border-border-strong bg-popover shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-4">
          {mode === "create" ? <CalendarPlus className="size-4 shrink-0 text-muted" /> : <Search className="size-4 shrink-0 text-muted" />}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={rows[current] ? `cmd-${rows[current]!.id}` : undefined}
            aria-autocomplete="list"
            spellCheck={false}
            placeholder={
              mode === "create"
                ? t("Escribe el evento: «Dentista mañana 5pm 1h»")
                : t("Busca eventos y acciones, salta a una fecha o escribe un evento")
            }
            className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-strong placeholder:text-muted focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                close();
              } else if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
                e.preventDefault();
                setActive((a) => (rows.length ? (Math.min(a, rows.length - 1) + 1) % rows.length : 0));
              } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
                e.preventDefault();
                setActive((a) => (rows.length ? (Math.min(a, rows.length - 1) - 1 + rows.length) % rows.length : 0));
              } else if (e.key === "Home" && e.ctrlKey) {
                setActive(0);
              } else if (e.key === "Enter") {
                e.preventDefault();
                void run(rows[current]);
              }
            }}
          />
          <kbd className="kbd">Esc</kbd>
        </div>
        <div ref={listRef} id={listId} role="listbox" aria-label={t("Resultados")} className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {rows.map((row, i) => {
            const header = row.group !== lastGroup ? row.group : null;
            lastGroup = row.group;
            const Icon = row.icon;
            return (
              <div key={row.id}>
                {header && <div className="px-2.5 pb-1 pt-2 text-[11px] font-medium text-muted">{t(header)}</div>}
                <div
                  id={`cmd-${row.id}`}
                  role="option"
                  aria-selected={i === current}
                  data-index={i}
                  onMouseMove={() => i !== current && setActive(i)}
                  onClick={() => void run(row)}
                  className={cn(
                    "flex min-h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px]",
                    i === current ? "bg-surface-hover text-strong" : "text-foreground",
                  )}
                >
                  {row.color ? (
                    <span className="mx-[3px] size-2.5 shrink-0 rounded-full" style={{ background: row.color }} />
                  ) : (
                    <Icon className="size-4 shrink-0 text-muted" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{row.label}</span>
                    {row.detail && <span className="line-clamp-2 block text-[11.5px] text-muted">{row.detail}</span>}
                  </span>
                  {row.hint && (
                    <span className="flex shrink-0 gap-1">
                      {row.hint.map((k) => (
                        <kbd key={k} className="kbd">
                          {k}
                        </kbd>
                      ))}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {mode === "all" && q.length >= 2 && events.length === 0 && !searchError && rows.length === 0 && (
            <p className="px-2.5 py-2 text-[12px] text-muted">{t("Sin resultados")}</p>
          )}
          {searchError && <p className="px-2.5 py-2 text-[12px] text-danger">{searchError}</p>}
          {mode === "create" && !q && (
            <div className="space-y-1 px-2.5 pb-2 pt-1 text-[12px] leading-relaxed text-muted">
              <p>{t("Escribe el título con la fecha, la hora, la duración o la repetición, en español o en inglés. Por ejemplo:")}</p>
              <ul className="list-inside list-disc">
                <li>Dentista mañana 5pm 1h</li>
                <li>Gimnasio lunes y miércoles 7am</li>
                <li>Viaje 10–12 dic</li>
                <li>Standup every weekday 9:30</li>
              </ul>
            </div>
          )}
        </div>
        {mode === "all" && (
          <div className="flex h-8 shrink-0 items-center gap-3 border-t border-border px-3 text-[11px] text-muted">
            <span>
              <kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> {t("moverse")}
            </span>
            <span>
              <kbd className="kbd">Enter</kbd> {t("abrir")}
            </span>
            <span className="ml-auto truncate">{tp(rows.length, "{n} resultado", "{n} resultados")}</span>
          </div>
        )}
      </div>
    </div>
  );
}
