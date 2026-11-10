import { useRef, useState, type FormEvent } from "react";
import { Crown, MoreHorizontal, Plus, Users, X } from "lucide-react";
import { MenuItem, Popover } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Attendee, AttendeeRole, AttendeeStatus } from "@/types/domain";
import { msg, t, tp } from "@/i18n";

const STATUS: { value: AttendeeStatus; label: string; dot: string; count: (n: number) => string }[] = [
  { value: "needs_action", label: msg("Pendiente"), dot: "bg-faint", count: (n) => tp(n, "{n} pendiente", "{n} pendientes") },
  { value: "accepted", label: msg("Acepta"), dot: "bg-[#27ae60]", count: (n) => tp(n, "{n} acepta", "{n} aceptan") },
  { value: "tentative", label: msg("Quizá"), dot: "bg-[#f2994a]", count: (n) => tp(n, "{n} quizá", "{n} quizá") },
  { value: "declined", label: msg("Rechaza"), dot: "bg-danger", count: (n) => tp(n, "{n} rechaza", "{n} rechazan") },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Participantes del evento: solo una lista para ti, sin invitaciones. */
export function AttendeesEditor({ value, onChange }: { value: Attendee[]; onChange: (list: Attendee[]) => void }) {
  const [adding, setAdding] = useState(false);
  const hasOrganizer = value.some((a) => a.role === "organizer");

  function patch(i: number, p: Partial<Attendee>) {
    onChange(value.map((a, j) => (j === i ? { ...a, ...p } : a)));
  }

  const counts = STATUS.map((s) => ({ ...s, n: value.filter((a) => a.status === s.value).length })).filter((s) => s.n > 0);

  return (
    <section className="px-3 py-2">
      <div className="flex min-h-7 items-start gap-1">
        <span className="flex h-7 w-6 shrink-0 items-center justify-center text-muted">
          <Users className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          {value.length > 0 && (
            <div className="flex h-7 items-center gap-2 px-1.5 text-[12px] text-muted">
              <span className="font-medium text-strong">{tp(value.length, "{n} participante", "{n} participantes")}</span>
              {counts.map((c) => (
                <span key={c.value} className="flex items-center gap-1">
                  <span className={cn("size-1.5 rounded-full", c.dot)} />
                  {c.count(c.n)}
                </span>
              ))}
            </div>
          )}
          {value.map((a, i) => (
            <AttendeeRow
              key={`${a.email}-${a.name}-${i}`}
              attendee={a}
              canBeOrganizer={!hasOrganizer || a.role === "organizer"}
              onChange={(p) => patch(i, p)}
              onRemove={() => onChange(value.filter((_, j) => j !== i))}
            />
          ))}
          {adding ? (
            <AddForm
              existing={value}
              onCancel={() => setAdding(false)}
              onAdd={(a) => {
                onChange([...value, a]);
                setAdding(false);
              }}
            />
          ) : (
            value.length < 100 && (
              <button
                onClick={() => setAdding(true)}
                className="flex h-7 items-center gap-1 rounded-md px-1.5 text-[13px] text-muted hover:bg-surface-hover hover:text-strong"
              >
                {value.length === 0 ? t("Participantes") : <><Plus className="size-3.5" /> {t("Añadir participante")}</>}
              </button>
            )
          )}
          {(adding || value.length > 0) && (
            <p className="px-1.5 pb-1 text-[11px] text-faint">{t("Solo para tu referencia: Chronos no envía invitaciones ni correos.")}</p>
          )}
        </div>
      </div>
    </section>
  );
}

function AttendeeRow({
  attendee: a,
  canBeOrganizer,
  onChange,
  onRemove,
}: {
  attendee: Attendee;
  canBeOrganizer: boolean;
  onChange: (p: Partial<Attendee>) => void;
  onRemove: () => void;
}) {
  const status = STATUS.find((s) => s.value === a.status) ?? STATUS[0]!;
  const initials = (a.name || a.email).trim().slice(0, 1).toUpperCase();
  return (
    <div className="group flex min-h-8 items-center gap-2 rounded-md px-1.5 py-0.5 hover:bg-surface-hover">
      <span className="relative flex size-6 shrink-0 items-center justify-center rounded-full bg-control text-[11px] font-semibold text-muted">
        {initials}
        <span className={cn("absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-surface", status.dot)} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 truncate text-[13px] text-strong">
          <span className="truncate">{a.name || a.email}</span>
          {a.role === "organizer" && <Crown className="size-3 shrink-0 text-muted" aria-label={t("Organizador")} />}
          {a.role === "optional" && <span className="shrink-0 text-[11px] text-muted">{t("(opcional)")}</span>}
        </span>
        <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted">
          {a.name && a.email && <span className="min-w-0 select-text truncate">{a.email}</span>}
          {a.name && a.email && <span aria-hidden>·</span>}
          <select
            value={a.status}
            onChange={(e) => onChange({ status: e.target.value as AttendeeStatus })}
            className="-mx-0.5 h-4 shrink-0 cursor-pointer appearance-none rounded px-0.5 text-[11px] text-muted hover:bg-border-strong hover:text-strong focus:outline-none"
            aria-label={t("Respuesta de {name}", { name: a.name || a.email })}
          >
            {STATUS.map((s) => (
              <option key={s.value} value={s.value}>
                {t(s.label)}
              </option>
            ))}
          </select>
        </span>
      </span>
      <RoleMenu attendee={a} canBeOrganizer={canBeOrganizer} onChange={(role) => onChange({ role })} />
      <button className="hidden shrink-0 text-muted hover:text-danger group-hover:block" aria-label={t("Quitar participante")} onClick={onRemove}>
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function RoleMenu({
  attendee: a,
  canBeOrganizer,
  onChange,
}: {
  attendee: Attendee;
  canBeOrganizer: boolean;
  onChange: (role: AttendeeRole) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const options: { role: AttendeeRole; label: string }[] = [
    { role: "required", label: t("Obligatorio") },
    { role: "optional", label: t("Opcional") },
    ...(canBeOrganizer ? [{ role: "organizer" as const, label: t("Organizador") }] : []),
  ];
  return (
    <>
      <button
        ref={ref}
        onClick={() => setOpen((v) => !v)}
        className={cn("hidden size-5 shrink-0 items-center justify-center rounded text-muted hover:bg-border-strong hover:text-strong group-hover:flex", open && "flex")}
        aria-label={t("Papel de {name}", { name: a.name || a.email })}
        title={t("Papel")}
      >
        <MoreHorizontal className="size-3.5" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} align="end" className="min-w-[160px]">
        {options.map((o) => (
          <MenuItem
            key={o.role}
            onClick={() => {
              setOpen(false);
              onChange(o.role);
            }}
          >
            <span className={cn("flex-1", a.role === o.role && "font-semibold")}>{o.label}</span>
          </MenuItem>
        ))}
      </Popover>
    </>
  );
}

function AddForm({ existing, onAdd, onCancel }: { existing: Attendee[]; onAdd: (a: Attendee) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [optional, setOptional] = useState(false);
  const mail = email.trim().toLowerCase();
  const badEmail = mail.length > 0 && !EMAIL_RE.test(mail);
  const duplicate = mail.length > 0 && existing.some((a) => a.email === mail);
  const valid = (name.trim() || mail) && !badEmail && !duplicate;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    onAdd({ name: name.trim(), email: mail, role: optional ? "optional" : "required", status: "needs_action" });
  }

  return (
    <form onSubmit={submit} onKeyDown={(e) => e.key === "Escape" && onCancel()} className="space-y-1.5 py-1 pl-1.5">
      <Input autoFocus value={name} maxLength={200} placeholder={t("Nombre")} className="h-8" onChange={(e) => setName(e.target.value)} />
      <Input
        value={email}
        maxLength={320}
        placeholder={t("correo@ejemplo.com (opcional)")}
        className={cn("h-8", (badEmail || duplicate) && "ring-2 ring-danger")}
        onChange={(e) => setEmail(e.target.value)}
      />
      {(badEmail || duplicate) && (
        <p className="text-[11px] text-danger">{duplicate ? t("Ese correo ya está en la lista") : t("Revisa el correo")}</p>
      )}
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          <input type="checkbox" checked={optional} onChange={(e) => setOptional(e.target.checked)} className="accent-[var(--accent)]" />
          {t("Opcional")}
        </label>
        <div className="flex gap-1.5">
          <Button variant="ghost" size="sm" type="button" onClick={onCancel}>
            {t("Cancelar")}
          </Button>
          <Button size="sm" type="submit" disabled={!valid}>
            {t("Añadir")}
          </Button>
        </div>
      </div>
    </form>
  );
}
