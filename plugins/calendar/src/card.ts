/** The tile: today's date, then the next events. Titles and times only: no description, place or link of an event leaves the computer. */
import type { Occurrence } from "./events";

export interface View {
  now: number;
  /** 0 = Sunday, 1 = Monday */
  firstDay: 0 | 1;
  hour24: boolean;
  /** how many events the tile shows */
  rows: number;
  /** how far ahead it looks, today included */
  days: number;
}

type Node = Record<string, unknown>;
/** One colour per calendar link, in order. */
export const TONES = ["accent", "ok", "warn", "bad"] as const;
const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const midnight = (ms: number, add = 0): number => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + add).getTime(); };

/** The end of the window: today and the next `days - 1` days. */
export const windowEnd = (now: number, days: number): number => midnight(now, days) - 1;

export function timeText(ms: number, hour24: boolean): string {
  const d = new Date(ms);
  const h = d.getHours(), m = String(d.getMinutes()).padStart(2, "0");
  if (hour24) return `${String(h).padStart(2, "0")}:${m}`;
  return `${h % 12 || 12}${m === "00" ? "" : `:${m}`} ${h < 12 ? "AM" : "PM"}`;
}

export const dateText = (ms: number): string => { const d = new Date(ms); return `${SHORT[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };

/** Midnight that starts the week after the one `now` is in. */
export function nextWeekStart(now: number, firstDay: 0 | 1): number {
  const gone = (new Date(now).getDay() - firstDay + 7) % 7;
  return midnight(now, 7 - gone);
}

export type Group = "Today" | "Tomorrow" | "This week" | "Next week" | "Later";

/** The heading an event sits under. One that started earlier and still runs is today's. */
export function groupOf(start: number, view: Pick<View, "now" | "firstDay">): Group {
  const { now, firstDay } = view;
  if (start < midnight(now, 1)) return "Today";
  if (start < midnight(now, 2)) return "Tomorrow";
  const next = nextWeekStart(now, firstDay);
  if (start < next) return "This week";
  const d = new Date(next);
  return start < new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getTime() ? "Next week" : "Later";
}

const short = (start: number, group: Group): string => {
  const d = new Date(start);
  return group === "Later" ? `${d.getDate()} ${MONTHS[d.getMonth()]}` : SHORT[d.getDay()]!;
};

/** The right-hand column: "Now", "16:30" or "Fri 09:00"; for an all-day event "All day", or its day further out. */
export function whenText(o: Occurrence, group: Group, view: Pick<View, "now" | "hour24">): string {
  const near = group === "Today" || group === "Tomorrow";
  if (o.allDay) return near ? "All day" : short(o.start, group);
  if (group === "Today" && o.start <= view.now) return "Now";
  return [near ? "" : short(o.start, group), timeText(o.start, view.hour24)].filter(Boolean).join(" ");
}

/** Calendar days from today to the day of `start`. */
export const daysAway = (start: number, now: number): number => Math.round((midnight(start) - midnight(now)) / 86_400_000);
const away = (n: number) => (n === 1 ? "tomorrow" : `in ${n} days`);

const title = (o: Occurrence) => (o.title || "(no title)").slice(0, 200);
const muted = (text: string, more: Node = {}): Node => ({ t: "text", text, size: "s", tone: "muted", ...more });

/** With this many events or fewer there is room for a second line. */
export const ROOMY_MAX = 2;
/** About the longest title that fits beside a time on the narrowest tile. A card cannot measure text, so this is a count. */
export const LONG_TITLE = 15;

/**
 * A dot in the calendar's colour and the title on the left, which gives way when there is no room; the time or the day stays in
 * one column on the right. An event that is all day today or tomorrow has a pill there. When there is room to spare and the
 * title is long, the title takes the whole line and the right-hand column moves to a second one.
 */
function eventRow(o: Occurrence, group: Group, view: View, roomy: boolean): Node {
  const tone = TONES[o.calendar % TONES.length];
  const when = whenText(o, group, view);
  const time: Node = when === "All day" ? { t: "pill", text: when, tone } : when === "Now" ? { t: "text", text: when, size: "s", tone, bold: true } : muted(when);
  const lead: Node = { t: "row", gap: 1, grow: true, children: [{ t: "text", text: "●", size: "s", tone }, { t: "text", text: title(o), size: "s" }] };
  if (roomy && title(o).length > LONG_TITLE) return { t: "col", gap: 0, children: [{ t: "row", children: lead.children }, { t: "row", align: "end", children: [time] }] };
  return { t: "row", gap: 2, align: "between", children: [lead, time] };
}

/** Always the top of the tile: what a small tile shows first. */
const header = (now: number): Node => ({ t: "row", gap: 2, align: "between", children: [{ t: "text", text: "Today", bold: true }, muted(dateText(now))] });

/** `next` is the first event after the days the tile looks at: it is shown only when those days hold nothing at all. */
export function buildCard(events: Occurrence[], view: View, notes: string[] = [], next?: Occurrence) {
  const children: Node[] = [header(view.now)];
  const shown = events.length ? events.slice(0, view.rows) : next ? [next] : [];
  const first = shown[0];
  const free = !first || groupOf(first.start, view) !== "Today";
  if (free) {
    children.push({ t: "row", gap: 2, children: [{ t: "icon", name: "calendar", tone: "accent" }, { t: "text", text: "Nothing today" }] });
    if (!first) children.push(muted(view.days > 1 ? `Nothing in the next ${view.days} days` : "The day is yours"));
  }
  let group: Group = "Today";
  shown.forEach((o, i) => {
    const g = groupOf(o.start, view);
    const row = eventRow(o, g, view, shown.length <= ROOMY_MAX);
    if (g === group) return void children.push(row);
    group = g;
    // after a free day the first heading says how far off the next event is
    const heading = free && i === 0 && daysAway(o.start, view.now) > 1 ? `Next ${away(daysAway(o.start, view.now))}` : g;
    // A heading and its first event are one part, so a small tile never ends on a heading with nothing under it.
    // "Next in 29 days" says something by itself, so it stays when its event does not fit.
    if (heading === g) children.push({ t: "col", gap: 1, children: [muted(heading, { bold: true }), row] });
    else children.push(muted(heading, { bold: true }), row);
  });
  if (events.length > shown.length) children.push(muted(`+${events.length - shown.length} more`));
  for (const n of notes.slice(0, 2)) children.push({ t: "text", text: n.slice(0, 200), size: "s", tone: "warn" });
  return { root: { t: "col", gap: 1, children } };
}

/** Before any link is set. */
export function setupCard(now: number) {
  return { root: { t: "col", gap: 1, children: [header(now), { t: "row", gap: 2, children: [{ t: "icon", name: "calendar", tone: "accent" }, { t: "text", text: "No calendar yet" }] },
    muted("Add a calendar link in the plugin's settings on your computer")] } };
}
