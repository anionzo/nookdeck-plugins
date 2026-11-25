/** Wide tiles: the current week as seven columns. Today's date is a pill; all-day events are on top of each day. */
import { TONES, timeText } from "./card";
import type { Occurrence } from "./events";
import { dayLines, type Tile } from "./layout";

type Node = Record<string, unknown>;
const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** The card's own limit of parts. */
const MAX_NODES = 60;

export interface WeekView { now: number; firstDay: 0 | 1; hour24: boolean }

const day = (ms: number, add = 0): number => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + add).getTime(); };

/** Midnight of each of the seven days of the week `now` is in. */
export function weekDays(now: number, firstDay: 0 | 1): number[] {
  const back = (new Date(now).getDay() - firstDay + 7) % 7;
  return Array.from({ length: 7 }, (_, i) => day(now, i - back));
}

interface Item { o: Occurrence; timed: boolean; time: string }

/** What one day holds: all-day events first, then by the clock. An event over several days is on each of them. */
export function dayItems(events: Occurrence[], from: number, view: WeekView): Item[] {
  const to = day(from, 1);
  return events
    .filter((o) => (o.end > o.start ? o.start < to && o.end > from : o.start >= from && o.start < to))
    .map((o) => {
      // one that covers the whole of this day reads as all day, wherever it began
      if (o.allDay || (o.start <= from && o.end >= to)) return { o, timed: false, time: "" };
      const time = o.start >= from ? timeText(o.start, view.hour24) : `to ${timeText(o.end, view.hour24)}`;
      return { o, timed: true, time };
    })
    .sort((a, b) => Number(a.timed) - Number(b.timed) || a.o.start - b.o.start);
}

function itemNode(item: Item, over: boolean): Node {
  const tone = over ? "muted" : TONES[item.o.calendar % TONES.length];
  const name = (item.o.title || "(no title)").slice(0, 200);
  if (!item.timed) return { t: "pill", text: name, tone };
  return { t: "col", gap: 0, children: [
    { t: "text", text: item.time, size: "s", tone, bold: true },
    { t: "text", text: name, size: "s", ...(over ? { tone: "muted" } : {}) },
  ] };
}

/**
 * Seven equal columns. How much each shows is limited by the tile's height and by the card's 60 parts, which are shared a row
 * at a time so a full Monday cannot empty the Friday. A day with more says "+n". When a day has too many, the ones that are
 * over give way first.
 */
export function buildWeek(events: Occurrence[], view: WeekView, tile: Tile, notes: string[] = []) {
  const days = weekDays(view.now, view.firstDay);
  const today = day(view.now);
  const lines = dayLines(tile.h);
  const columns = days.map((from) => {
    const all = dayItems(events, from, view);
    const coming = all.filter((i) => i.o.end > view.now);
    // keep what is still to come; fill what room is left with what is over
    const order = from === today ? [...coming, ...all.filter((i) => i.o.end <= view.now)] : all;
    const d = new Date(from);
    const label = `${SHORT[d.getDay()]} ${d.getDate()}`;
    const header: Node = from === today ? { t: "pill", text: label, tone: "accent" } : { t: "text", text: label, size: "s", tone: "muted", bold: true };
    return { header, all, order, taken: new Set<Item>(), lines: 0, full: false };
  });
  const noteNodes: Node[] = notes.slice(0, 1).map((n) => ({ t: "text", text: n.slice(0, 200), size: "s", tone: "warn" }));
  // the card, its week row, seven columns and headers, the note, and a "+n" for every day
  let left = MAX_NODES - 2 - 7 * 2 - noteNodes.length - 7;
  for (let round = 0; columns.some((c) => !c.full && round < c.order.length); round++) {
    for (const c of columns) {
      const item = c.order[round];
      if (!item || c.full) continue;
      const height = item.timed ? 2 : 1;
      // a day that will need "+n" keeps a line for it
      const room = lines - (c.order.length > round + 1 ? 1 : 0);
      const cost = item.timed ? 3 : 1;
      if (c.lines + height > room || cost > left) { c.full = true; continue; }
      c.lines += height;
      left -= cost;
      c.taken.add(item);
    }
  }
  const week: Node = { t: "row", gap: 1, children: columns.map((c) => {
    const shown = c.all.filter((i) => c.taken.has(i));
    const more = c.all.length - shown.length;
    return { t: "col", gap: 1, grow: true, children: [
      c.header,
      ...shown.map((i) => itemNode(i, i.o.end <= view.now)),
      ...(more ? [{ t: "text", text: `+${more}`, size: "s", tone: "muted" }] : []),
    ] };
  }) };
  const root: Node = { t: "col", gap: 1, children: [week, ...noteNodes] };
  return { root };
}
