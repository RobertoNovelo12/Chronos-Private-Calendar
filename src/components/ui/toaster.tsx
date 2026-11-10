import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToastStore } from "@/stores/toastStore";
import { t as tr } from "@/i18n";

export function Toaster() {
  const { toasts, dismiss } = useToastStore();
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            "pointer-events-auto flex max-w-md items-center gap-3 rounded-lg border px-3.5 py-2 text-[13px] shadow-xl",
            t.kind === "error"
              ? "border-danger/40 bg-background text-danger"
              : "border-transparent bg-foreground text-background",
          )}
        >
          <span className="min-w-0 break-words">{t.message}</span>
          {t.action && (
            <button
              className="shrink-0 font-semibold underline-offset-2 hover:underline"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button onClick={() => dismiss(t.id)} aria-label={tr("Cerrar")} className="shrink-0 opacity-60 hover:opacity-100">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
