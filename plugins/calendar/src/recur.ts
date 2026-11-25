/** Repeating events. Occurrences are worked out on the wall clock of the event's own zone, so 09:00 stays 09:00 across summer time. */
import type { VEvent, When } from "./ics";
import { wallAsUtc, type Wall } from "./zones";

const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const DAY = 86_400_000;
const MAX_PERIODS = 60_000;

interface Rule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count?: number;
  until?: string;
  byDay: { n: number; day: number }[];
  byMonthDay: number[];
  byMonth: number[];
  bySetPos: number[];
  wkst: number;
}

/** Null for a rule this tile does not follow (hourly and finer, week numbers, days of the year). */
export function parseRule(text: string): Rule | null {
  const m = Object.fromEntries(text.split(";").map((p) => { const [k, v] = p.split("="); return [k!.trim().toUpperCase(), (v ?? "").trim()]; }));
  const freq = m.FREQ as Rule["freq"];
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq) || m.BYWEEKNO || m.BYYEARDAY) return null;
  const nums = (v?: string) => (v ? v.split(",").map(Number).filter((n) => Number.isInteger(n) && n !== 0) : []);
  const byDay = (m.BYDAY ? m.BYDAY.split(",") : []).map((s: string) => {
    const x = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(s.trim().toUpperCase());
    return x ? { n: Number(x[1] ?? 0), day: DAYS.indexOf(x[2]!) } : null;
  }).filter((x): x is { n: number; day: number } => !!x);
  return {
    freq, interval: Math.max(1, Number(m.INTERVAL) || 1),
    count: m.COUNT ? Number(m.COUNT) : undefined, until: m.UNTIL || undefined,
    byDay, byMonthDay: nums(m.BYMONTHDAY), byMonth: nums(m.BYMONTH), bySetPos: nums(m.BYSETPOS),
    wkst: Math.max(0, DAYS.indexOf(m.WKST ?? "MO")),
  };
}

