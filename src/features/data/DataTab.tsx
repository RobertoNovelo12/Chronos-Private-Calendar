import { useState } from "react";
import { addDays, startOfDay, startOfMonth } from "date-fns";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateSelect } from "@/components/ui/pickers";
import { systemTimeZone } from "@/lib/dates";
import { api, errorMessage } from "@/lib/ipc";
import { formatBytes } from "@/lib/utils";
import { useCalendarStore } from "@/stores/calendarStore";
import { usePrefsStore } from "@/stores/prefsStore";
import { toast } from "@/stores/toastStore";
import type { ExportKind, ExportOptions, ImportPreview, ImportReport } from "@/types/domain";
import { BackupActionDialog, PasswordInput, reloadData, Row, Section, selectCls } from "./shared";
import { msg, t, tp } from "@/i18n";

type ExportFormat = ExportKind | "backup";

const FORMAT_HELP: Record<ExportFormat, string> = {
  ics: msg("iCalendar (.ics): para Google Calendar, Outlook, Apple Calendar y otras apps. Incluye repeticiones, recordatorios y tareas."),
  json: msg("JSON de Chronos: copia legible y completa para volver a importarla aquí. No está cifrada."),
  csv: msg("CSV para hojas de cálculo (solo eventos). Solo exportación; no está cifrado."),
  backup: msg("Copia completa cifrada (.chronosbak). Es la única exportación protegida con contraseña."),
};



export function DataTab() {
  return (
    <div className="space-y-8">
      <ImportSection />
      <ExportSection />
    </div>
  );
}

