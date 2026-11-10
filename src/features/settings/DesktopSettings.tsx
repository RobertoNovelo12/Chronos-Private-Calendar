import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { PasswordInput, Section } from "@/features/data/shared";
import { api, errorMessage } from "@/lib/ipc";
import { toast } from "@/stores/toastStore";
import type { DesktopInfo, DesktopPatch } from "@/types/domain";
import { t } from "@/i18n";

/** Estado de los ajustes de escritorio (se leen de Rust; no van en localStorage). */
function useDesktopInfo() {
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  useEffect(() => {
    api.desktop
      .get()
      .then(setInfo)
      .catch((e) => toast.error(errorMessage(e)));
  }, []);
  async function change(patch: DesktopPatch) {
    if (!info) return;
    setInfo({ ...info, ...patch });
    try {
      setInfo(await api.desktop.set(patch));
    } catch (e) {
      toast.error(errorMessage(e));
      setInfo(await api.desktop.get().catch(() => info));
    }
  }
  return { info, setInfo, change };
}

function Check({
  checked,
  disabled,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className={`flex items-start gap-2.5 ${disabled ? "opacity-50" : ""}`}>
      <input type="checkbox" className="mt-[3px]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block">{label}</span>
        {hint && <span className="block text-[12px] leading-relaxed text-muted">{hint}</span>}
      </span>
    </label>
  );
}

/** Configuración → General: bandeja e inicio con el sistema. */
export function DesktopSection() {
  const { info, change } = useDesktopInfo();
  if (!info) return null;
  return (
    <fieldset className="space-y-2.5">
      <legend className="pb-1.5">{t("Ventana y sistema")}</legend>
      <Check
        checked={info.closeToTray}
        onChange={(v) => void change({ closeToTray: v })}
        label={t("Al cerrar la ventana, mantener Chronos en la bandeja del sistema")}
        hint={t("Sigue abierto junto al reloj, sin ocupar la barra de tareas, y los recordatorios siguen avisando. Para salir del todo, usa «Salir» en el icono de la bandeja.")}
      />
      <Check
        checked={info.autostart}
        onChange={(v) => void change({ autostart: v })}
        label={t("Abrir Chronos al iniciar sesión en el equipo")}
      />
      <Check
        checked={info.startMinimized}
        disabled={!info.autostart}
        onChange={(v) => void change({ startMinimized: v })}
        label={t("Al iniciar con el equipo, empezar minimizado en la bandeja")}
      />
    </fieldset>
  );
}

/** Configuración → Privacidad: recordar el desbloqueo en este equipo. */
export function RememberUnlockSection() {
  const { info, setInfo } = useDesktopInfo();
  const [password, setPassword] = useState("");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!info?.rememberSupported) return null;

  async function enable(e: FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.desktop.rememberEnable(password);
      setPassword("");
      setAsking(false);
      setInfo(await api.desktop.get());
      toast.info(t("Chronos se abrirá sin pedir la contraseña en este equipo"));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    try {
      await api.desktop.rememberDisable();
      setInfo(await api.desktop.get());
      toast.info(t("Se volverá a pedir la contraseña al abrir Chronos"));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Section
      title={t("Recordar el desbloqueo en este equipo")}
      description={t(
        "Chronos se abre sin pedir la contraseña: la clave se guarda en el almacén de credenciales del sistema (Administrador de credenciales de Windows o Llavero de macOS), protegido por tu cuenta del equipo. Bloquear a mano o por inactividad seguirá pidiendo la contraseña. Actívalo solo si nadie más usa tu cuenta del equipo: cualquier programa que se ejecute con tu usuario podría leer esa credencial.",
      )}
    >
      {info.rememberEnabled ? (
        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          <span className="text-strong">{t("Activado en este equipo.")}</span>
          <Button variant="secondary" size="sm" onClick={() => void disable()}>
            {t("Desactivar")}
          </Button>
        </div>
      ) : asking ? (
        <form onSubmit={enable} className="grid max-w-[340px] gap-2">
          <PasswordInput value={password} onChange={setPassword} placeholder={t("Tu contraseña, para confirmar")} autoFocus />
          {error && <p className="text-[12px] text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={!password || busy}>
              {busy ? t("Comprobando…") : t("Activar")}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => (setAsking(false), setPassword(""), setError(null))}>
              {t("Cancelar")}
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <Button variant="secondary" size="sm" onClick={() => setAsking(true)}>
            {t("Activar…")}
          </Button>
        </div>
      )}
    </Section>
  );
}
