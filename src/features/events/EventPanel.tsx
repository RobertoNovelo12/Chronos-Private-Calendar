import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, differenceInCalendarDays, startOfDay } from "date-fns";
import { AlertTriangle, ArrowRight, ChevronDown, Clock, Copy, Globe, Link2, MapPin, PanelRight, Palette, Plus, Repeat, Trash2, X } from "lucide-react";
import { TimeZonePicker } from "@/components/ui/timezone-picker";
import { cityName, formatOffsetShort, instantFromWall, localWall, offsetMinutes } from "@/lib/timezones";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateSelect, TimeSelect } from "@/components/ui/pickers";
import { MenuItem, MenuSeparator, Popover } from "@/components/ui/popover";
import { CALENDAR_COLORS } from "@/features/calendars/CalendarList";
import { useCalendarMap, useVisibleEvents } from "@/hooks/useCalendarData";
import { DAY_MS, MINUTE_MS, eventEnd, eventStart, formatDuration, localToAllDay, systemTimeZone } from "@/lib/dates";
import { eventColor } from "@/lib/layout";
import { cn } from "@/lib/utils";
import { useCalendarStore } from "@/stores/calendarStore";
import { DRAFT_ID, useEventStore, useSelectedEvent } from "@/stores/eventStore";
import { usePrefsStore, workStartMinutes } from "@/stores/prefsStore";
import { useUiStore } from "@/stores/uiStore";
import type { Availability, CalendarEvent, EventLink, EventPatch, Visibility } from "@/types/domain";
import { duplicateEvent, updateEvent } from "./actions";
import { LabelsEditor } from "@/features/labels/LabelsEditor";
import { AttendeesEditor } from "./AttendeesEditor";
import { RemindersEditor } from "./RemindersEditor";
import { RepeatPicker } from "./RepeatPicker";
import { msg, t } from "@/i18n";

const AVAILABILITY: { value: Availability; label: string }[] = [
  { value: "busy", label: msg("Ocupado") },
  { value: "free", label: msg("Libre") },
  { value: "tentative", label: msg("Provisional") },
  { value: "out_of_office", label: msg("Fuera de la oficina") },
];

const VISIBILITY: { value: Visibility; label: string }[] = [
  { value: "default", label: msg("Visibilidad predeterminada") },
  { value: "public", label: msg("Pública") },
  { value: "private", label: msg("Privada") },
  { value: "confidential", label: msg("Confidencial") },
];

const inlineSelect =
  "h-7 max-w-full cursor-pointer appearance-none rounded-md px-1.5 text-[13px] text-strong hover:bg-surface-hover focus:outline-none focus:ring-2 focus:ring-ring";

/** Detalles del evento seleccionado. Cada cambio se guarda automáticamente en la base cifrada. */
export function EventPanel({ floating = false }: { floating?: boolean }) {
  const selectedId = useUiStore((s) => s.selectedEventId);
  const panelKey = useUiStore((s) => s.panelKey);
  const event = useSelectedEvent(selectedId);
  const loading = useEventStore((s) => s.loading);
  const select = useUiStore((s) => s.select);
  const seen = useRef(false);

  // Si el evento deja de existir (deshacer, borrado), se cierra el panel. Si aún
  // no se ha visto (p. ej. abierto desde el buscador), se espera a que cargue.
  useEffect(() => {
    if (event) seen.current = true;
    else if (selectedId && seen.current && !loading) {
      seen.current = false;
      select(null);
    }
  }, [selectedId, event, loading, select]);

  if (!event) return null;
  return <PanelBody key={panelKey ?? event.id} event={event} floating={floating} />;
}

function Divider() {
  return <div className="mx-3 border-t border-border" />;
}

