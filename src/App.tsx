import { useEffect } from "react";
import { AppShell } from "@/features/layout/AppShell";
import { UnlockScreen } from "@/features/security/UnlockScreen";
import { useVaultStore } from "@/stores/vaultStore";

export default function App() {
  const { phase, bootError, refresh } = useVaultStore();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (bootError) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div>
          <p className="font-medium">No se pudo iniciar Chronos</p>
          <p className="mt-1 text-[13px] text-muted">{bootError}</p>
        </div>
      </div>
    );
  }
  if (phase === "loading") return <div className="h-full bg-surface" />;
  if (phase === "setup" || phase === "locked") return <UnlockScreen key={phase} mode={phase} />;
  return <AppShell />;
}
