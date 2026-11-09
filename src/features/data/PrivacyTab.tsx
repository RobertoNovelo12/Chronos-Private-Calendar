import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/ipc";
import { clearClipboard } from "@/features/events/clipboard";
import { useCalendarStore } from "@/stores/calendarStore";
import { useEventStore } from "@/stores/eventStore";
import { toast } from "@/stores/toastStore";
import { useUiStore } from "@/stores/uiStore";
import { useVaultStore } from "@/stores/vaultStore";
import { PasswordInput, Section, SubDialog } from "./shared";

const MIN = 8;

export function PrivacyTab() {
  return (
    <div className="space-y-8">
      <Section
        title="Cómo se protegen tus datos"
        description={
          <>
            La base de datos de este equipo está cifrada por completo con SQLCipher. La clave se deriva de tu contraseña con
            Argon2id y nunca se guarda en claro. Chronos no se conecta a internet ni envía estadísticas. Las exportaciones
            ICS, JSON y CSV <b>no</b> van cifradas: guárdalas en un lugar seguro.
          </>
        }
      >
        {null}
      </Section>
      <ChangePassword />
      <DeleteEverything />
    </div>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = next.length > 0 && [...next].length < MIN;
  const mismatch = confirm.length > 0 && confirm !== next;
  const canSubmit = !busy && current.length > 0 && [...next].length >= MIN && next === confirm;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await api.vault.changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      toast.info("Contraseña cambiada");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Cambiar contraseña"
      description="Los datos no se vuelven a cifrar: se protege de nuevo su clave. Las copias nuevas usarán la contraseña nueva; las copias anteriores se siguen abriendo con la contraseña con la que se crearon."
    >
      <form onSubmit={submit} className="grid max-w-[340px] gap-2">
        <PasswordInput value={current} onChange={setCurrent} placeholder="Contraseña actual" />
        <PasswordInput value={next} onChange={setNext} placeholder={`Nueva contraseña (mín. ${MIN} caracteres)`} />
        <PasswordInput value={confirm} onChange={setConfirm} placeholder="Repite la nueva contraseña" />
        {(tooShort || mismatch || error) && (
          <p className="text-[12px] text-danger">
            {error ?? (tooShort ? `Debe tener al menos ${MIN} caracteres.` : "Las contraseñas no coinciden.")}
          </p>
        )}
        <div>
          <Button type="submit" size="sm" disabled={!canSubmit}>
            {busy ? "Cambiando…" : "Cambiar contraseña"}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function DeleteEverything() {
  const [open, setOpen] = useState(false);
  return (
    <Section
      title="Eliminar todos mis datos"
      description="Borra de este equipo la base de datos cifrada y su almacén de claves. No se puede deshacer."
    >
      <div>
        <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
          Eliminar todos mis datos…
        </Button>
      </div>
      {open && <DeleteDialog onClose={() => setOpen(false)} />}
    </Section>
  );
}

function DeleteDialog({ onClose }: { onClose: () => void }) {
  const [word, setWord] = useState("");
  const [password, setPassword] = useState("");
  const [removeBackups, setRemoveBackups] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSubmit = !busy && word === "ELIMINAR" && password.length > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.data.destroy(password, word, removeBackups);
      setPassword("");
      // No deben quedar datos ni preferencias en la memoria ni en el almacenamiento del WebView.
      useUiStore.getState().reset();
      clearClipboard();
      useCalendarStore.getState().clear();
      useEventStore.getState().clear();
      try {
        for (const k of Object.keys(localStorage)) if (k.startsWith("chronos")) localStorage.removeItem(k);
      } catch {
        /* almacenamiento no disponible */
      }
      if (r.backupsNotRemoved > 0) toast.error(`${r.backupsNotRemoved} copias no se pudieron borrar; elimínalas a mano.`);
      await useVaultStore.getState().refresh();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <SubDialog title="Eliminar todos mis datos" onClose={busy ? () => {} : onClose} width={440}>
      <form onSubmit={submit} className="mt-3 space-y-3 text-[13px]">
        <p className="leading-relaxed text-muted">
          Se borrarán todos los calendarios, eventos y ajustes de este equipo. Sin el almacén de claves, la base de datos
          cifrada no se puede recuperar. Después Chronos empezará de cero.
        </p>
        <label className="flex items-start gap-2 text-[12px] leading-relaxed">
          <input type="checkbox" className="mt-0.5" checked={removeBackups} onChange={(e) => setRemoveBackups(e.target.checked)} />
          <span>
            Borrar también las copias de seguridad registradas en este equipo. Si no lo marcas, podrás restaurarlas más
            tarde con su contraseña.
          </span>
        </label>
        <label className="block space-y-1">
          <span className="text-[12px] text-muted">
            Escribe <b className="text-strong">ELIMINAR</b> para confirmar
          </span>
          <Input value={word} onChange={(e) => setWord(e.target.value)} autoFocus />
        </label>
        <label className="block space-y-1">
          <span className="text-[12px] text-muted">Contraseña</span>
          <PasswordInput value={password} onChange={setPassword} />
        </label>
        {error && <p className="text-[12px] text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" variant="danger" disabled={!canSubmit}>
            {busy ? "Eliminando…" : "Eliminar definitivamente"}
          </Button>
        </div>
      </form>
    </SubDialog>
  );
}
