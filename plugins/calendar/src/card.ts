/** The tile: the next events, grouped by day. Titles and times only: no description, place or link of an event leaves the computer. */
import type { Occurrence } from "./events";

export interface View {
  now: number;
  /** 0 = Sunday, 1 = Monday */
  firstDay: 0 | 1;
  hour24: boolean;
  /** how many events the tile shows */
  rows: number;
}

type Node = Record<string, unknown>;
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

/** What the pill says: the time under Today and Tomorrow, the day further out. */
export function whenText(o: Occurrence, group: Group, view: View): string {
  const d = new Date(o.start);
  if (group === "Today" && !o.allDay && o.start <= view.now) return "Now";
  const time = o.allDay ? "All day" : timeText(o.start, view.hour24);
  if (group === "Today" || group === "Tomorrow") return time;
  const day = group === "Later" ? `${d.getDate()} ${MONTHS[d.getMonth()]}` : SHORT[d.getDay()]!;
  return o.allDay ? day : `${day} ${time}`;
}

export function buildCard(events: Occurrence[], view: View, notes: string[] = []) {
  const children: Node[] = [];
  let group: Group | null = null;
  const shown = events.slice(0, view.rows);
  for (const o of shown) {
    const g = groupOf(o.start, view);
    if (g !== group) children.push({ t: "text", text: (group = g), size: "s", tone: "muted", bold: true });
    children.push({ t: "row", gap: 2, children: [
      { t: "pill", text: whenText(o, g, view), tone: TONES[o.calendar % TONES.length] },
      { t: "text", text: (o.title || "(no title)").slice(0, 200), size: "s" },
    ] });
  }
  if (!shown.length) children.push({ t: "text", text: "Nothing coming up", tone: "muted" });
  if (events.length > shown.length) children.push({ t: "text", text: `+${events.length - shown.length} more`, size: "s", tone: "muted" });
  for (const n of notes.slice(0, 2)) children.push({ t: "text", text: n.slice(0, 200), size: "s", tone: "warn" });
  return { root: { t: "col", gap: 1, children } };
}
