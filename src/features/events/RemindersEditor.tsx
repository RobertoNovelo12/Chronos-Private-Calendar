import { useRef, useState } from "react";
import { Bell, Plus, X } from "lucide-react";
import { MenuItem, Popover } from "@/components/ui/popover";
import { REMINDER_PRESETS_ALL_DAY, REMINDER_PRESETS_TIMED, describeReminder } from "@/lib/rrule";
import { t } from "@/i18n";

/** Pide permiso de notificaciones al sistema (solo lo requiere macOS). */
async function ensureNotificationPermission() {
  try {
    const { isPermissionGranted, requestPermission } = await import("@tauri-apps/plugin-notification");
    if (!(await isPermissionGranted())) await requestPermission();
  } catch {
    /* sin soporte: el recordatorio se guarda igualmente */
  }
}

export function RemindersEditor({
  reminders,
  allDay,
  onChange,
}: {
  reminders: number[];
  allDay: boolean;
  onChange: (r: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const options = (allDay ? REMINDER_PRESETS_ALL_DAY : REMINDER_PRESETS_TIMED).filter((m) => !reminders.includes(m));

  return (
    <div className="flex min-h-7 items-start gap-1">
      <span className="flex h-7 w-6 shrink-0 items-center justify-center text-muted">
        <Bell className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        {reminders.map((m) => (
          <div key={m} className="group flex h-7 items-center justify-between rounded-md px-1.5 text-[13px] text-strong hover:bg-surface-hover">
            <span>{describeReminder(m, allDay)}</span>
            <button
              className="invisible text-muted hover:text-danger group-hover:visible"
              aria-label={t("Quitar recordatorio")}
              onClick={() => onChange(reminders.filter((x) => x !== m))}
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
        {reminders.length < 10 && (
          <button
            ref={ref}
            onClick={() => setOpen((v) => !v)}
            className="flex h-7 items-center gap-1 rounded-md px-1.5 text-[13px] text-muted hover:bg-surface-hover hover:text-strong"
          >
            {reminders.length === 0 ? t("Recordatorios") : <><Plus className="size-3.5" /> {t("Añadir recordatorio")}</>}
          </button>
        )}
        <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} className="w-[230px]">
          {options.map((m) => (
            <MenuItem
              key={m}
              onClick={() => {
                setOpen(false);
                void ensureNotificationPermission();
                onChange([...reminders, m].sort((a, b) => a - b));
              }}
            >
              {describeReminder(m, allDay)}
            </MenuItem>
          ))}
          {options.length === 0 && <div className="px-2 py-1.5 text-[12px] text-muted">{t("No hay más opciones")}</div>}
        </Popover>
      </div>
    </div>
  );
}
