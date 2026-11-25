/** Wide tiles: this week in Nookdeck's `week` card part (0.5.1), which draws a time grid, or a list when the tile is low. */
import { TONES, dateText, daysAway, whenText, windowEnd, type View } from "./card";
import { FILL_DAYS } from "./agenda";
import type { Occurrence } from "./events";

type Node = Record<string, unknown>;
/** The part's own limits. */
export const WEEK_EVENTS = 40;
const TITLE = 80;

const two = (n: number): string => String(n).padStart(2, "0");
export const dayText = (ms: number): string => { const d = new Date(ms); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`; };
const clock = (ms: number): string => { const d = new Date(ms); return `${two(d.getHours())}:${two(d.getMinutes())}`; };
const day = (ms: number, add = 0): number => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + add).getTime(); };

/** Midnight of each of the seven days of the week `now` is in. */
export function weekDays(now: number, firstDay: 0 | 1): number[] {
  const back = (new Date(now).getDay() - firstDay + 7) % 7;
  return Array.from({ length: 7 }, (_, i) => day(now, i - back));
}

interface Item { day: number; title: string; allDay?: true; start?: string; end?: string; tone: string }

/** What one day holds. An event over several days is on each of them, with the part of it that is on that day. */
export function dayItems(events: Occurrence[], from: number, index: number, now: number): Item[] {
  const to = day(from, 1);
  return events
    .filter((o) => (o.end > o.start ? o.start < to && o.end > from : o.start >= from && o.start < to))
    .map((o) => {
      const base = { day: index, title: (o.title || "(no title)").slice(0, TITLE), tone: o.end <= now && o.end > o.start ? "muted" : TONES[o.calendar % TONES.length]! };
      // one that covers the whole of this day reads as all day, wherever it began
      if (o.allDay || (o.start <= from && o.end >= to)) return { ...base, allDay: true as const };
      const start = clock(Math.max(o.start, from));
      const end = o.end >= to ? "24:00" : clock(o.end);
      return { ...base, start, ...(end > start ? { end } : {}) };
    });
}

/**
 * The card takes 40 events. They are shared a row at a time, so a full Monday cannot empty the Friday, what is still to come
 * first; `more` counts what each day lost, for its "+n".
 */
export function shareWeek(days: Item[][]): { events: Item[]; more: number[] } {
  const queues = days.map((items) => [...items.filter((i) => i.tone !== "muted"), ...items.filter((i) => i.tone === "muted")]);
  const taken = new Set<Item>();
  for (let round = 0; taken.size < WEEK_EVENTS && queues.some((q) => round < q.length); round++) {
    for (const q of queues) if (q[round] && taken.size < WEEK_EVENTS) taken.add(q[round]!);
  }
  return { events: days.flatMap((items) => items.filter((i) => taken.has(i))), more: days.map((items) => items.filter((i) => !taken.has(i)).length) };
}

export interface Run { title: string; from: number; to: number }

/**
 * Events as lines: all-day ones of one name on days that follow each other are one line, as in the week part. `to` is the
 * last day. In order of the first day.
 */
export function runs(events: Occurrence[]): Run[] {
  const out: (Run & { allDay: boolean })[] = [];
  for (const o of events) {
    const title = o.title || "(no title)";
    const from = day(o.start);
    // an all-day event ends at the midnight after its last day
    const to = o.allDay && o.end > o.start ? Math.max(from, day(o.end - 1)) : from;
    const run = o.allDay ? out.find((r) => r.allDay && r.title === title && from > r.from && from <= day(r.to, 1)) : undefined;
    if (run) run.to = Math.max(run.to, to);
    else out.push({ title, from, to, allDay: o.allDay });
  }
  return out.map(({ title, from, to }) => ({ title, from, to }));
}

/** "25 Dec", "7-10 Feb", "31 Jan - 2 Feb". */
export function runDates(r: Run): string {
  const short = (ms: number) => dateText(ms).slice(dateText(ms).indexOf(" ") + 1);
  if (r.to === r.from) return short(r.from);
  const a = new Date(r.from);
  return a.getMonth() === new Date(r.to).getMonth() ? `${a.getDate()}-${short(r.to)}` : `${short(r.from)} - ${short(r.to)}`;
}

/** How many lines of Later fit under Next on a quiet week: the week's own lines past the first, and a note, take their room. */
export function laterRows(height: number, weekLines: number, note: boolean): number {
  const room = height >= 4 ? 5 : height === 3 ? 1 : 0;
  return Math.max(0, room - Math.max(0, weekLines - 1) - (note ? 1 : 0));
}

/**
 * `events` are this week's. `ahead` is given for a week with nothing left in it: what comes after the week, in order, as far
 * as it is looked for. The first is Next; a quiet week on a tile `height` rows high lists those after it under Later, no
 * further than FILL_DAYS.
 */
export function buildWeek(events: Occurrence[], view: View, notes: string[] = [], ahead: Occurrence[] = [], height = 0) {
  const days = weekDays(view.now, view.firstDay);
  const shared = shareWeek(days.map((from, i) => dayItems(events, from, i, view.now)));
  const week: Node = {
    t: "week", start: dayText(days[0]!), today: dayText(view.now), now: clock(view.now), hour24: view.hour24, events: shared.events,
    ...(shared.more.some((n) => n > 0) ? { more: shared.more } : {}),
  };
  const under: Node[] = notes.slice(0, 1).map((n) => ({ t: "text", text: n.slice(0, 200), size: "s", tone: "warn" }));
  const next = ahead[0];
  if (next && !events.some((o) => o.end > view.now)) {
    const away = daysAway(next.start, view.now);
    const when = [dateText(next.start), ...(next.allDay ? [] : [whenText(next, "Today", view)])].join(", ");
    // it is the thing to read on a week with nothing left, so it has two lines of its own, the name large
    under.unshift(
      { t: "text", text: `Next: ${next.title || "(no title)"}`.slice(0, 200), size: "l", bold: true },
      { t: "text", text: away < 1 ? when : `${when} · ${away === 1 ? "tomorrow" : `in ${away} days`}`, bold: true, tone: "accent" },
    );
    // with timed events the week has its columns and hours, and no room is left over
    if (shared.events.every((e) => e.allDay)) {
      const lines = shared.events.filter((e) => !shared.events.some((p) => p.day === e.day - 1 && p.title === e.title && p.tone === e.tone)).length;
      const far = windowEnd(view.now, FILL_DAYS);
      const later = runs(ahead.filter((o) => o.start <= far)).slice(1, 1 + laterRows(height, lines, notes.length > 0));
      if (later.length) {
        under.splice(2, 0,
          { t: "text", text: "Later", size: "s", tone: "muted", bold: true },
          ...later.map((r) => ({ t: "row", gap: 2, children: [{ t: "text", text: runDates(r), bold: true, tone: "accent" }, { t: "col", grow: true, children: [{ t: "text", text: r.title.slice(0, TITLE) }] }] })),
        );
      }
    }
  }
  return { root: under.length ? { t: "col", gap: 1, children: [week, ...under] } : week };
}