function ImportSection() {
  const calendars = useCalendarStore((s) => s.calendars);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [target, setTarget] = useState<string>("__new");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [restorePath, setRestorePath] = useState<string | null>(null);

  async function pick() {
    try {
      const p = await api.data.pickImport(systemTimeZone());
      if (!p) return;
      setReport(null);
      if (p.format === "backup") {
        setRestorePath(p.path);
        return;
      }
      setPreview(p);
      setTarget("__new");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function apply() {
    if (!preview) return;
    setBusy(true);
    try {
      const r = await api.data.applyImport(
        preview.path,
        target === "__new" ? { kind: "new", name: null } : { kind: "existing", calendarId: target },
        systemTimeZone(),
      );
      setReport(r);
      setPreview(null);
      await reloadData();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const fileCalendars = preview?.calendars.length ? preview.calendars.join(", ") : preview?.fileName.replace(/\.[^.]+$/, "");

  return (
    <Section
      title={t("Importar")}
      description={t("Archivos .ics (de Google, Outlook, Apple…) o .json exportados por Chronos. Los eventos que ya existen (mismo identificador) no se duplican. Una copia .chronosbak se restaura.")}
    >
      {!preview ? (
        <Button variant="secondary" size="sm" onClick={() => void pick()}>
          <FileUp /> {t("Elegir archivo…")}
        </Button>
      ) : (
        <div className="space-y-3 rounded-lg border border-border p-3 text-[13px]">
          <div>
            <div className="truncate font-medium text-strong" title={preview.path}>
              {preview.fileName}
            </div>
            <div className="text-[12px] text-muted">
              {tp(preview.events, "{n} evento", "{n} eventos")}
              {preview.tasks > 0 && ` · ${tp(preview.tasks, "{n} tarea", "{n} tareas")}`}
              {preview.calendars.length > 0 && ` · ${tp(preview.calendars.length, "{n} calendario", "{n} calendarios")}`}
              {preview.rulesDropped > 0 &&
                ` · ${tp(preview.rulesDropped, "{n} regla de repetición no compatible (se importará como evento único)", "{n} reglas de repetición no compatibles (se importarán como eventos únicos)")}`}
            </div>
          </div>
          <Row label={t("Importar en")}>
            <select className={`${selectCls} max-w-[260px]`} value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="__new">{t("Calendario «{name}»", { name: fileCalendars ?? "" })}</option>
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Row>
          {target === "__new" && (
            <p className="text-[11px] text-muted">{t("Si ya tienes un calendario con ese nombre, se usa ese; si no, se crea.")}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPreview(null)} disabled={busy}>
              {t("Cancelar")}
            </Button>
            <Button size="sm" onClick={() => void apply()} disabled={busy || preview.events + preview.tasks === 0}>
              {busy
                ? t("Importando…")
                : preview.events === 0
                  ? t("Importar {what}", { what: tp(preview.tasks, "{n} tarea", "{n} tareas") })
                  : preview.tasks > 0
                    ? t("Importar {events} y {tasks}", {
                        events: tp(preview.events, "{n} evento", "{n} eventos"),
                        tasks: tp(preview.tasks, "{n} tarea", "{n} tareas"),
                      })
                    : t("Importar {what}", { what: tp(preview.events, "{n} evento", "{n} eventos") })}
            </Button>
          </div>
        </div>
      )}
      {report && (
        <p className="rounded-md bg-control px-3 py-2 text-[12px] leading-relaxed">
          {t("Importación completada:")} {tp(report.imported, "{n} evento importado", "{n} eventos importados")}
          {report.tasksImported > 0 && `, ${tp(report.tasksImported, "{n} tarea importada", "{n} tareas importadas")}`}
          {report.duplicates > 0 && `, ${tp(report.duplicates, "{n} ya existía", "{n} ya existían")}`}
          {report.skipped > 0 && `, ${tp(report.skipped, "{n} descartado (cancelado o no válido)", "{n} descartados (cancelados o no válidos)")}`}
          {report.rulesDropped > 0 && `, ${tp(report.rulesDropped, "{n} repetición no compatible", "{n} repeticiones no compatibles")}`}
          {report.calendarsCreated > 0 && `. ${tp(report.calendarsCreated, "{n} calendario nuevo", "{n} calendarios nuevos")}`}
          {report.labelsCreated > 0 && `. ${tp(report.labelsCreated, "{n} etiqueta nueva", "{n} etiquetas nuevas")}`}.
        </p>
      )}
      {restorePath && (
        <BackupActionDialog path={restorePath} mode="restore" onClose={() => setRestorePath(null)} />
      )}
    </Section>
  );
}

function ExportSection() {
  const calendars = useCalendarStore((s) => s.calendars);
  const weekStartsOn = usePrefsStore((s) => s.weekStartsOn);
  const [format, setFormat] = useState<ExportFormat>("ics");
  const [calendarId, setCalendarId] = useState<string>("__all");
  const [ranged, setRanged] = useState(false);
  const [from, setFrom] = useState(() => startOfMonth(new Date()));
  const [to, setTo] = useState(() => addDays(startOfMonth(new Date()), 30));
  const [ownPassword, setOwnPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const isBackup = format === "backup";
  const pwOk = !ownPassword || ([...password].length >= 8 && password === confirm);

  async function run() {
    setBusy(true);
    try {
      if (isBackup) {
        const rec = await api.backup.createIn(true, ownPassword ? password : undefined);
        if (rec) {
          toast.info(t("Copia cifrada guardada ({size})", { size: formatBytes(rec.sizeBytes) }));
          setPassword("");
          setConfirm("");
        }
        return;
      }
      const options: ExportOptions = {
        calendarIds: calendarId === "__all" ? null : [calendarId],
        from: ranged ? startOfDay(from).getTime() : null,
        to: ranged ? addDays(startOfDay(to), 1).getTime() : null,
      };
      const cal = calendars.find((c) => c.id === calendarId);
      const name = `chronos-${cal ? cal.name : "calendarios"}`;
      const r = await api.data.export(format, options, name);
      if (r)
        toast.info(
          r.tasks > 0
            ? t("{events} y {tasks}", {
                events: tp(r.events, "{n} evento exportado", "{n} eventos exportados"),
                tasks: tp(r.tasks, "{n} tarea", "{n} tareas"),
              })
            : tp(r.events, "{n} evento exportado", "{n} eventos exportados"),
        );
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={t("Exportar")}>
      <div className="grid grid-cols-4 gap-1.5">
        {(["ics", "json", "csv", "backup"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFormat(f)}
            className={`h-8 rounded-md text-[12px] font-medium transition-colors ${
              format === f ? "bg-accent text-accent-foreground" : "bg-control text-strong hover:bg-surface-hover"
            }`}
          >
            {f === "backup" ? t("Copia cifrada") : f.toUpperCase()}
          </button>
        ))}
      </div>
      <p className="text-[12px] leading-relaxed text-muted">{t(FORMAT_HELP[format])}</p>

      {!isBackup ? (
        <>
          <Row label={t("Calendarios")}>
            <select className={`${selectCls} max-w-[260px]`} value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>
              <option value="__all">{t("Todos")}</option>
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t("Fechas")}>
            <select className={selectCls} value={ranged ? "range" : "all"} onChange={(e) => setRanged(e.target.value === "range")}>
              <option value="all">{t("Todas")}</option>
              <option value="range">{t("Entre dos fechas")}</option>
            </select>
          </Row>
          {ranged && (
            <div className="flex items-center justify-end gap-2 text-[13px]">
              <DateSelect value={from} onChange={(d) => { setFrom(d); if (d > to) setTo(d); }} weekStartsOn={weekStartsOn} label={t("Desde")} />
              <span className="text-muted">–</span>
              <DateSelect value={to} onChange={(d) => { setTo(d); if (d < from) setFrom(d); }} weekStartsOn={weekStartsOn} label={t("Hasta")} />
            </div>
          )}
          {ranged && (
            <p className="text-[11px] text-muted">
              {t("Las series repetidas que abarcan esas fechas se exportan completas, con su regla.")}
            </p>
          )}
        </>
      ) : (
        <div className="space-y-2 text-[13px]">
          <label className="flex items-center gap-2">
            <input type="radio" className="radio" checked={!ownPassword} onChange={() => setOwnPassword(false)} />
            {t("Cifrar con la contraseña de la aplicación")}
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" className="radio" checked={ownPassword} onChange={() => setOwnPassword(true)} />
            {t("Cifrar con otra contraseña (p. ej. para guardarla fuera)")}
          </label>
          {ownPassword && (
            <div className="grid grid-cols-2 gap-2 pl-6">
              <PasswordInput value={password} onChange={setPassword} placeholder={t("Contraseña (mín. 8)")} />
              <PasswordInput value={confirm} onChange={setConfirm} placeholder={t("Repítela")} />
              {confirm.length > 0 && confirm !== password && (
                <p className="col-span-2 text-[11px] text-danger">{t("Las contraseñas no coinciden.")}</p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <Button size="sm" onClick={() => void run()} disabled={busy || !pwOk}>
          {busy ? t("Exportando…") : isBackup ? t("Elegir carpeta y guardar…") : t("Exportar…")}
        </Button>
      </div>
    </Section>
  );
}
