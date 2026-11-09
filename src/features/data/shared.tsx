import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/ipc";
import { formatBytes } from "@/lib/utils";
import { useCalendarStore } from "@/stores/calendarStore";
import { useEventStore } from "@/stores/eventStore";
import { toast } from "@/stores/toastStore";
import type { BackupInfo, BackupKind } from "@/types/domain";

export const selectCls =
  "h-8 rounded-md bg-control px-2 text-[13px] text-strong focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";

export const KIND_LABEL: Record<BackupKind, string> = {
  manual: "Manual",
  automatic: "Automática",
  pre_restore: "Antes de restaurar",
  pre_update: "Antes de actualizar",
};

/** Vuelve a leer calendarios y eventos tras restaurar o importar. */
export async function reloadData() {
  // Las acciones de deshacer apuntan a datos que pueden haber cambiado.
  useEventStore.setState({ past: [], future: [], draft: null });
  await useCalendarStore.getState().load();
  await useEventStore.getState().reload();
}

export function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-[13px] font-semibold text-strong">{title}</h3>
        {description && <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-4 text-[13px]">
      <span>{label}</span>
      {children}
    </div>
  );
}

export function PasswordInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  id?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="pr-9"
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted hover:text-strong"
        aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
        tabIndex={-1}
      >
        {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </button>
    </div>
  );
}

/** Modal secundario por encima de la configuración. */
export function SubDialog({ title, onClose, children, width = 420 }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="rounded-xl border border-border-strong bg-popover p-5 shadow-2xl"
        style={{ width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function formatIsoDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("es", { dateStyle: "long", timeStyle: "short" });
}

/**
 * Verificar o restaurar una copia. Restaurar reemplaza los datos actuales,
 * por eso exige marcar la confirmación; antes se guarda una copia automática.
 */
export function BackupActionDialog({
  path,
  mode,
  onClose,
  onDone,
}: {
  path: string;
  mode: "verify" | "restore";
  onClose: () => void;
  onDone?: () => void;
}) {
  const [info, setInfo] = useState<BackupInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    api.backup
      .inspect(path)
      .then(setInfo)
      .catch((e) => setInfoError(errorMessage(e)));
    return () => {
      mounted.current = false;
    };
  }, [path]);

  const isRestore = mode === "restore";
  const canSubmit = !busy && !!info && password.length > 0 && (!isRestore || confirmed);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      if (isRestore) {
        const r = await api.backup.restore(path, password, true);
        setPassword("");
        await reloadData();
        toast.info(`Datos restaurados. Los anteriores se guardaron en «${r.preRestoreBackup.fileName}».`);
        onDone?.();
        onClose();
      } else {
        await api.backup.verify(path, password);
        if (mounted.current) {
          setPassword("");
          setVerified(true);
        }
      }
    } catch (err) {
      if (mounted.current) setError(errorMessage(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <SubDialog title={isRestore ? "Restaurar copia de seguridad" : "Verificar copia de seguridad"} onClose={busy ? () => {} : onClose}>
      <form onSubmit={submit} className="mt-3 space-y-3 text-[13px]">
        {infoError ? (
          <p className="rounded-md bg-danger/10 px-3 py-2 text-danger">{infoError}</p>
        ) : info ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-control px-3 py-2 text-[12px]">
            <dt className="text-muted">Archivo</dt>
            <dd className="truncate" title={info.filePath}>{info.fileName}</dd>
            <dt className="text-muted">Creada</dt>
            <dd>{formatIsoDate(info.createdAt)}</dd>
            <dt className="text-muted">Versión</dt>
            <dd>Chronos {info.appVersion} · esquema {info.schemaVersion}</dd>
            <dt className="text-muted">Tamaño</dt>
            <dd>{formatBytes(info.sizeBytes)}</dd>
          </dl>
        ) : (
          <p className="text-muted">Leyendo el archivo…</p>
        )}
        {verified ? (
          <p className="rounded-md bg-control px-3 py-2">
            La copia es íntegra y la contraseña es correcta: se puede restaurar.
          </p>
        ) : (
          <>
            <label className="block space-y-1">
              <span className="text-[12px] text-muted">Contraseña con la que se creó la copia</span>
              <PasswordInput value={password} onChange={setPassword} autoFocus />
            </label>
            {isRestore && (
              <label className="flex items-start gap-2 text-[12px] leading-relaxed">
                <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <span>
                  Entiendo que se <b>reemplazarán todos los datos actuales</b> por los de la copia. Antes se creará una copia
                  automática de los datos actuales.
                </span>
              </label>
            )}
          </>
        )}
        {error && <p className="text-[12px] text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {verified ? "Cerrar" : "Cancelar"}
          </Button>
          {!verified && (
            <Button type="submit" variant={isRestore ? "danger" : "default"} disabled={!canSubmit}>
              {busy ? (isRestore ? "Restaurando…" : "Verificando…") : isRestore ? "Restaurar" : "Verificar"}
            </Button>
          )}
        </div>
      </form>
    </SubDialog>
  );
}
