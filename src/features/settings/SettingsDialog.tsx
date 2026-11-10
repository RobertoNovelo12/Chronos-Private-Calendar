import { useEffect, useState } from "react";
import { Database, HardDriveDownload, Info, Settings2, ShieldCheck, X } from "lucide-react";
import { BackupsTab } from "@/features/data/BackupsTab";
import { DataTab } from "@/features/data/DataTab";
import { PrivacyTab } from "@/features/data/PrivacyTab";
import { AboutTab } from "./AboutTab";
import { Button } from "@/components/ui/button";
import { systemTimeZone } from "@/lib/dates";
import { api, errorMessage } from "@/lib/ipc";
import { toast } from "@/stores/toastStore";
import { usePrefsStore } from "@/stores/prefsStore";
import { useThemeStore, type ThemePreference } from "@/stores/themeStore";
import { useUiStore, type SettingsTab } from "@/stores/uiStore";
import { msg, t, t as tr } from "@/i18n";
import { LanguageSelect } from "@/i18n/LanguageSelect";

const TABS: { id: SettingsTab; label: string; icon: typeof X }[] = [
  { id: "general", label: msg("General"), icon: Settings2 },
  { id: "backups", label: msg("Copias de seguridad"), icon: HardDriveDownload },
  { id: "data", label: msg("Importar y exportar"), icon: Database },
  { id: "privacy", label: msg("Privacidad y seguridad"), icon: ShieldCheck },
  { id: "about", label: msg("Acerca de"), icon: Info },
];

const NOTIF_KEY = "notifications.show_details";
const HOURS = Array.from({ length: 25 }, (_, i) => i);
const selectCls =
  "h-8 rounded-md bg-control px-2 text-[13px] text-strong focus:outline-none focus:ring-2 focus:ring-ring";

export function SettingsDialog() {
  const open = useUiStore((s) => s.settingsOpen);
  const tab = useUiStore((s) => s.settingsTab);
  const setOpen = useUiStore((s) => s.setSettingsOpen);
  const openSettings = useUiStore((s) => s.openSettings);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;
  const current = TABS.find((t) => t.id === tab) ?? TABS[0]!;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onMouseDown={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="flex h-[min(600px,calc(100vh-48px))] w-[min(780px,calc(100vw-48px))] overflow-hidden rounded-xl border border-border-strong bg-popover shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <nav className="flex w-[200px] shrink-0 flex-col gap-0.5 bg-surface p-2" aria-label={t("Secciones")}>
          <h2 id="settings-title" className="px-2 pb-2 pt-2 text-[12px] font-semibold text-muted">
            {t("Configuración")}
          </h2>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => openSettings(t.id)}
              aria-current={t.id === current.id ? "page" : undefined}
              className={`flex h-8 items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors ${
                t.id === current.id
                  ? "bg-surface-hover font-medium text-strong"
                  : "text-muted hover:bg-surface-hover hover:text-strong"
              }`}
            >
              <t.icon className="size-4 shrink-0" />
              <span className="truncate">{tr(t.label)}</span>
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center justify-between px-6">
            <h3 className="text-[15px] font-semibold">{tr(current.label)}</h3>
            <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label={t("Cerrar")}>
              <X />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
            {current.id === "general" && <GeneralTab />}
            {current.id === "backups" && <BackupsTab />}
            {current.id === "data" && <DataTab />}
            {current.id === "privacy" && <PrivacyTab />}
            {current.id === "about" && <AboutTab />}
          </div>
        </div>
      </div>
    </div>
  );
}

