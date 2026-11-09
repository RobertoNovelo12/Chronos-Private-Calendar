import { create } from "zustand";
import { startOfDay } from "date-fns";
import { shiftAnchor, type ViewKind } from "@/lib/dates";
import type { EditScope } from "@/types/domain";
import { DRAFT_ID, useEventStore } from "./eventStore";
import { usePrefsStore } from "./prefsStore";

export interface ContextMenuState {
  eventId: string;
  x: number;
  y: number;
}

/** Menú contextual sobre un hueco vacío de la vista. */
export interface SlotMenuState {
  x: number;
  y: number;
  /** Instante (rejilla horaria) o inicio local del día (`allDay`). */
  time: number;
  allDay: boolean;
}

export type SettingsTab = "general" | "backups" | "data" | "privacy";

export interface ScopeRequest {
  kind: "edit" | "delete";
  /** Cambiar la regla no admite "solo este evento". */
  allowThis: boolean;
  resolve: (scope: EditScope | null) => void;
}

interface UiState {
  view: ViewKind;
  /** Fecha de referencia de la vista. */
  anchor: Date;
  selectedEventId: string | null;
  /**
   * Clave del panel de detalles. Se mantiene cuando un borrador pasa a ser un
   * evento guardado, para no perder el foco mientras se escribe.
   */
  panelKey: string | null;
  /** El panel debe enfocar el título (evento recién creado). */
  focusTitle: boolean;
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  shortcutsOpen: boolean;
  confirmDeleteId: string | null;
  contextMenu: ContextMenuState | null;
  slotMenu: SlotMenuState | null;
  scopeRequest: ScopeRequest | null;
  setView: (v: ViewKind) => void;
  setAnchor: (d: Date) => void;
  today: () => void;
  step: (dir: 1 | -1) => void;
  select: (id: string | null, focusTitle?: boolean) => void;
  /** El borrador se guardó con este id: se selecciona sin reiniciar el panel. */
  promoteDraft: (id: string) => void;
  setSettingsOpen: (open: boolean) => void;
  openSettings: (tab?: SettingsTab) => void;
  setShortcutsOpen: (open: boolean) => void;
  askDelete: (id: string | null) => void;
  openContextMenu: (m: ContextMenuState | null) => void;
  openSlotMenu: (m: SlotMenuState | null) => void;
  /** Pregunta "este / siguientes / todos" para un evento repetido. */
  askScope: (kind: "edit" | "delete", allowThis?: boolean) => Promise<EditScope | null>;
  reset: () => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  view: usePrefsStore.getState().lastView,
  anchor: startOfDay(new Date()),
  selectedEventId: null,
  panelKey: null,
  focusTitle: false,
  settingsOpen: false,
  settingsTab: "general",
  shortcutsOpen: false,
  confirmDeleteId: null,
  contextMenu: null,
  slotMenu: null,
  scopeRequest: null,
  setView: (view) => {
    usePrefsStore.getState().set({ lastView: view });
    set({ view });
  },
  setAnchor: (d) => set({ anchor: startOfDay(d) }),
  today: () => set({ anchor: startOfDay(new Date()) }),
  step: (dir) => set({ anchor: shiftAnchor(get().view, get().anchor, dir, usePrefsStore.getState().customDays) }),
  select: (id, focusTitle = false) => {
    // Un borrador sin cambios se descarta al dejar de estar seleccionado.
    if (get().selectedEventId === DRAFT_ID && id !== DRAFT_ID) useEventStore.getState().setDraft(null);
    set({ selectedEventId: id, panelKey: id, focusTitle });
  },
  promoteDraft: (id) => {
    if (get().selectedEventId === DRAFT_ID) set({ selectedEventId: id });
  },
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  openSettings: (tab = "general") => set({ settingsOpen: true, settingsTab: tab, contextMenu: null }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  askDelete: (id) => {
    if (id === DRAFT_ID) {
      get().select(null);
      return;
    }
    set({ confirmDeleteId: id, contextMenu: null });
  },
  openContextMenu: (contextMenu) => set({ contextMenu, slotMenu: null }),
  openSlotMenu: (slotMenu) => set({ slotMenu, contextMenu: null }),
  askScope: (kind, allowThis = true) =>
    new Promise((resolve) => {
      get().scopeRequest?.resolve(null);
      set({
        scopeRequest: {
          kind,
          allowThis,
          resolve: (scope) => {
            set({ scopeRequest: null });
            resolve(scope);
          },
        },
      });
    }),
  reset: () => {
    get().scopeRequest?.resolve(null);
    set({
      selectedEventId: null,
      panelKey: null,
      confirmDeleteId: null,
      contextMenu: null,
      slotMenu: null,
      settingsOpen: false,
      shortcutsOpen: false,
      scopeRequest: null,
    });
  },
}));
