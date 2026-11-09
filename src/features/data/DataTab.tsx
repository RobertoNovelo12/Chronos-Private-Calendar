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

type ExportFormat = ExportKind | "backup";

const FORMAT_HELP: Record<ExportFormat, string> = {
  ics: "iCalendar (.ics): para Google Calendar, Outlook, Apple Calendar y otras apps. Incluye repeticiones y recordatorios.",
  json: "JSON de Chronos: copia legible y completa para volver a importarla aquí. No está cifrada.",
  csv: "CSV para hojas de cálculo. Solo exportación; no está cifrado.",
  backup: "Copia completa cifrada (.chronosbak). Es la única exportación protegida con contraseña.",
};

function plural(n: number, one: string, many: string) {
  return `${n.toLocaleString("es")} ${n === 1 ? one : many}`;
}

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
      title="Importar"
      description="Archivos .ics (de Google, Outlook, Apple…) o .json exportados por Chronos. Los eventos que ya existen (mismo identificador) no se duplican. Una copia .chronosbak se restaura."
    >
      {!preview ? (
        <Button variant="secondary" size="sm" onClick={() => void pick()}>
          <FileUp /> Elegir archivo…
        </Button>
      ) : (
        <div className="space-y-3 rounded-lg border border-border p-3 text-[13px]">
          <div>
            <div className="truncate font-medium text-strong" title={preview.path}>
              {preview.fileName}
            </div>
            <div className="text-[12px] text-muted">
              {plural(preview.events, "evento", "eventos")}
              {preview.calendars.length > 0 && ` · ${plural(preview.calendars.length, "calendario", "calendarios")}`}
              {preview.rulesDropped > 0 &&
                ` · ${plural(preview.rulesDropped, "regla de repetición no compatible", "reglas de repetición no compatibles")} (se importarán como eventos únicos)`}
            </div>
          </div>
          <Row label="Importar en">
            <select className={`${selectCls} max-w-[260px]`} value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="__new">{`Calendario «${fileCalendars}»`}</option>
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Row>
          {target === "__new" && (
            <p className="text-[11px] text-muted">Si ya tienes un calendario con ese nombre, se usa ese; si no, se crea.</p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPreview(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button size="sm" onClick={() => void apply()} disabled={busy || preview.events === 0}>
              {busy ? "Importando…" : `Importar ${plural(preview.events, "evento", "eventos")}`}
            </Button>
          </div>
        </div>
      )}
      {report && (
        <p className="rounded-md bg-control px-3 py-2 text-[12px] leading-relaxed">
          Importación completada: {plural(report.imported, "elemento importado", "elementos importados")}
          {report.duplicates > 0 && `, ${plural(report.duplicates, "ya existía", "ya existían")}`}
          {report.skipped > 0 && `, ${plural(report.skipped, "descartado (cancelado o no válido)", "descartados (cancelados o no válidos)")}`}
          {report.rulesDropped > 0 && `, ${plural(report.rulesDropped, "repetición no compatible", "repeticiones no compatibles")}`}
          {report.calendarsCreated > 0 && `. ${plural(report.calendarsCreated, "calendario nuevo", "calendarios nuevos")}`}.
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
          toast.info(`Copia cifrada guardada (${formatBytes(rec.sizeBytes)})`);
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
      if (r) toast.info(`${plural(r.events, "elemento exportado", "elementos exportados")}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Exportar">
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
            {f === "backup" ? "Copia cifrada" : f.toUpperCase()}
          </button>
        ))}
      </div>
      <p className="text-[12px] leading-relaxed text-muted">{FORMAT_HELP[format]}</p>

      {!isBackup ? (
        <>
          <Row label="Calendarios">
            <select className={`${selectCls} max-w-[260px]`} value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>
              <option value="__all">Todos</option>
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Fechas">
            <select className={selectCls} value={ranged ? "range" : "all"} onChange={(e) => setRanged(e.target.value === "range")}>
              <option value="all">Todas</option>
              <option value="range">Entre dos fechas</option>
            </select>
          </Row>
          {ranged && (
            <div className="flex items-center justify-end gap-2 text-[13px]">
              <DateSelect value={from} onChange={(d) => { setFrom(d); if (d > to) setTo(d); }} weekStartsOn={weekStartsOn} label="Desde" />
              <span className="text-muted">–</span>
              <DateSelect value={to} onChange={(d) => { setTo(d); if (d < from) setFrom(d); }} weekStartsOn={weekStartsOn} label="Hasta" />
            </div>
          )}
          {ranged && (
            <p className="text-[11px] text-muted">
              Las series repetidas que abarcan esas fechas se exportan completas, con su regla.
            </p>
          )}
        </>
      ) : (
        <div className="space-y-2 text-[13px]">
          <label className="flex items-center gap-2">
            <input type="radio" className="radio" checked={!ownPassword} onChange={() => setOwnPassword(false)} />
            Cifrar con la contraseña de la aplicación
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" className="radio" checked={ownPassword} onChange={() => setOwnPassword(true)} />
            Cifrar con otra contraseña (p. ej. para guardarla fuera)
          </label>
          {ownPassword && (
            <div className="grid grid-cols-2 gap-2 pl-6">
              <PasswordInput value={password} onChange={setPassword} placeholder="Contraseña (mín. 8)" />
              <PasswordInput value={confirm} onChange={setConfirm} placeholder="Repítela" />
              {confirm.length > 0 && confirm !== password && (
                <p className="col-span-2 text-[11px] text-danger">Las contraseñas no coinciden.</p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <Button size="sm" onClick={() => void run()} disabled={busy || !pwOk}>
          {busy ? "Exportando…" : isBackup ? "Elegir carpeta y guardar…" : "Exportar…"}
        </Button>
      </div>
    </Section>
  );
}
