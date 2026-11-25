/** 4x3 and 4x4: the month in Nookdeck's `month` card part (0.5.1), and beside it today and what comes next. */
import { TONES, dateText, daysAway, groupOf, timeText, type Group, type View } from "./card";
import type { Occurrence } from "./events";
import { dayText } from "./week";

type Node = Record<string, unknown>;
const MARKS = 62;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const midnight = (ms: number, add = 0): number => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + add).getTime(); };
export const monthRange = (now: number): { from: number; to: number } => {
  const d = new Date(now);
  return { from: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), to: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() };
};

/** A dot for each calendar with something on a day of the month, within the part's 62. */
export function monthMarks(events: Occurrence[], now: number): { date: string; tone: string }[] {
  const { from, to } = monthRange(now);
  const days: string[][] = [];
  for (let at = from; at < to; at = midnight(at, 1)) {
    const end = midnight(at, 1);
    const on = events.filter((o) => (o.end > o.start ? o.start < end && o.end > at : o.start >= at && o.start < end));
    days.push([...new Set(on.map((o) => TONES[o.calendar % TONES.length]!))].slice(0, 3));
  }
  const marks: { date: string; tone: string }[] = [];
  // one dot on every busy day before any day gets a second
  for (let round = 0; round < 3; round++) {
    days.forEach((tones, i) => { if (tones[round] && marks.length < MARKS) marks.push({ date: dayText(midnight(from, i)), tone: tones[round]! }); });
  }
  return marks;
}

/** The narrow time column: the clock for today and tomorrow, the weekday within a week or two, else the date. */
function column(o: Occurrence, group: Group, view: View): string {
  const d = new Date(o.start);
  if (group === "Today" || group === "Tomorrow") return o.allDay ? "all day" : o.start <= view.now ? "Now" : timeText(o.start, view.hour24);
  if (daysAway(o.start, view.now) < 14) return `${SHORT[d.getDay()]} ${d.getDate()}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** How far a list that the days ahead do not fill goes on past them. */
export const FILL_DAYS = 90;
/** With this few events in the days ahead, the list gives each one two lines: its whole title, then when. */
const FEW = 3;
/** How many two-line events fit beside the month on a tile of this many rows of events (listRows: 7 on 4x3, 10 on 4x4). */
const roomyRows = (rows: number): number => (rows >= 10 ? 6 : 4);

function row(o: Occurrence, group: Group, view: View, roomy: boolean): Node {
  const tone = TONES[o.calendar % TONES.length]!;
  const title: Node = { t: "text", text: (o.title || "(no title)").slice(0, 200), size: "s" };
  const when: Node = { t: "text", text: column(o, group, view), size: "s", tone, bold: true };
  if (roomy) return { t: "col", gap: 0, children: [title, when] };
  // the title's own growing box: a long one is cut short, and never squeezes the time beside it
  return { t: "row", gap: 2, children: [when, { t: "col", grow: true, children: [title] }] };
}

const muted = (text: string, bold = false): Node => ({ t: "text", text, size: "s", tone: "muted", ...(bold ? { bold: true } : {}) });

/**
 * `events` are those of the days ahead the person asked for; `later` those after them (no further than FILL_DAYS), used only
 * to fill a short list and put under "Later".
 * `month` are this month's, past ones too, for the dots. The day the month shows filled is the first day listed.
 */
export function buildAgenda(events: Occurrence[], later: Occurrence[], month: Occurrence[], view: View, notes: string[] = []) {
  const all = [...events, ...later];
  // when the days ahead hold little, the rest is only filling: better fewer events with their whole names
  const roomy = events.length <= FEW;
  const shown = all.slice(0, roomy ? Math.min(view.rows, roomyRows(view.rows)) : view.rows);
  const today = events.filter((o) => groupOf(o.start, view) === "Today").length;
  const first = shown[0];
  const listed = first ? Math.max(midnight(first.start), midnight(view.now)) : midnight(view.now);
  const inMonth = listed < monthRange(view.now).to;
  const list: Node[] = [
    { t: "text", text: dateText(view.now), bold: true },
    muted(today ? `${today} ${today === 1 ? "event" : "events"} today` : first ? "Nothing today" : `Nothing in the next ${Math.max(FILL_DAYS, view.days)} days`),
  ];
  let group: Group = "Today";
  shown.forEach((o, i) => {
    const g = groupOf(o.start, view);
    const away = daysAway(o.start, view.now);
    if (i === 0 && away > 1) list.push(muted(`Next in ${away} days`, true));
    // where the days ahead end and the filling begins is marked, whatever the dates are
    else if (i === events.length && i > 0) list.push(muted("Later", true));
    else if (i < events.length && g !== group) list.push(muted(g, true));
    else if (i === 0 && g !== group) list.push(muted(g, true));
    group = g;
    list.push(row(o, g, view, roomy));
  });
  if (events.length > shown.length) list.push(muted(`+${events.length - shown.length} more`));
  for (const n of notes.slice(0, 2)) list.push({ t: "text", text: n.slice(0, 200), size: "s", tone: "warn" });
  const grid: Node = {
    t: "month", month: dayText(view.now).slice(0, 7), today: dayText(view.now),
    ...(inMonth ? { selected: dayText(listed) } : {}), weekStart: view.firstDay, marks: monthMarks(month, view.now),
  };
  return { root: { t: "row", gap: 3, grow: true, children: [grid, { t: "col", gap: 1, grow: true, children: list }] } };
}