function PanelBody({ event, floating }: { event: CalendarEvent; floating: boolean }) {
  const calendars = useCalendarStore((s) => s.calendars);
  const calendarMap = useCalendarMap();
  const visibleEvents = useVisibleEvents();
  const { select, askDelete } = useUiStore();
  const focusTitle = useUiStore((s) => s.focusTitle);
  const { workHours, defaultDurationMin, weekStartsOn } = usePrefsStore();

  const [title, setTitle] = useState(event.title);
  const [location, setLocation] = useState(event.location);
  const [description, setDescription] = useState(event.description);
  const [menu, setMenu] = useState(false);
  const [colorsOpen, setColorsOpen] = useState(false);
  const [tzOpen, setTzOpen] = useState(false);
  const tzRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const colorRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const savedTitle = useRef(event.title);

  useEffect(() => {
    if (focusTitle) titleRef.current?.focus();
  }, [focusTitle]);

  const isDraft = event.id === DRAFT_ID;

  // Guardado automático del título tras una pausa al escribir. En eventos
  // repetidos se guarda al salir del campo (para preguntar el alcance una vez).
  useEffect(() => {
    if (title === savedTitle.current || event.isRecurring) return;
    if (isDraft && !title.trim()) return;
    const t = setTimeout(() => void commit({ title }), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title]);

  async function commit(patch: EventPatch) {
    const touchesTitle = patch.title !== undefined;
    if (touchesTitle && patch.title === savedTitle.current) return;
    // Un borrador no se guarda solo por pulsar en el título vacío.
    if (isDraft && touchesTitle && Object.keys(patch).length === 1 && !patch.title!.trim()) return;
    const previous = savedTitle.current;
    if (touchesTitle) savedTitle.current = patch.title!;
    const result = await updateEvent(event.id, patch);
    if (!result && touchesTitle) {
      // Cancelado (p. ej. en el diálogo de alcance): se vuelve al título guardado.
      savedTitle.current = previous;
      setTitle(previous);
    }
  }

  const calendar = calendarMap.get(event.calendarId);
  const color = eventColor(event, calendar?.color);
  const start = eventStart(event);
  const end = eventEnd(event);
  const lastDay = event.isAllDay ? addDays(end, -1) : end;
  const multiDay = event.isAllDay ? differenceInCalendarDays(end, start) > 1 : differenceInCalendarDays(end, start) > 0 && end.getTime() !== startOfDay(end).getTime();

  const conflicts = useMemo(() => {
    if (event.isAllDay || event.availability === "free") return [];
    return visibleEvents.filter(
      (o) => o.id !== event.id && !o.isAllDay && o.availability !== "free" && o.startAt < event.endAt && o.endAt > event.startAt,
    );
  }, [visibleEvents, event]);

  // ---- Fechas y horas ----
  function setStartTime(d: Date) {
    // Mover el inicio conserva la duración.
    commit({ startAt: d.getTime(), endAt: d.getTime() + (event.endAt - event.startAt) });
  }
  function setEndTime(d: Date) {
    if (d.getTime() > event.startAt) commit({ endAt: d.getTime() });
  }
  function setStartDate(day: Date) {
    if (event.isAllDay) {
      const days = Math.max(1, Math.round((event.endAt - event.startAt) / DAY_MS));
      const startAt = localToAllDay(day);
      commit({ startAt, endAt: startAt + days * DAY_MS });
    } else {
      const s = new Date(day);
      s.setHours(start.getHours(), start.getMinutes(), 0, 0);
      commit({ startAt: s.getTime(), endAt: s.getTime() + (event.endAt - event.startAt) });
    }
  }
  function setEndDate(day: Date) {
    if (event.isAllDay) {
      const endAt = localToAllDay(addDays(day, 1));
      if (endAt > event.startAt) commit({ endAt });
    } else {
      const e = new Date(day);
      e.setHours(end.getHours(), end.getMinutes(), 0, 0);
      if (e.getTime() > event.startAt) commit({ endAt: e.getTime() });
    }
  }
  // Las opciones se muestran como filas cuando alguna está en uso.
  const expanded = event.isAllDay || !!event.recurrence || event.timezone !== systemTimeZone();

  /** Cambia la zona del evento conservando la hora de reloj que se ve. */
  function changeTimeZone(tz: string) {
    if (tz === event.timezone || event.isAllDay) return;
    const startAt = instantFromWall(localWall(event.startAt), tz);
    void commit({ timezone: tz, startAt, endAt: startAt + (event.endAt - event.startAt) });
  }

  function toggleAllDay() {
    if (!event.isAllDay) {
      const s = startOfDay(start);
      const lastIncluded = new Date(Math.max(end.getTime() - 1, start.getTime()));
      const days = Math.max(1, differenceInCalendarDays(lastIncluded, s) + 1);
      const startAt = localToAllDay(s);
      commit({ isAllDay: true, startAt, endAt: startAt + days * DAY_MS });
    } else {
      const s = new Date(start);
      s.setHours(0, workStartMinutes(workHours, s), 0, 0);
      commit({ isAllDay: false, startAt: s.getTime(), endAt: s.getTime() + defaultDurationMin * MINUTE_MS });
    }
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      aria-label={t("Detalles del evento")}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !(e.target instanceof HTMLSelectElement)) {
          (document.activeElement as HTMLElement | null)?.blur();
          select(null);
        }
      }}
    >
      <div className="flex h-11 shrink-0 items-center justify-between px-3">
        <button
          ref={menuRef}
          onClick={() => setMenu((v) => !v)}
          className="flex h-7 items-center gap-1 rounded-md px-1.5 text-[13px] font-semibold text-strong hover:bg-surface-hover"
        >
          {isDraft ? t("Evento nuevo") : t("Evento")} <ChevronDown className="size-3.5 text-muted" />
        </button>
        <div className="flex items-center">
          {floating && (
            <Button
              variant="ghost"
              size="icon"
              title={t("Abrir en el panel lateral")}
              aria-label={t("Abrir en el panel lateral")}
              onClick={() => usePrefsStore.getState().set({ rightPanelOpen: true })}
            >
              <PanelRight />
            </Button>
          )}
          <Button variant="ghost" size="icon" title={t("Cerrar (Esc)")} aria-label={t("Cerrar")} onClick={() => select(null)}>
            <X />
          </Button>
        </div>
        <Popover open={menu} onClose={() => setMenu(false)} anchorRef={menuRef} className="w-[200px]">
          {!isDraft && (
            <>
              <MenuItem
                hint={t("Ctrl+D")}
                onClick={() => {
                  setMenu(false);
                  void duplicateEvent(event.id);
                }}
              >
                <Copy className="size-3.5 text-muted" /> {t("Duplicar")}
              </MenuItem>
              <MenuSeparator />
            </>
          )}
          <MenuItem
            danger
            hint={t("Supr")}
            onClick={() => {
              setMenu(false);
              askDelete(event.id);
            }}
          >
            <Trash2 className="size-3.5" /> {isDraft ? t("Descartar") : t("Eliminar")}
          </MenuItem>
        </Popover>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <div className="px-3 pb-3 pt-1.5">
          <textarea
            ref={titleRef}
            value={title}
            rows={1}
            maxLength={1000}
            placeholder={t("Título")}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => commit({ title })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit({ title });
                e.currentTarget.blur();
              }
            }}
            className="field-sizing-content w-full resize-none rounded-md bg-control/60 px-2 py-1.5 text-[15px] font-semibold leading-snug text-strong placeholder:font-normal placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <Divider />

        {/* Fecha y hora */}
        <section className="space-y-0.5 px-3 py-2.5">
          <Row icon={<Clock className="size-4" />}>
            {event.isAllDay ? (
              <>
                <DateSelect value={start} onChange={setStartDate} weekStartsOn={weekStartsOn} label={t("Fecha de inicio")} />
                <ArrowRight className="size-3.5 shrink-0 text-faint" />
                <DateSelect value={lastDay} onChange={setEndDate} weekStartsOn={weekStartsOn} label={t("Fecha de fin")} />
                <span className="ml-1 truncate text-[12px] text-muted">{formatDuration(event.endAt - event.startAt)}</span>
              </>
            ) : (
              <>
                <TimeSelect value={start} onChange={setStartTime} label={t("Hora de inicio")} />
                <ArrowRight className="size-3.5 shrink-0 text-faint" />
                <TimeSelect value={end} onChange={setEndTime} durationFrom={multiDay ? undefined : start} label={t("Hora de fin")} />
                <span className="ml-1 truncate text-[12px] text-muted">{formatDuration(event.endAt - event.startAt)}</span>
              </>
            )}
          </Row>
          {!event.isAllDay && (
            <Row>
              <DateSelect value={start} onChange={setStartDate} weekStartsOn={weekStartsOn} label={t("Fecha de inicio")} />
              {multiDay && (
                <>
                  <ArrowRight className="size-3.5 shrink-0 text-faint" />
                  <DateSelect value={end} onChange={setEndDate} weekStartsOn={weekStartsOn} label={t("Fecha de fin")} />
                </>
              )}
            </Row>
          )}
          {expanded ? (
            <>
              <Row icon={<Switch on={event.isAllDay} onToggle={toggleAllDay} label={t("Todo el día")} />}>
                <button onClick={toggleAllDay} className="h-7 rounded-md px-1.5 text-[13px] text-strong hover:bg-surface-hover">
                  {t("Todo el día")}
                </button>
              </Row>
              {!event.isAllDay && (
                <Row icon={<Globe className="size-4" />}>
                  <button
                    ref={tzRef}
                    onClick={() => setTzOpen((v) => !v)}
                    className="flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[13px] text-strong hover:bg-surface-hover"
                    title={event.timezone}
                  >
                    <span className="text-muted">{formatOffsetShort(offsetMinutes(event.timezone, event.startAt))}</span>
                    {cityName(event.timezone)}
                  </button>
                </Row>
              )}
              <Row icon={<Repeat className="size-4" />}>
                <RepeatPicker
                  variant="row"
                  rule={event.recurrence}
                  start={start}
                  allDay={event.isAllDay}
                  weekStartsOn={weekStartsOn}
                  onChange={(r) => void commit({ recurrence: r })}
                />
              </Row>
            </>
          ) : (
            <Row>
              <button onClick={toggleAllDay} className="h-7 rounded-md px-1.5 text-[13px] text-muted hover:bg-surface-hover hover:text-strong">
                {t("Todo el día")}
              </button>
              <button
                ref={tzRef}
                onClick={() => setTzOpen((v) => !v)}
                className="h-7 rounded-md px-1.5 text-[13px] text-muted hover:bg-surface-hover hover:text-strong"
              >
                {t("Zona horaria")}
              </button>
              <RepeatPicker
                variant="chip"
                rule={null}
                start={start}
                allDay={event.isAllDay}
                weekStartsOn={weekStartsOn}
                onChange={(r) => void commit({ recurrence: r })}
              />
            </Row>
          )}
          <TimeZonePicker open={tzOpen} onClose={() => setTzOpen(false)} anchorRef={tzRef} selected={event.timezone} onSelect={changeTimeZone} />
          {conflicts.length > 0 && (
            <div className="ml-7 mt-1 flex gap-2 rounded-md bg-control/60 px-2.5 py-2 text-[12px] text-foreground">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[#e3a008]" />
              <span>
                {conflicts.length === 1 ? t("Coincide con otro evento:") : t("Coincide con {n} eventos:", { n: conflicts.length })}{" "}
                <span className="text-muted">{conflicts.slice(0, 3).map((c) => c.title || t("Sin título")).join(", ")}</span>
              </span>
            </div>
          )}
        </section>
        <Divider />

        <section className="px-3 py-2">
          <Row icon={<MapPin className="size-4" />}>
            <input
              value={location}
              maxLength={1000}
              placeholder={t("Ubicación")}
              spellCheck={false}
              onChange={(e) => setLocation(e.target.value)}
              onBlur={() => location !== event.location && commit({ location })}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              className="h-7 w-full rounded-md bg-transparent px-1.5 text-[13px] text-strong placeholder:text-muted hover:bg-surface-hover focus:bg-surface-hover focus:outline-none"
            />
          </Row>
        </section>
        <Divider />

        <LinksEditor links={event.links} onChange={(links) => commit({ links })} />
        <AttendeesEditor value={event.attendees} onChange={(attendees) => void commit({ attendees })} />
        <Divider />

        <section className="px-3 py-2">
          <textarea
            value={description}
            rows={3}
            maxLength={50000}
            placeholder={t("Descripción")}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => description !== event.description && commit({ description })}
            className="field-sizing-content min-h-[60px] w-full resize-none rounded-md bg-transparent px-1.5 py-1 text-[13px] leading-relaxed text-strong placeholder:text-muted hover:bg-surface-hover focus:bg-surface-hover focus:outline-none"
          />
        </section>
        <Divider />

        <section className="space-y-0.5 px-3 py-2.5">
          <Row icon={<span className="block size-3.5 rounded-[4px]" style={{ background: color }} />}>
            <select value={event.calendarId} onChange={(e) => commit({ calendarId: e.target.value })} className={cn(inlineSelect, "font-medium")} aria-label={t("Calendario")}>
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Row>
          <Row>
            <select value={event.availability} onChange={(e) => commit({ availability: e.target.value as Availability })} className={inlineSelect} aria-label={t("Disponibilidad")}>
              {AVAILABILITY.map((a) => (
                <option key={a.value} value={a.value}>
                  {t(a.label)}
                </option>
              ))}
            </select>
            <select value={event.visibility} onChange={(e) => commit({ visibility: e.target.value as Visibility })} className={cn(inlineSelect, "min-w-0")} aria-label={t("Visibilidad")}>
              {VISIBILITY.map((v) => (
                <option key={v.value} value={v.value}>
                  {t(v.label)}
                </option>
              ))}
            </select>
          </Row>
          <RemindersEditor reminders={event.reminders} allDay={event.isAllDay} onChange={(reminders) => void commit({ reminders })} />
          <LabelsEditor value={event.labels} onChange={(labels) => void commit({ labels })} />
          <Row icon={<Palette className="size-4" />}>
            <button
              ref={colorRef}
              onClick={() => setColorsOpen((v) => !v)}
              className="flex h-7 items-center gap-2 rounded-md px-1.5 text-[13px] text-strong hover:bg-surface-hover"
            >
              <span className="size-3 rounded-full" style={{ background: color }} />
              {event.color ? t("Color propio") : t("Color del calendario")}
            </button>
            <Popover open={colorsOpen} onClose={() => setColorsOpen(false)} anchorRef={colorRef} className="w-[204px] p-2">
              <button
                onClick={() => {
                  commit({ color: "" });
                  setColorsOpen(false);
                }}
                className={cn("mb-2 flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] text-strong hover:bg-surface-hover", event.color === null && "bg-surface-hover")}
              >
                <span className="size-3 rounded-full" style={{ background: calendar?.color }} /> {t("Del calendario")}
              </button>
              <div className="grid grid-cols-5 gap-2 px-1">
                {CALENDAR_COLORS.map((c) => (
                  <button
                    key={c}
                    aria-label={`Color ${c}`}
                    onClick={() => {
                      commit({ color: c });
                      setColorsOpen(false);
                    }}
                    className={cn("size-6 rounded-md ring-offset-2 ring-offset-popover", event.color === c && "ring-2")}
                    style={{ background: c, ["--tw-ring-color" as string]: c }}
                  />
                ))}
              </div>
            </Popover>
          </Row>
        </section>
      </div>
      <div className={cn("shrink-0 px-4 py-2 text-[11px] text-faint", floating && "border-t border-border")}>
        {isDraft ? t("Borrador: se guardará al escribir un título o cambiar algún dato") : t("Guardado automáticamente · cifrado en este equipo")}
      </div>
    </div>
  );
}

