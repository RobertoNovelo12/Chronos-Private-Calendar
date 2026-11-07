import { useState, type FormEvent } from "react";
import { Eye, EyeOff, Lock, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/ipc";
import { useVaultStore } from "@/stores/vaultStore";

const MIN_LENGTH = 8;

/** Pantalla de primera configuración o de desbloqueo. */
export function UnlockScreen({ mode }: { mode: "setup" | "locked" }) {
  const setup = useVaultStore((s) => s.setup);
  const unlock = useVaultStore((s) => s.unlock);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSetup = mode === "setup";
  const tooShort = isSetup && password.length > 0 && [...password].length < MIN_LENGTH;
  const mismatch = isSetup && confirm.length > 0 && confirm !== password;
  const canSubmit =
    !busy && password.length > 0 && (!isSetup || ([...password].length >= MIN_LENGTH && confirm === password));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      if (isSetup) await setup(password);
      else await unlock(password);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
      return;
    }
    // Se borran las copias de la contraseña en el estado de React.
    setPassword("");
    setConfirm("");
    setBusy(false);
  }

  return (
    <div className="flex h-full items-center justify-center bg-surface">
      <form
        onSubmit={onSubmit}
        className="w-[380px] rounded-2xl border border-border bg-background p-8 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.18)]"
      >
        <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-xl bg-foreground text-background">
          {isSetup ? <ShieldCheck className="size-5" /> : <Lock className="size-5" />}
        </div>
        <h1 className="text-xl font-semibold tracking-tight">
          {isSetup ? "Protege tu calendario" : "Chronos está bloqueado"}
        </h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          {isSetup
            ? "Elige una contraseña. Cifra la base de datos en este equipo. No existe recuperación: si la olvidas, solo podrás volver a tus datos desde una copia de seguridad cuya contraseña recuerdes."
            : "Introduce tu contraseña para descifrar tus datos."}
        </p>

        <div className="mt-6 space-y-3">
          <div className="relative">
            <Input
              type={show ? "text" : "password"}
              autoFocus
              placeholder="Contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              aria-invalid={tooShort}
              className="pr-9"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted hover:text-foreground"
              aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
              tabIndex={-1}
            >
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {isSetup && (
            <Input
              type={show ? "text" : "password"}
              placeholder="Repite la contraseña"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={busy}
              aria-invalid={mismatch}
            />
          )}
          {tooShort && <p className="text-[12px] text-muted">Mínimo {MIN_LENGTH} caracteres.</p>}
          {mismatch && <p className="text-[12px] text-danger">Las contraseñas no coinciden.</p>}
          {error && (
            <p role="alert" className="text-[12px] text-danger">
              {error}
            </p>
          )}
        </div>

        <Button type="submit" size="lg" className="mt-6 w-full" disabled={!canSubmit}>
          {busy ? (isSetup ? "Creando bóveda cifrada…" : "Descifrando…") : isSetup ? "Crear y entrar" : "Desbloquear"}
        </Button>
        <p className="mt-4 text-center text-[11px] text-muted">Sin cuenta · Sin conexión · Tus datos no salen de este equipo</p>
      </form>
    </div>
  );
}
