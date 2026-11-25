/** Reads the parts of an ICS (RFC 5545) file a calendar tile needs: events with their start, end, title and repetition. */
import { ianaZone, wallAsUtc, wallInLocal, wallInZone, type Wall } from "./zones";

export interface Prop { name: string; params: Record<string, string>; value: string }
interface Block { name: string; props: Prop[]; children: Block[] }

/** Long lines are folded: a line that starts with a space or a tab continues the one before. */
const unfold = (text: string): string[] => text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");

function parseLine(line: string): Prop | null {
  let i = 0, quoted = false;
  for (; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ":" && !quoted) break;
  }
  if (i >= line.length) return null;
  const [name, ...rest] = line.slice(0, i).match(/(?:[^;"]|"[^"]*")+/g) ?? [""];
  const params: Record<string, string> = {};
  for (const r of rest) {
    const eq = r.indexOf("=");
    if (eq > 0) params[r.slice(0, eq).toUpperCase()] = r.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: name!.toUpperCase(), params, value: line.slice(i + 1) };
}

export function parseBlocks(text: string): Block {
  const root: Block = { name: "", props: [], children: [] };
  const stack = [root];
  for (const line of unfold(text)) {
    const p = parseLine(line);
    if (!p) continue;
    const top = stack[stack.length - 1]!;
    if (p.name === "BEGIN") {
      const b: Block = { name: p.value.trim().toUpperCase(), props: [], children: [] };
      top.children.push(b);
      stack.push(b);
    } else if (p.name === "END") {
      if (stack.length > 1) stack.pop();
    } else top.props.push(p);
  }
  return root;
}

export const unescapeText = (v: string): string => v.replace(/\\([\;,nN])/g, (_, c) => (c === "n" || c === "N" ? " " : c));

const prop = (b: Block, name: string): Prop | undefined => b.props.find((p) => p.name === name);

/** How the wall times of one event become instants. */
export type ToInstant = (w: Wall) => number;

/** A start or end as written: all-day values stay calendar dates. */
export interface When { wall: Wall; allDay: boolean; toInstant: ToInstant }

const DATE_RE = /^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)(Z)?)?$/;

function parseWhen(value: string, params: Record<string, string>, zones: Map<string, ToInstant>): When | null {
  const m = DATE_RE.exec(value.trim());
  if (!m) return null;
  const wall: Wall = { y: +m[1]!, mo: +m[2]!, d: +m[3]!, h: +(m[4] ?? 0), mi: +(m[5] ?? 0), s: +(m[6] ?? 0) };
  if (!m[4]) return { wall, allDay: true, toInstant: wallInLocal };
  if (m[7]) return { wall, allDay: false, toInstant: wallAsUtc };
  const tzid = params.TZID;
  if (!tzid) return { wall, allDay: false, toInstant: wallInLocal };
  const iana = ianaZone(tzid);
  return { wall, allDay: false, toInstant: iana ? (w) => wallInZone(w, iana) : zones.get(tzid) ?? wallInLocal };
}

