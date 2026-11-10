import { Search } from "lucide-react";
import { useUiStore } from "@/stores/uiStore";
import { t } from "@/i18n";

/** Acceso al menú de comandos con aspecto de buscador (también con / o Ctrl+K). */
export function SearchBox() {
  return (
    <button
      type="button"
      onClick={() => useUiStore.getState().openCommandMenu("all")}
      className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-[13px] text-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title={t("Buscar (/ o Ctrl+K)")}
      aria-label={t("Buscar eventos")}
      aria-keyshortcuts="Control+K"
    >
      <Search className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{t("Buscar eventos")}</span>
      <kbd className="kbd">Ctrl K</kbd>
    </button>
  );
}
