import type { PluginContext, PluginModule, Settings } from "@nookdeck/plugin";
import { buildCard, setupCard, windowEnd, type View } from "./card";
import { expand, type Occurrence } from "./events";
import { parseEvents, type VEvent } from "./ics";
import { FILL_DAYS, buildAgenda, monthRange } from "./agenda";
import { isAgenda, isWeek, listRows, type Tile } from "./layout";
import { MAX_LINKS, checkLink, fetchProblem, statusProblem } from "./links";
import { buildWeek, weekDays } from "./week";

/** How far the tile looks for the next event when the days it shows are empty. */
export const LOOK_AHEAD_DAYS = 366;
export const MAX_EVENTS = 10;
export const FETCH_EVERY_MS = 10 * 60_000;
/** A failed link is tried again sooner, but not on every refresh of the tile. */
export const RETRY_MS = 60_000;

interface Copy { events?: VEvent[]; error?: string; next: number; loading?: Promise<void> }

const int = (v: unknown, fallback: number, lo: number, hi: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && v !== "" ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;
};

export function createPlugin(now: () => number = Date.now): PluginModule {
  return {
    activate(ctx: PluginContext) {
      /** by address, in memory only: calendars are never written to disk */
      const copies = new Map<string, Copy>();

      function load(url: string, label: string): Promise<void> {
        let c = copies.get(url);
        if (!c) copies.set(url, (c = { next: 0 }));
        const copy = c;
        if (copy.loading) return copy.loading;
        if (now() < copy.next) return Promise.resolve();
        copy.loading = (async () => {
          let problem = "";
          try {
            const r = await ctx.net.fetch(url, { headers: { accept: "text/calendar" } });
            if (!r.ok) problem = statusProblem(r.status);
            else {
              try { copy.events = parseEvents(await r.text()); } catch { problem = "this is not an ICS calendar"; }
            }
          } catch (err) { problem = fetchProblem(err); }
          copy.error = problem || undefined;
          copy.next = now() + (problem ? RETRY_MS : FETCH_EVERY_MS);
          if (problem) ctx.log(`${label}: ${problem}`);
          copy.loading = undefined;
        })();
        return copy.loading;
      }

      // `tile` is the size of the tile being drawn, in grid cells; a Nookdeck that does not pass it gets the short list
      ctx.widgets.provide("agenda", async (s: Settings, tile?: Tile) => {
        const secrets = ctx.settings.get();
        const links = Array.from({ length: MAX_LINKS }, (_, i) => ({ i, label: `Calendar ${i + 1}`, raw: String(secrets[`link${i + 1}`] ?? "").trim() }))
          .filter((l) => l.raw)
          .map((l) => ({ ...l, check: checkLink(l.raw) }));
        if (!links.length) return { render: "card", data: setupCard(now()) };

        // links that were removed or changed are forgotten
        const wanted = new Set(links.flatMap((l) => ("url" in l.check ? [l.check.url] : [])));
        for (const url of copies.keys()) if (!wanted.has(url)) copies.delete(url);

        await Promise.all(links.map((l) => ("url" in l.check ? load(l.check.url, l.label) : undefined)));

        const view: View = {
          now: now(),
          firstDay: s.firstDay === "Sunday" ? 0 : 1,
          hour24: s.hour24 !== false,
          rows: listRows(tile, int(s.rows, MAX_EVENTS, 1, MAX_EVENTS)),
          days: int(s.days, 7, 1, 31),
          roomy: tile?.h !== 1,
        };
        // the week view shows this whole week, its past days too; "days ahead" is for the list
        const week = isWeek(tile) ? weekDays(view.now, view.firstDay) : undefined;
        const from = week ? week[0]! : view.now;
        const to = week ? windowEnd(week[6]!, 1) : windowEnd(view.now, view.days);
        const events: Occurrence[] = [];
        const read: { events: VEvent[]; calendar: number }[] = [];
        const notes: string[] = [];
        let loaded = 0;
        for (const l of links) {
          if ("error" in l.check) { notes.push(`${l.label}: ${l.check.error}`); continue; }
          const c = copies.get(l.check.url);
          if (c?.events) {
            loaded++;
            read.push({ events: c.events, calendar: l.i });
            events.push(...expand(c.events, from, to, l.i));
          }
          if (c?.error) notes.push(`${l.label}: ${c.error}${c.events ? " (showing the last copy)" : ""}`);
        }
        if (!loaded) throw new Error(notes[0] ?? "Could not load any calendar");
        events.sort((a, b) => a.start - b.start || Number(b.allDay) - Number(a.allDay));
        const between = (a: number, b: number) => read.flatMap((r) => expand(r.events, a, b, r.calendar)).sort((x, y) => x.start - y.start || Number(y.allDay) - Number(x.allDay));
        const ahead = () => between(view.now, windowEnd(view.now, LOOK_AHEAD_DAYS));
        if (week) return { render: "card", data: buildWeek(events, view, notes, events.some((o) => o.end > view.now) ? undefined : ahead().find((o) => o.start >= to)) };
        if (isAgenda(tile)) {
          // a list that the days ahead do not fill goes on past them
          const far = windowEnd(view.now, Math.max(FILL_DAYS, view.days));
          const later = events.length < view.rows ? between(view.now, far).filter((o) => o.start >= to) : [];
          const month = monthRange(view.now);
          return { render: "card", data: buildAgenda(events, later, between(month.from, month.to - 1), view, notes) };
        }
        // days with nothing in them still say when the next event is
        const next = events.length ? undefined : ahead()[0];
        return { render: "card", data: buildCard(events, view, notes, next) };
      }, { every: 60 });
    },
  };
}

export default createPlugin();
