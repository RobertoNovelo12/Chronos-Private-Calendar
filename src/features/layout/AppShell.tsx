import { useCallback, useEffect, useState } from "react";
import { Lock, Monitor, Moon, Sun, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BackupButton } from "@/features/backup/BackupButton";
import { CalendarList } from "@/features/calendars/CalendarList";
import { errorMessage } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { useCalendarStore } from "@/stores/calendarStore";
import { useThemeStore } from "@/stores/themeStore";
import { useVaultStore } from "@/stores/vaultStore";

interface Notice {
  message: string;
  kind: "info" | "error";
}

const dateFormatter = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

function capitalizeFirst(text: string): string {
  return text.charAt(0).toLocaleUpperCase("es") + text.slice(1);
}

/** Estructura principal: barra lateral + área del calendario. */
export function AppShell() {
  const lock = useVaultStore((s) => s.lock);
  const { load, clear, loaded } = useCalendarStore();
  const { preference, cycle } = useThemeStore();
  const [notice, setNotice] = useState<Notice | null>(null);

  const notify = useCallback((message: string, kind: Notice["kind"] = "error") => setNotice({ message, kind }), []);

  useEffect(() => {
    load().catch((e) => notify(errorMessage(e)));
  }, [load, notify]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const onLock = useCallback(async () => {
    try {
      await lock();
      clear();
    } catch (e) {
      notify(errorMessage(e));
    }
  }, [lock, clear, notify]);

  // Atajo: Ctrl/Cmd + L bloquea la aplicación.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") {
        e.preventDefault();
        void onLock();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onLock]);

  const ThemeIcon = preference === "dark" ? Moon : preference === "light" ? Sun : Monitor;
  const themeLabel = { system: "Tema del sistema", light: "Tema claro", dark: "Tema oscuro" }[preference];

  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface">
        <div className="flex h-12 items-center justify-between px-3">
          <span className="text-[13px] font-semibold tracking-tight">Chronos</span>
          <div className="flex items-center">
            <Button variant="ghost" size="icon" onClick={cycle} aria-label={themeLabel} title={themeLabel}>
              <ThemeIcon />
            </Button>
            <Button variant="ghost" size="icon" onClick={onLock} aria-label="Bloquear" title="Bloquear (Ctrl+L)">
              <Lock />
            </Button>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-1.5 py-2">
          {loaded && <CalendarList onError={(m) => notify(m)} />}
        </nav>
        <div className="border-t border-border p-1.5">
          <BackupButton onMessage={notify} />
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center border-b border-border px-5">
          <h1 className="text-[15px] font-semibold">{capitalizeFirst(dateFormatter.format(new Date()))}</h1>
        </header>
        <section className="flex flex-1 items-center justify-center">
          <div className="max-w-sm text-center">
            <p className="text-[13px] font-medium">Vistas de calendario en construcción</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">
              La base cifrada, los calendarios y las copias de seguridad ya funcionan. Las vistas Día, Semana, Mes y
              Agenda llegan en la Fase 3.
            </p>
          </div>
        </section>
      </main>

      {notice && (
        <div
          role="status"
          className={cn(
            "fixed bottom-4 right-4 z-40 flex max-w-md items-start gap-3 rounded-lg border bg-background px-4 py-3 text-[13px] shadow-xl",
            notice.kind === "error" ? "border-danger/40 text-danger" : "border-border",
          )}
        >
          <span className="min-w-0 break-words">{notice.message}</span>
          <button onClick={() => setNotice(null)} aria-label="Cerrar" className="text-muted hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
