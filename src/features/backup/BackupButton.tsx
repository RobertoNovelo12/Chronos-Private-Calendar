import { useState } from "react";
import { HardDriveDownload } from "lucide-react";
import { api, errorMessage } from "@/lib/ipc";
import { formatBytes } from "@/lib/utils";

interface Props {
  onMessage: (message: string, kind: "info" | "error") => void;
}

/** Crea una copia cifrada manual en la carpeta local de copias. */
export function BackupButton({ onMessage }: Props) {
  const [busy, setBusy] = useState(false);

  async function createBackup() {
    setBusy(true);
    try {
      const rec = await api.backup.create();
      onMessage(`Copia cifrada creada (${formatBytes(rec.sizeBytes)}): ${rec.fileName}`, "info");
    } catch (e) {
      onMessage(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={createBackup}
      disabled={busy}
      className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] text-muted hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
    >
      <HardDriveDownload className="size-4" />
      {busy ? "Cifrando copia…" : "Crear copia de seguridad"}
    </button>
  );
}
