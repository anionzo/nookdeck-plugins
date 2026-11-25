/** From parsed events to the occurrences inside a window: repeats, exceptions, moved and cancelled single occurrences. */
import type { VEvent, When } from "./ics";
import { occurrences } from "./recur";
import { wallAsUtc, wallInLocal, type Wall } from "./zones";

export interface Occurrence {
  title: string;
  /** instants; an all-day event runs from local midnight to local midnight */
  start: number;
  end: number;
  allDay: boolean;
  /** which calendar link it came from, from 0 */
  calendar: number;
}

const key = (when: When, wall: Wall = when.wall): number => (when.allDay ? wallAsUtc({ ...wall, h: 0, mi: 0, s: 0 }) : when.toInstant(wall));

function place(ev: VEvent, wall: Wall, calendar: number): Occurrence {
  if (ev.start.allDay) {
    const days = Math.round(ev.duration / 86_400_000);
    return { title: ev.title, calendar, allDay: true, start: wallInLocal(wall), end: wallInLocal({ ...wall, d: wall.d + days }) };
  }
  const start = ev.start.toInstant(wall);
  return { title: ev.title, calendar, allDay: false, start, end: start + ev.duration };
}

/** Everything that is not over at `from` and has started by `to`. */
export function expand(events: VEvent[], from: number, to: number, calendar = 0): Occurrence[] {
  const overrides = new Map<string, VEvent>();
  for (const ev of events) if (ev.recurrenceId) overrides.set(`${ev.uid}\n${key(ev.recurrenceId)}`, ev);
  const out: Occurrence[] = [];
  const keep = (o: Occurrence) => {
    // an event with no length is shown until its start has passed
    if (o.start <= to && (o.end > from || (o.end === o.start && o.start >= from))) out.push(o);
  };
  for (const ev of events) {
    if (ev.recurrenceId) {
      if (!ev.cancelled) keep(place(ev, ev.start.wall, calendar));
      continue;
    }
    if (ev.cancelled) continue;
    const skip = new Set(ev.exdates.map((x) => key(x)));
    const seen = new Set<number>();
    const walls = [...occurrences(ev, from, to).map((wall) => ({ when: ev.start, wall })), ...ev.rdates.map((when) => ({ when, wall: when.wall }))];
    for (const { when, wall } of walls) {
      const k = key(when, wall);
      if (skip.has(k) || seen.has(k) || overrides.has(`${ev.uid}\n${k}`)) continue;
      seen.add(k);
      keep(place({ ...ev, start: when }, wall, calendar));
    }
  }
  return out.sort((a, b) => a.start - b.start || Number(b.allDay) - Number(a.allDay) || a.title.localeCompare(b.title));
}