// calendar arithmetic on day numbers (days since 1970-01-01), free of any time zone
const dayNo = (y: number, mo: number, d: number) => Date.UTC(y, mo - 1, d) / DAY;
const ymd = (n: number) => { const x = new Date(n * DAY); return { y: x.getUTCFullYear(), mo: x.getUTCMonth() + 1, d: x.getUTCDate() }; };
const weekday = (n: number) => (((n + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday
const monthLength = (y: number, mo: number) => new Date(Date.UTC(y, mo, 0)).getUTCDate();

/** The days of a month a rule names, from BYMONTHDAY and / or BYDAY (with "2nd Tuesday", "last Friday"). */
function monthDays(r: Rule, y: number, mo: number, startDay: number): number[] {
  const len = monthLength(y, mo);
  const all = Array.from({ length: len }, (_, i) => i + 1);
  let days: number[] | null = null;
  if (r.byMonthDay.length) days = r.byMonthDay.map((n) => (n > 0 ? n : len + 1 + n)).filter((n) => n >= 1 && n <= len);
  if (r.byDay.length) {
    const picked = r.byDay.flatMap(({ n, day }) => {
      const hits = all.filter((d) => weekday(dayNo(y, mo, d)) === day);
      if (!n) return hits;
      const one = n > 0 ? hits[n - 1] : hits[hits.length + n];
      return one ? [one] : [];
    });
    days = days ? days.filter((d) => picked.includes(d)) : picked;
  }
  // a plain monthly rule on the 31st skips the months without one
  if (!days) days = startDay <= len ? [startDay] : [];
  return [...new Set(days)].sort((a, b) => a - b).map((d) => dayNo(y, mo, d));
}

/** The candidate days of the i-th period after the start. */
function period(r: Rule, start: Wall, i: number): number[] {
  const first = dayNo(start.y, start.mo, start.d);
  const step = i * r.interval;
  const inMonths = (n: number) => !r.byMonth.length || r.byMonth.includes(ymd(n).mo);
  if (r.freq === "DAILY") {
    const n = first + step;
    const { y, mo, d } = ymd(n);
    const okDay = !r.byDay.length || r.byDay.some((b) => b.day === weekday(n));
    const okDate = !r.byMonthDay.length || r.byMonthDay.some((x) => (x > 0 ? x : monthLength(y, mo) + 1 + x) === d);
    return okDay && okDate && inMonths(n) ? [n] : [];
  }
  if (r.freq === "WEEKLY") {
    const weekStart = first - ((weekday(first) - r.wkst + 7) % 7) + step * 7;
    const wanted = r.byDay.length ? r.byDay.map((b) => b.day) : [weekday(first)];
    return wanted.map((day) => weekStart + ((day - r.wkst + 7) % 7)).sort((a, b) => a - b).filter(inMonths);
  }
  if (r.freq === "MONTHLY") {
    const m0 = start.mo - 1 + step;
    const y = start.y + Math.floor(m0 / 12), mo = (m0 % 12) + 1;
    return r.byMonth.length && !r.byMonth.includes(mo) ? [] : monthDays(r, y, mo, start.d);
  }
  const y = start.y + step;
  const months = r.byMonth.length ? [...r.byMonth].sort((a, b) => a - b) : r.byDay.length && !r.byMonthDay.length ? null : [start.mo];
  if (months) return months.flatMap((mo) => monthDays(r, y, mo, start.d));
  // BYDAY over a whole year: "the 20th Monday of the year"
  const all = Array.from({ length: dayNo(y + 1, 1, 1) - dayNo(y, 1, 1) }, (_, k) => dayNo(y, 1, 1) + k);
  return [...new Set(r.byDay.flatMap(({ n, day }) => {
    const hits = all.filter((x) => weekday(x) === day);
    if (!n) return hits;
    const one = n > 0 ? hits[n - 1] : hits[hits.length + n];
    return one === undefined ? [] : [one];
  }))].sort((a, b) => a - b);
}

function untilLimit(until: string, start: When): (wall: Wall) => boolean {
  const m = /^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)(Z)?)?$/.exec(until);
  if (!m) return () => false;
  const w: Wall = { y: +m[1]!, mo: +m[2]!, d: +m[3]!, h: +(m[4] ?? 23), mi: +(m[5] ?? 59), s: +(m[6] ?? 59) };
  // a UTC limit compares instants, anything else compares wall clocks
  if (m[7]) return (x) => start.toInstant(x) > wallAsUtc(w);
  return (x) => wallAsUtc(x) > wallAsUtc(w);
}

/** The walls of every occurrence that starts no later than `to` (an instant). EXDATE is applied by the caller; COUNT counts excluded ones. */
export function occurrences(ev: VEvent, from: number, to: number): Wall[] {
  const start = ev.start.wall;
  if (!ev.rrule) return [start];
  const rule = parseRule(ev.rrule);
  if (!rule) return [start];
  const past = rule.until ? untilLimit(rule.until, ev.start) : () => false;
  const startDay = dayNo(start.y, start.mo, start.d);
  const out: Wall[] = [start];
  let count = 1;
  // an old daily or weekly series without COUNT can jump straight to the window
  let i = 0;
  if (!rule.count && (rule.freq === "DAILY" || rule.freq === "WEEKLY")) {
    const span = (rule.freq === "DAILY" ? 1 : 7) * rule.interval;
    i = Math.max(0, Math.floor(((from - ev.duration) / DAY - startDay - 2) / span) - 1);
  }
  for (const end = i + MAX_PERIODS; i < end; i++) {
    let days = period(rule, start, i);
    if (rule.bySetPos.length) {
      const all = days;
      days = [...new Set(rule.bySetPos.map((p) => (p > 0 ? all[p - 1] : all[all.length + p])).filter((x): x is number => x !== undefined))].sort((a, b) => a - b);
    }
    for (const n of days) {
      if (n <= startDay) continue;
      const wall: Wall = { ...start, ...ymd(n) };
      if (past(wall) || (rule.count !== undefined && count >= rule.count)) return out;
      // a day of slack on each side covers every zone's offset
      if (n * DAY - DAY > to) return out;
      count++;
      out.push(wall);
    }
    // a rule that never matches again (31 February) must still end
    const probe = rule.freq === "DAILY" ? startDay + i * rule.interval : rule.freq === "WEEKLY" ? startDay + i * 7 * rule.interval
      : rule.freq === "MONTHLY" ? startDay + i * 28 * rule.interval : startDay + i * 365 * rule.interval;
    if (probe * DAY - 40 * DAY > to) return out;
  }
  return out;
}