/** `P1DT2H30M` in ms. */
export function parseDuration(v: string): number {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return 0;
  const ms = ((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 86400 + +(m[4] ?? 0) * 3600 + +(m[5] ?? 0) * 60 + +(m[6] ?? 0)) * 1000;
  return m[1] === "-" ? -ms : ms;
}

const offsetMs = (v: string): number => {
  const m = /^([+-])(\d\d)(\d\d)(\d\d)?$/.exec(v.trim());
  return m ? (m[1] === "-" ? -1 : 1) * ((+m[2]! * 60 + +m[3]!) * 60 + +(m[4] ?? 0)) * 1000 : 0;
};

/**
 * A VTIMEZONE the file defines itself, for a TZID that is no known zone (Outlook's "Customized Time Zone"). Handles the usual
 * shape: one or two yearly rules like "the last Sunday of March".
 */
function fileZone(b: Block): ToInstant | null {
  const parts = b.children.filter((c) => c.name === "STANDARD" || c.name === "DAYLIGHT").map((c) => ({
    offset: offsetMs(prop(c, "TZOFFSETTO")?.value ?? ""),
    start: DATE_RE.exec(prop(c, "DTSTART")?.value.trim() ?? ""),
    rule: Object.fromEntries((prop(c, "RRULE")?.value ?? "").split(";").map((x) => x.split("=") as [string, string])),
  })).filter((p) => p.start);
  if (!parts.length) return null;
  return (w) => {
    if (parts.length === 1) return wallAsUtc(w) - parts[0]!.offset;
    const at = wallAsUtc(w);
    let best: { when: number; offset: number } | null = null;
    for (const p of parts) {
      const s = p.start!;
      for (const year of [w.y - 1, w.y]) {
        const month = Number(p.rule.BYMONTH ?? s[2]);
        const day = /^([+-]?\d)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(p.rule.BYDAY ?? "");
        let date = Number(s[3]);
        if (day) {
          const want = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"].indexOf(day[2]!);
          const n = Number(day[1] ?? 1);
          if (n > 0) date = 1 + ((want - new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 7) % 7) + (n - 1) * 7;
          else {
            const last = new Date(Date.UTC(year, month, 0));
            date = last.getUTCDate() - ((last.getUTCDay() - want + 7) % 7) + (n + 1) * 7;
          }
        }
        const when = Date.UTC(year, month - 1, date, Number(s[4] ?? 0), Number(s[5] ?? 0));
        if (when <= at && (!best || when > best.when)) best = { when, offset: p.offset };
      }
    }
    return at - (best ?? { offset: parts[0]!.offset }).offset;
  };
}

export interface VEvent {
  uid: string;
  title: string;
  start: When;
  /** length in ms; for all-day events, a whole number of days */
  duration: number;
  rrule?: string;
  rdates: When[];
  exdates: When[];
  /** set on an override: which occurrence of the series it replaces */
  recurrenceId?: When;
  cancelled: boolean;
}

export function parseEvents(text: string): VEvent[] {
  const root = parseBlocks(text);
  const cal = root.children.find((c) => c.name === "VCALENDAR");
  if (!cal) throw new Error("this is not an ICS calendar");
  const zones = new Map<string, ToInstant>();
  for (const z of cal.children) {
    if (z.name !== "VTIMEZONE") continue;
    const id = prop(z, "TZID")?.value.trim();
    const f = fileZone(z);
    if (id && f) zones.set(id, f);
  }
  const out: VEvent[] = [];
  for (const b of cal.children) {
    if (b.name !== "VEVENT") continue;
    const first = (name: string): When | null => { const p = prop(b, name); return p ? parseWhen(p.value, p.params, zones) : null; };
    const many = (name: string): When[] => b.props.filter((p) => p.name === name)
      .flatMap((p) => p.value.split(",").map((v) => parseWhen(v.split("/")[0]!, p.params, zones))).filter((w): w is When => !!w);
    const start = first("DTSTART");
    if (!start) continue;
    const end = first("DTEND");
    let duration: number;
    if (end) duration = start.allDay ? wallAsUtc(end.wall) - wallAsUtc(start.wall) : end.toInstant(end.wall) - start.toInstant(start.wall);
    else if (prop(b, "DURATION")) duration = parseDuration(prop(b, "DURATION")!.value);
    else duration = start.allDay ? 86_400_000 : 0;
    if (start.allDay) duration = Math.max(86_400_000, duration);
    out.push({
      uid: prop(b, "UID")?.value ?? `${out.length}`,
      title: unescapeText(prop(b, "SUMMARY")?.value ?? "").trim(),
      start,
      duration: Math.max(0, duration),
      rrule: prop(b, "RRULE")?.value,
      rdates: many("RDATE"),
      exdates: many("EXDATE"),
      recurrenceId: first("RECURRENCE-ID") ?? undefined,
      cancelled: prop(b, "STATUS")?.value.trim().toUpperCase() === "CANCELLED",
    });
  }
  return out;
}
