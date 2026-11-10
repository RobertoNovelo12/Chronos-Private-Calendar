import { useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUiStore } from "@/stores/uiStore";
import { msg, t } from "@/i18n";

const GROUPS: { title: string; items: { label: string; keys: string[] }[] }[] = [
  {
    title: msg("Vistas"),
    items: [
      { label: msg("Día"), keys: ["1", "D"] },
      { label: msg("Semana"), keys: ["0", "W"] },
      { label: msg("Mes"), keys: ["M"] },
      { label: msg("Agenda"), keys: ["A"] },
      { label: msg("Número de días (2–9)"), keys: ["2…9"] },
    ],
  },
  {
    title: msg("Navegación"),
    items: [
      { label: msg("Ir a hoy"), keys: ["T"] },
      { label: msg("Periodo siguiente"), keys: ["J", "→"] },
      { label: msg("Periodo anterior"), keys: ["K", "←"] },
      { label: msg("Buscar eventos"), keys: ["/", "Ctrl K"] },
      { label: msg("Mostrar/ocultar barra lateral"), keys: ["`"] },
    ],
  },
  {
    title: msg("Eventos"),
    items: [
      { label: msg("Nuevo evento"), keys: ["C"] },
      { label: msg("Nueva tarea (para hoy)"), keys: ["Shift", "C"] },
      { label: msg("Copiar el seleccionado"), keys: ["Ctrl C"] },
      { label: msg("Pegar bajo el puntero"), keys: ["Ctrl V"] },
      { label: msg("Duplicar el seleccionado"), keys: ["Ctrl D"] },
      { label: msg("Eliminar el seleccionado"), keys: [msg("Supr")] },
      { label: msg("Cerrar detalles"), keys: ["Esc"] },
      { label: msg("Deshacer"), keys: ["Ctrl Z"] },
      { label: msg("Rehacer"), keys: ["Ctrl Shift Z"] },
    ],
  },
  {
    title: msg("Privacidad"),
    items: [{ label: msg("Bloquear Chronos"), keys: ["Ctrl L"] }],
  },
];

export function ShortcutsDialog() {
  const open = useUiStore((s) => s.shortcutsOpen);
  const setOpen = useUiStore((s) => s.setShortcutsOpen);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="w-[560px] rounded-xl border border-border-strong bg-popover shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3">
          <h2 id="shortcuts-title" className="text-[15px] font-semibold text-strong">
            {t("Atajos de teclado")}
          </h2>
          <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label={t("Cerrar")}>
            <X />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-5 px-5 pb-5">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3 className="pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{t(g.title)}</h3>
              <ul className="space-y-1">
                {g.items.map((it) => (
                  <li key={it.label} className="flex items-center justify-between gap-3 text-[12px] text-foreground">
                    <span>{t(it.label)}</span>
                    <span className="flex shrink-0 gap-1">
                      {it.keys.map((k) => (
                        <kbd key={k} className="kbd">
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