/** Interruptor pequeño (estilo productividad). */
function Switch({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className={cn("relative h-[14px] w-[24px] rounded-full transition-colors", on ? "bg-accent" : "bg-faint")}
    >
      <span className={cn("absolute top-[2px] size-[10px] rounded-full bg-white transition-all", on ? "left-[12px]" : "left-[2px]")} />
    </button>
  );
}

function Row({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-h-7 items-center gap-1">
      <span className="flex w-6 shrink-0 justify-center text-muted">{icon}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5">{children}</div>
    </div>
  );
}

function LinksEditor({ links, onChange }: { links: EventLink[]; onChange: (links: EventLink[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const valid = /^(https?:\/\/|mailto:)\S+$/i.test(url.trim());

  function add() {
    if (!valid) return;
    onChange([...links, { label: label.trim(), url: url.trim() }]);
    setUrl("");
    setLabel("");
    setAdding(false);
  }

  return (
    <section className="px-3 py-2">
      {links.map((l, i) => (
        <Row key={`${l.url}-${i}`} icon={i === 0 ? <Link2 className="size-4" /> : undefined}>
          {/* Los enlaces se muestran como texto: Chronos no abre conexiones de red. */}
          <div className="group flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 hover:bg-surface-hover">
            <span className="min-w-0 flex-1 select-text truncate text-[13px] text-strong" title={l.url}>
              {l.label || l.url}
            </span>
            <button className="invisible text-muted hover:text-danger group-hover:visible" aria-label={t("Quitar enlace")} onClick={() => onChange(links.filter((_, j) => j !== i))}>
              <X className="size-3.5" />
            </button>
          </div>
        </Row>
      ))}
      {adding ? (
        <div className="ml-7 space-y-1.5 py-1">
          <Input autoFocus value={url} placeholder="https://…" className="h-8" onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <Input value={label} placeholder={t("Texto (opcional)")} className="h-8" onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <div className="flex justify-end gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
              {t("Cancelar")}
            </Button>
            <Button size="sm" disabled={!valid} onClick={add}>
              {t("Añadir")}
            </Button>
          </div>
        </div>
      ) : (
        links.length < 20 && (
          <Row icon={links.length === 0 ? <Link2 className="size-4" /> : <Plus className="size-3.5" />}>
            <button onClick={() => setAdding(true)} className="h-7 rounded-md px-1.5 text-[13px] text-muted hover:bg-surface-hover hover:text-strong">
              {links.length === 0 ? t("Añade enlaces") : t("Añadir otro enlace")}
            </button>
          </Row>
        )
      )}
    </section>
  );
}
