import { useCallback, useEffect, useState } from "react";
import { FolderOpen, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/ipc";
import { formatBytes } from "@/lib/utils";
import { toast } from "@/stores/toastStore";
import type { BackupRecord, BackupSettings } from "@/types/domain";
import { BackupActionDialog, KIND_LABEL, Row, Section, selectCls } from "./shared";
import { intlLocale, t, tp } from "@/i18n";

const KEEP_OPTIONS = [3, 5, 7, 14, 30, 60];

export function BackupsTab() {
  const [settings, setSettings] = useState<BackupSettings | null>(null);
  const [history, setHistory] = useState<BackupRecord[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<{ path: string; mode: "verify" | "restore" } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([api.backup.settings(), api.backup.history()]);
      setSettings(s);
      setHistory(h);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Las copias automáticas se crean en segundo plano: mientras la pestaña está
  // abierta, el historial se vuelve a leer cada 20 s para mostrarlas sin reabrir.
  useEffect(() => {
    const id = window.setInterval(() => {
      api.backup
        .history()
        .then(setHistory)
        .catch(() => {});
    }, 20_000);
    return () => window.clearInterval(id);
  }, []);

  async function update(patch: { auto?: BackupSettings["auto"]; keep?: number }) {
    try {
      setSettings(await api.backup.setSettings(patch));
      if (patch.keep) setHistory(await api.backup.history());
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function chooseDir(reset: boolean) {
    try {
      setSettings(await api.backup.chooseDir(reset));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function createNow() {
    setBusy(true);
    try {
      const rec = await api.backup.createIn(false);
      if (rec) toast.info(t("Copia cifrada creada ({size})", { size: formatBytes(rec.sizeBytes) }));
      await refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function restoreFromFile() {
    try {
      const path = await api.backup.pickFile();
      if (path) setAction({ path, mode: "restore" });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div className="space-y-7">
      <Section
        title={t("Copias automáticas")}
        description={t("Se crean mientras Chronos está desbloqueado, cifradas con tu contraseña actual (Argon2id + XChaCha20-Poly1305). Las más antiguas se eliminan al superar el límite.")}
      >
        <Row label={t("Frecuencia")}>
          <select
            className={selectCls}
            value={settings?.auto ?? "daily"}
            disabled={!settings}
            onChange={(e) => void update({ auto: e.target.value as BackupSettings["auto"] })}
          >
            <option value="daily">{t("Una vez al día")}</option>
            <option value="weekly">{t("Una vez por semana")}</option>
            <option value="off">{t("Desactivadas")}</option>
          </select>
        </Row>
        <Row label={t("Conservar")}>
          <select
            className={selectCls}
            value={settings?.keep ?? 7}
            disabled={!settings || settings.auto === "off"}
            onChange={(e) => void update({ keep: Number(e.target.value) })}
          >
            {[...new Set([...KEEP_OPTIONS, settings?.keep ?? 7])].sort((a, b) => a - b).map((n) => (
              <option key={n} value={n}>
                {tp(n, "La más reciente", "Las {n} más recientes")}
              </option>
            ))}
          </select>
        </Row>
        <div className="space-y-1.5 text-[13px]">
          <div className="flex items-center justify-between gap-3">
            <span>{t("Carpeta")}</span>
            <div className="flex gap-1">
              {settings && !settings.isDefaultDir && (
                <Button variant="ghost" size="sm" onClick={() => void chooseDir(true)} title={t("Volver a la carpeta predeterminada")}>
                  <RotateCcw /> {t("Predeterminada")}
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={() => void chooseDir(false)} disabled={!settings}>
                <FolderOpen /> {t("Cambiar…")}
              </Button>
            </div>
          </div>
          <p className="break-all rounded-md bg-control px-2.5 py-1.5 font-mono text-[11px] text-muted" title={settings?.dir}>
            {settings?.dir ?? "…"}
          </p>
          <p className="text-[11px] leading-relaxed text-muted">
            {t("Para protegerte de un fallo del disco, elige una carpeta en otra unidad o en una memoria externa.")}
          </p>
        </div>
      </Section>

      <Section title={t("Historial")} description={t("Copias creadas en este equipo. Verificar comprueba la integridad y la contraseña sin cambiar nada.")}>
        <div className="flex gap-2">
          <Button variant="default" size="sm" onClick={() => void createNow()} disabled={busy}>
            {busy ? t("Creando…") : t("Crear copia ahora")}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void restoreFromFile()}>
            {t("Restaurar desde archivo…")}
          </Button>
        </div>
        <div className="overflow-hidden rounded-lg border border-border">
          {history === null ? (
            <p className="px-3 py-3 text-[12px] text-muted">{t("Cargando…")}</p>
          ) : history.length === 0 ? (
            <p className="px-3 py-3 text-[12px] text-muted">{t("Todavía no hay copias.")}</p>
          ) : (
            <ul className="max-h-[220px] divide-y divide-border overflow-y-auto">
              {history.map((r) => (
                <li key={r.id} className="group flex items-center gap-3 px-3 py-2 text-[12px]">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-strong">
                        {new Date(r.createdAt).toLocaleString(intlLocale(), { dateStyle: "medium", timeStyle: "short" })}
                      </span>
                      <span className="rounded bg-control px-1.5 py-px text-[10px] text-muted">{t(KIND_LABEL[r.kind])}</span>
                      {r.status !== "ok" && <span className="text-danger">{t("Falló")}</span>}
                    </div>
                    <div className="truncate text-[11px] text-muted" title={r.filePath}>
                      {formatBytes(r.sizeBytes)} · {r.fileName}
                    </div>
                  </div>
                  {r.status === "ok" && (
                    <div className="flex shrink-0 gap-1 opacity-70 group-hover:opacity-100">
                      <Button variant="ghost" size="sm" onClick={() => setAction({ path: r.filePath, mode: "verify" })}>
                        {t("Verificar")}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setAction({ path: r.filePath, mode: "restore" })}>
                        {t("Restaurar")}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>

      {action && (
        <BackupActionDialog
          path={action.path}
          mode={action.mode}
          onClose={() => setAction(null)}
          onDone={() => void refresh()}
        />
      )}
    </div>
  );
}