function GeneralTab() {
  const prefs = usePrefsStore();
  const { preference, setPreference } = useThemeStore();
  const [showDetails, setShowDetails] = useState<boolean | null>(null);

  // Ajuste guardado en la base cifrada (lo usa el programador de recordatorios).
  useEffect(() => {
    api.settings
      .get<boolean>(NOTIF_KEY)
      .then((v) => setShowDetails(v ?? true))
      .catch(() => setShowDetails(true));
  }, []);

  async function changeShowDetails(v: boolean) {
    setShowDetails(v);
    try {
      await api.settings.set(NOTIF_KEY, v);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div className="space-y-4 pt-1 text-[13px]">
      <Row label={t("Idioma")}>
        <LanguageSelect />
      </Row>
      <Row label={t("Tema")}>
        <select
          className={selectCls}
          value={preference}
          onChange={(e) => setPreference(e.target.value as ThemePreference)}
        >
          <option value="system">{t("Del sistema")}</option>
          <option value="light">{t("Claro")}</option>
          <option value="dark">{t("Oscuro")}</option>
        </select>
      </Row>
      <Row label={t("La semana empieza el")}>
        <select
          className={selectCls}
          value={prefs.weekStartsOn}
          onChange={(e) => prefs.set({ weekStartsOn: Number(e.target.value) as 0 | 1 })}
        >
          <option value={1}>{t("Lunes")}</option>
          <option value={0}>{t("Domingo")}</option>
        </select>
      </Row>
      <Row label={t("Horario laboral")}>
        <div className="flex items-center gap-1.5">
          <select
            className={selectCls}
            value={prefs.workStartHour}
            onChange={(e) => {
              const v = Number(e.target.value);
              prefs.set({
                workStartHour: v,
                workEndHour: Math.max(prefs.workEndHour, v + 1),
              });
            }}
          >
            {HOURS.slice(0, 24).map((h) => (
              <option key={h} value={h}>{`${h}:00`}</option>
            ))}
          </select>
          <span className="text-muted">–</span>
          <select
            className={selectCls}
            value={prefs.workEndHour}
            onChange={(e) => prefs.set({ workEndHour: Number(e.target.value) })}
          >
            {HOURS.filter((h) => h > prefs.workStartHour).map((h) => (
              <option key={h} value={h}>{`${h}:00`}</option>
            ))}
          </select>
        </div>
      </Row>
      <Row label={t("Duración de eventos nuevos")}>
        <select
          className={selectCls}
          value={prefs.defaultDurationMin}
          onChange={(e) => prefs.set({ defaultDurationMin: Number(e.target.value) })}
        >
          {[15, 30, 45, 60, 90, 120].map((m) => (
            <option key={m} value={m}>
              {m < 60 ? t("{n} min", { n: m }) : t("{n} h", { n: m / 60 })}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t("Bloqueo automático")}>
        <select
          className={selectCls}
          value={prefs.autoLockMinutes}
          onChange={(e) => prefs.set({ autoLockMinutes: Number(e.target.value) })}
        >
          <option value={0}>{t("Desactivado")}</option>
          {[1, 5, 10, 15, 30, 60].map((m) => (
            <option key={m} value={m}>
              {t("Tras {n} min sin actividad", { n: m })}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t("Formato de hora")}>
        <select
          className={selectCls}
          value={prefs.timeFormat}
          onChange={(e) => prefs.set({ timeFormat: e.target.value as "12h" | "24h" })}
        >
          <option value="12h">{t("12 horas (1:00PM)")}</option>
          <option value="24h">{t("24 horas (13:00)")}</option>
        </select>
      </Row>
      <Row label={t("Notificaciones de recordatorios")}>
        <select
          className={selectCls}
          value={showDetails === false ? "hide" : "show"}
          disabled={showDetails === null}
          onChange={(e) => void changeShowDetails(e.target.value === "show")}
        >
          <option value="show">{t("Mostrar título y lugar")}</option>
          <option value="hide">{t("Ocultar detalles")}</option>
        </select>
      </Row>
      <Row label={t("Zona horaria")}>
        <span className="text-muted">{t("{zone} (del sistema)", { zone: systemTimeZone() })}</span>
      </Row>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span>{label}</span>
      {children}
    </div>
  );
}
