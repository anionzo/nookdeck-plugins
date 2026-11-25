import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import manifest from "../nookdeck.json";
import { buildCard, groupOf, nextWeekStart, timeText, whenText, windowEnd } from "../src/card";
import { expand, type Occurrence } from "../src/events";
import { parseEvents } from "../src/ics";
import { createPlugin, FETCH_EVERY_MS, RETRY_MS } from "../src/index";
import { HOSTS, UNSUPPORTED, checkLink, fetchProblem } from "../src/links";
import { isAgenda, isWeek, listRows } from "../src/layout";
import { buildAgenda, monthMarks } from "../src/agenda";
import { WEEK_EVENTS, buildWeek, dayItems, runDates, runs, weekDays } from "../src/week";

process.env.TZ = "Asia/Ho_Chi_Minh"; // the computer's zone in these tests, UTC+7 with no summer time

const fx = (f: string) => Bun.file(join(import.meta.dir, "fixtures", f)).text();
const [holidays, google, outlook, icloud] = await Promise.all(["google-holidays.ics", "google-format.ics", "outlook-format.ics", "icloud-format.ics"].map(fx));

const local = (mo: number, d: number, h = 0, mi = 0, y = 2026) => new Date(y, mo - 1, d, h, mi).getTime();
const NOW = local(11, 25, 8); // a Wednesday
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16) + "Z";
const stamp = (o: Occurrence) => {
  const d = new Date(o.start);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}${o.allDay ? "" : ` ${p(d.getHours())}:${p(d.getMinutes())}`} ${o.title}`;
};

describe("reading ICS", () => {
  test("recorded Google calendar: all-day events", () => {
    const events = parseEvents(holidays!);
    expect(events.length).toBe((holidays!.match(/BEGIN:VEVENT/g) ?? []).length);
    expect(events.every((e) => e.start.allDay && e.title.length > 0)).toBe(true);
    const found = expand(events, NOW, local(12, 31, 23, 59));
    expect(found.length).toBeGreaterThan(0);
    for (const o of found) {
      expect(new Date(o.start).getHours()).toBe(0);
      expect(o.end - o.start).toBe(86_400_000);
    }
    const christmas = found.filter((o) => /Christmas Day/i.test(o.title));
    expect(christmas.map(stamp)).toEqual(["2026-12-25 Christmas Day"]);
  });

  test("Google: a weekly series with a removed, a moved and a cancelled occurrence", () => {
    const got = expand(parseEvents(google!), NOW, local(12, 4, 23, 59)).filter((o) => o.title.startsWith("Standup")).map(stamp);
    expect(got).toEqual([
      "2026-11-25 09:00 Standup",
      // 27 November is an EXDATE, 30 November moved to 1 December, 2 December is cancelled
      "2026-12-01 14:00 Standup (moved)",
      "2026-12-04 09:00 Standup",
    ]);
  });

  test("folded lines, escapes, a UTC time, a two-day event and an old yearly one", () => {
    const got = expand(parseEvents(google!), NOW, local(3, 2, 0, 0, 2027));
    expect(got.map(stamp)).toContain("2026-11-26 15:00 Call with a very long title that Google folds onto a second line because it passes seventy five characters, with a comma");
    const trip = got.find((o) => o.title === "Weekend trip")!;
    expect([trip.start, trip.end]).toEqual([local(11, 28), local(11, 30)]);
    expect(got.filter((o) => o.title === "Birthday").map(stamp)).toEqual(["2027-03-01 Birthday"]);
  });

  test("an all-day event stays while its day lasts and goes after it", () => {
    const at = (now: number) => expand(parseEvents(google!), now, windowEnd(now, 1)).map((o) => o.title);
    expect(at(local(11, 29, 23, 59))).toContain("Weekend trip");
    expect(at(local(11, 30, 0, 1))).not.toContain("Weekend trip");
  });

  test("Outlook: Windows zone names, the second Tuesday, across summer time", () => {
    const got = expand(parseEvents(outlook!), local(1, 1), local(12, 31, 23, 59)).filter((o) => o.title === "Monthly review");
    // 09:00 in Los Angeles is 17:00 UTC in winter and 16:00 UTC in summer
    expect(got.map((o) => iso(o.start))).toEqual([
      "2026-02-10T17:00Z", "2026-03-10T16:00Z", "2026-04-14T16:00Z", "2026-05-12T16:00Z", "2026-06-09T16:00Z", "2026-07-14T16:00Z",
      "2026-08-11T16:00Z", "2026-09-08T16:00Z", "2026-10-13T16:00Z", "2026-11-10T17:00Z", "2026-12-08T17:00Z",
    ]);
  });

  test("Outlook: a zone the file defines itself, and COUNT", () => {
    const got = expand(parseEvents(outlook!), local(1, 1), local(12, 31, 23, 59, 2027)).filter((o) => o.title === "Customized zone meeting");
    expect(got).toHaveLength(7);
    expect([got[0]!, got[3]!, got[4]!, got[6]!].map((o) => iso(o.start))).toEqual(["2026-07-15T08:00Z", "2026-10-15T08:00Z", "2026-11-15T09:00Z", "2027-01-15T09:00Z"]);
  });

  test("iCloud: DURATION, COUNT across a clock change, floating times, an alarm, the last day of the month", () => {
    const events = parseEvents(icloud!);
    const runs = expand(events, local(10, 1), local(10, 31)).filter((o) => o.title === "Morning run");
    expect(runs.map((o) => iso(o.start))).toEqual(["2026-10-23T07:30Z", "2026-10-24T07:30Z", "2026-10-25T08:30Z", "2026-10-26T08:30Z", "2026-10-27T08:30Z"]);
    expect(runs[0]!.end - runs[0]!.start).toBe(75 * 60_000);
    const soon = expand(events, NOW, local(1, 31, 23, 0, 2027));
    expect(soon.map(stamp)).toEqual(["2026-11-26 19:30 Dinner; bring dessert", "2026-11-30 Rent", "2026-12-31 Rent", "2027-01-31 Rent"]);
  });

  test("rules", () => {
    const run = (start: string, rule: string, to: number, from = local(1, 1)) =>
      expand(parseEvents(`BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:x\nSUMMARY:x\nDTSTART:${start}\nDTEND:${start}\nRRULE:${rule}\nEND:VEVENT\nEND:VCALENDAR`), from, to)
        .map((o) => stamp(o).slice(0, 10));
    const far = local(12, 31, 23, 0, 2028);
    expect(run("20260105T100000", "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;COUNT=3", far)).toEqual(["2026-01-05", "2026-01-19", "2026-02-02"]);
    expect(run("20260131T100000", "FREQ=MONTHLY;COUNT=3", far)).toEqual(["2026-01-31", "2026-03-31", "2026-05-31"]);
    expect(run("20260130T100000", "FREQ=MONTHLY;BYDAY=-1FR;COUNT=3", far)).toEqual(["2026-01-30", "2026-02-27", "2026-03-27"]);
    expect(run("20260228T100000", "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29;COUNT=2", far)).toEqual(["2026-02-28", "2028-02-29"]);
    expect(run("20260101T100000", "FREQ=DAILY;UNTIL=20260103T235959", far)).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
    // a daily series that began in 2001 is still right today
    expect(run("20010101T100000", "FREQ=DAILY;INTERVAL=3", local(11, 30, 23), NOW)).toEqual(["2026-11-25", "2026-11-28"]);
    // never matches, and a rule this tile does not follow: both end
    expect(run("20260101T100000", "FREQ=MONTHLY;BYMONTH=2;BYMONTHDAY=31", far)).toEqual(["2026-01-01"]);
    expect(run("20260101T100000", "FREQ=SECONDLY", far)).toEqual(["2026-01-01"]);
  });

  test("something that is not a calendar", () => {
    expect(() => parseEvents("<html>sign in</html>")).toThrow("not an ICS calendar");
  });
});

describe("links", () => {
  test("the three providers, webcal included", () => {
    expect(checkLink("https://calendar.google.com/calendar/ical/x/private-abc/basic.ics")).toHaveProperty("url");
    expect(checkLink("webcal://p42-caldav.icloud.com/published/2/abc")).toEqual({ url: "https://p42-caldav.icloud.com/published/2/abc" });
    for (const h of ["outlook.live.com", "outlook.office365.com", "outlook.office.com"]) expect(checkLink(`https://${h}/owa/calendar/a/b/calendar.ics`)).toHaveProperty("url");
  });
  test("others are refused", () => {
    for (const u of ["https://cloud.example.com/cal.ics", "https://icloud.com.evil.example/x", "https://evilcalendar.google.com/x"]) expect(checkLink(u)).toEqual({ error: UNSUPPORTED });
    for (const u of ["nonsense", "file:///etc/hosts", "https://u:p@calendar.google.com/x"]) expect(checkLink(u)).toEqual({ error: "this is not a calendar link" });
  });
  test("the manifest asks for the same hosts the code accepts", () => {
    expect(manifest.permissions.network).toEqual(HOSTS);
  });
});

describe("the tile", () => {
  const view = { now: NOW, firstDay: 1 as const, hour24: true, rows: 4, days: 7 };

  test("the first day of the week decides where next week begins", () => {
    expect(nextWeekStart(NOW, 1)).toBe(local(11, 30)); // Monday
    expect(nextWeekStart(NOW, 0)).toBe(local(11, 29)); // Sunday
    expect(groupOf(local(11, 29, 10), { now: NOW, firstDay: 1 })).toBe("This week");
    expect(groupOf(local(11, 29, 10), { now: NOW, firstDay: 0 })).toBe("Next week");
    expect(groupOf(local(12, 6, 10), { now: NOW, firstDay: 1 })).toBe("Next week");
    expect(groupOf(local(12, 6, 10), { now: NOW, firstDay: 0 })).toBe("Later");
  });
  test("24-hour and 12-hour clocks", () => {
    expect([timeText(local(11, 25, 0, 5), true), timeText(local(11, 25, 14), true)]).toEqual(["00:05", "14:00"]);
    expect([timeText(local(11, 25, 0, 5), false), timeText(local(11, 25, 14), false), timeText(local(11, 25, 12, 30), false)]).toEqual(["12:05 AM", "2 PM", "12:30 PM"]);
  });
  const o = (start: number, allDay = false, calendar = 0, title = "x"): Occurrence => ({ title, start, end: start + 3_600_000, allDay, calendar });
  /** the words of each line of the card, left to right; a heading's group is opened up */
  const words = (n: any): string[] => (n.children ? n.children.flatMap(words) : [n.t === "icon" ? n.name : n.text]);
  const lines = (card: { root: unknown }) => (card.root as any).children.flatMap((n: any) => (n.t === "col" ? n.children : [n])).map((n: any) => words(n).join(" | "));

  test("what the right-hand column says", () => {
    expect(whenText(o(local(11, 25, 7, 30)), "Today", view)).toBe("Now");
    expect(whenText(o(local(11, 25), true), "Today", view)).toBe("All day");
    expect(whenText(o(local(11, 26, 16, 30)), "Tomorrow", view)).toBe("16:30");
    expect(whenText(o(local(11, 27, 9)), "This week", view)).toBe("Fri 09:00");
    expect(whenText(o(local(11, 28), true), "This week", view)).toBe("Sat");
    expect(whenText(o(local(12, 24, 9)), "Later", view)).toBe("24 Dec 09:00");
  });
  test("today's date on top, a dot and a title for each event, pills for all-day ones", () => {
    const card = buildCard([o(local(11, 25), true, 1, "Holiday"), o(local(11, 25, 7, 30), false, 0, "Standup"), o(local(11, 26, 12), false, 2, "Lunch"), o(local(11, 28), true, 0, "Trip")], view);
    expect(lines(card)).toEqual([
      "Today | Wed 25 Nov",
      "● | Holiday | All day",
      "● | Standup | Now",
      "Tomorrow",
      "● | Lunch | 12:00",
      "This week",
      "● | Trip | Sat",
    ]);
    expect(JSON.stringify(card)).toContain('{"t":"pill","text":"All day","tone":"ok"}');
    expect(JSON.stringify(card)).toContain('"text":"Sat","size":"s","tone":"muted"');
    expect(JSON.stringify(card)).toContain('{"t":"text","text":"●","size":"s","tone":"warn"}');
  });
  test("one or two events look like any others; only a long title gets a second line", () => {
    const two = [o(local(12, 24), true, 0, "Christmas Eve"), o(local(12, 25), true, 0, "Christmas Day")];
    const parts = (buildCard(two, { ...view, days: 31 }).root as any).children;
    // "Next in 29 days" stands alone, so it stays on a tile too small for the event
    expect(parts.map((n: any) => n.t)).toEqual(["row", "row", "text", "row", "row"]);
    for (const row of parts.slice(3)) expect(row).toMatchObject({ align: "between", children: [{ t: "row", grow: true }, { t: "text", tone: "muted" }] });
    const long = o(local(11, 25, 15), false, 0, "Quarterly planning review");
    const two_lines = (buildCard([long], view).root as any).children[1];
    expect(two_lines).toMatchObject({ t: "col", children: [{ t: "row", children: [{ text: "●" }, { text: long.title }] }, { t: "row", align: "end", children: [{ text: "15:00" }] }] });
    // with three events there is no second line
    expect((buildCard([long, long, long], view).root as any).children[1].align).toBe("between");
  });
  test("a heading stays with its first event", () => {
    expect(words((buildCard([o(local(11, 26, 12), false, 0, "Lunch")], view).root as any).children[2])).toEqual(["Tomorrow", "●", "Lunch", "12:00"]);
  });
  test("a free day says so, and how far the next event is", () => {
    expect(lines(buildCard([o(local(11, 26, 12), false, 0, "Lunch")], view))).toEqual([
      "Today | Wed 25 Nov", "calendar | Nothing today", "Tomorrow", "● | Lunch | 12:00",
    ]);
    expect(lines(buildCard([o(local(12, 24), true, 0, "Christmas Eve")], { ...view, days: 31 }))).toEqual([
      "Today | Wed 25 Nov", "calendar | Nothing today", "Next in 29 days", "● | Christmas Eve | 24 Dec",
    ]);
    // nothing in the days it looks at: the first event after them, alone
    expect(lines(buildCard([], view, [], o(local(12, 24), true, 0, "Christmas Eve")))).toEqual([
      "Today | Wed 25 Nov", "calendar | Nothing today", "Next in 29 days", "● | Christmas Eve | 24 Dec",
    ]);
    expect(lines(buildCard([], view))).toEqual(["Today | Wed 25 Nov", "calendar | Nothing today", "Nothing in the next 7 days"]);
    expect(lines(buildCard([], { ...view, days: 1 }))[2]).toBe("The day is yours");
  });
  test("a full tile stays inside the card limits and counts the rest", () => {
    const many = Array.from({ length: 40 }, (_, i): Occurrence => ({ title: "t".repeat(500), start: NOW + i * 40 * 3_600_000, end: NOW + i * 40 * 3_600_000 + 1, allDay: false, calendar: i % 6 }));
    const card = buildCard(many, { ...view, rows: 8 }, ["a", "b", "c"]);
    let nodes = 0;
    const walk = (n: any) => { nodes++; if (n.text) expect(n.text.length).toBeLessThanOrEqual(200); for (const c of n.children ?? []) walk(c); };
    walk(card.root);
    expect(nodes).toBeLessThanOrEqual(60);
    expect(JSON.stringify(card)).toContain("+32 more");
  });
});

const parts = (n: any): number => 1 + (n.children ?? []).reduce((a: number, c: any) => a + parts(c), 0);
const depth = (n: any): number => 1 + Math.max(0, ...(n.children ?? []).map(depth));
const text = (n: any): string[] => (n.children ? n.children.flatMap(text) : [n.text ?? n.name]);
const ev = (title: string, start: number, hours = 1, more: Partial<Occurrence> = {}): Occurrence => ({ title, start, end: start + hours * 3_600_000, allDay: false, calendar: 0, ...more });
const allDayEv = (title: string, mo: number, d: number, days = 1) => ev(title, local(mo, d), 24 * days, { allDay: true });

describe("tile sizes", () => {
  test("six or more columns wide is the week; the list grows with the height", () => {
    expect([[2, 1], [2, 2], [4, 2], [4, 3], [4, 4]].map(([w, h]) => isWeek({ w: w!, h: h! }))).toEqual([false, false, false, false, false]);
    expect([[6, 3], [8, 3], [8, 4]].map(([w, h]) => isWeek({ w: w!, h: h! }))).toEqual([true, true, true]);
    expect([1, 2, 3, 4, 6].map((h) => listRows({ w: 4, h }, 10))).toEqual([2, 4, 7, 10, 10]);
    expect(listRows({ w: 4, h: 4 }, 3)).toBe(3);
    expect(listRows(undefined, 10)).toBe(4);
    expect([[4, 3], [4, 4], [4, 2], [2, 4], [6, 3]].map(([w, h]) => isAgenda({ w: w!, h: h! }))).toEqual([true, true, false, false, false]);
  });
  test("a long list stays inside the card's limits, with headings, notes and a count", () => {
    const many = Array.from({ length: 30 }, (_, i) => ev(`event ${i}`, NOW + i * 11 * 3_600_000 + 3_600_000, 1, { calendar: i % 4 }));
    for (const list of [many, many.map((e) => ({ ...e, start: e.start + 40 * 86_400_000, end: e.end + 40 * 86_400_000 }))]) {
      const root = buildCard(list, { now: NOW, firstDay: 1, hour24: true, rows: 10, days: 60 }, ["a", "b"]).root as any;
      expect(parts(root)).toBeLessThanOrEqual(60);
      expect(depth(root)).toBeLessThanOrEqual(6);
      const shown = text(root).filter((t) => t.startsWith("event ")).length;
      expect(shown).toBeGreaterThanOrEqual(8);
      expect(text(root)).toContain(`+${30 - shown} more`);
    }
  });
});

describe("the week", () => {
  const view = { now: NOW, firstDay: 1 as const, hour24: true, rows: 10, days: 7 }; // Wednesday 25 November, 08:00
  const week = (card: { root: unknown }) => { const r = card.root as any; return r.t === "week" ? r : r.children[0]; };

  test("seven days from the first day of the week", () => {
    expect(weekDays(NOW, 1)).toEqual([23, 24, 25, 26, 27, 28, 29].map((d) => local(11, d)));
    expect(weekDays(NOW, 0)).toEqual([22, 23, 24, 25, 26, 27, 28].map((d) => local(11, d)));
    expect(weekDays(local(1, 1, 12), 1)[0]).toBe(local(12, 29, 0, 0, 2025));
  });
  test("the week part, with today and now from the computer", () => {
    expect(week(buildWeek([], view))).toEqual({ t: "week", start: "2026-11-23", today: "2026-11-25", now: "08:00", hour24: true, events: [] });
    expect(week(buildWeek([], { ...view, firstDay: 0, hour24: false }))).toMatchObject({ start: "2026-11-22", hour24: false });
  });
  test("events split by day, past ones grey", () => {
    const events = [ev("Standup", local(11, 24, 9)), ev("Lunch", local(11, 26, 12), 1, { calendar: 1 }), allDayEv("Trip", 11, 26, 3), ev("Night shift", local(11, 27, 22), 5)];
    expect(week(buildWeek(events, view)).events).toEqual([
      { day: 1, title: "Standup", tone: "muted", start: "09:00", end: "10:00" },
      { day: 3, title: "Lunch", tone: "ok", start: "12:00", end: "13:00" },
      { day: 3, title: "Trip", tone: "accent", allDay: true },
      { day: 4, title: "Trip", tone: "accent", allDay: true },
      { day: 4, title: "Night shift", tone: "accent", start: "22:00", end: "24:00" },
      { day: 5, title: "Trip", tone: "accent", allDay: true },
      { day: 5, title: "Night shift", tone: "accent", start: "00:00", end: "03:00" },
    ]);
    // a timed event that covers a whole day reads as all day on it; one that ends at midnight is not on the next
    expect(dayItems([ev("Conference", local(11, 24, 9), 60)], local(11, 25), 2, NOW)[0]).toMatchObject({ allDay: true });
    expect(dayItems([ev("Late", local(11, 24, 22), 2)], local(11, 25), 2, NOW)).toEqual([]);
    // no length: no end
    expect(dayItems([ev("Reminder", local(11, 25, 9), 0)], local(11, 25), 2, NOW)[0]).toEqual({ day: 2, title: "Reminder", tone: "accent", start: "09:00" });
  });
  test("40 events shared between the days, and more counts the rest", () => {
    const events = Array.from({ length: 70 }, (_, i) => ev(`e${i}`, local(11, 23 + (i % 7), 9 + Math.floor(i / 7), 0)));
    const part = week(buildWeek(events, view));
    expect(part.events).toHaveLength(WEEK_EVENTS);
    const shown = [0, 1, 2, 3, 4, 5, 6].map((d) => part.events.filter((e: any) => e.day === d).length);
    expect(Math.max(...shown) - Math.min(...shown)).toBeLessThanOrEqual(1);
    expect(part.more.map((n: number, d: number) => n + shown[d]!)).toEqual(Array(7).fill(10));
    const busy = Array.from({ length: 45 }, (_, i) => ev(`b${i}`, local(11, 25, 1, i * 20)));
    const kept = week(buildWeek(busy, view)).events;
    expect(kept.filter((e: any) => e.tone === "muted").length).toBeLessThan(21);
    expect(kept.map((e: any) => e.title)).toContain("b44");
  });
  test("a quiet week on a tall tile lists what comes after Next, as far as 90 days, runs of one name on one line", () => {
    const ahead = expand(parseEvents(holidays!), local(11, 30), local(6, 1, 0, 0, 2027), 0).sort((a, b) => a.start - b.start);
    const culture = expand(parseEvents(holidays!), local(11, 23), local(11, 29, 23, 59), 0);
    const later = (height: number, week = culture, from = ahead, notes: string[] = []) => {
      const kids = ((buildWeek(week, view, notes, from, height).root as any).children ?? []) as any[];
      const at = kids.findIndex((c) => c.text === "Later");
      return at < 0 ? [] : kids.slice(at + 1).filter((c) => c.t === "row").map((c) => `${c.children[0].text} ${c.children[1].children[0].text}`);
    };
    expect(later(4)).toEqual(["25 Dec Christmas Day", "31 Dec International New Year's Eve", "1 Jan International New Year's Day", "4 Feb Tet Holiday", "5 Feb Vietnamese New Year's Eve"]);
    expect(later(3)).toEqual(["25 Dec Christmas Day"]);
    expect(later(2)).toEqual([]);
    expect(later(4, culture, ahead, ["Calendar 2: could not load it"])).toHaveLength(4);
    expect(runs(ahead).find((r) => r.from === local(2, 7, 0, 0, 2027))).toEqual({ title: "Tet Holiday", from: local(2, 7, 0, 0, 2027), to: local(2, 10, 0, 0, 2027) });
    expect(runDates(runs(ahead).find((r) => r.from === local(2, 7, 0, 0, 2027))!)).toBe("7-10 Feb");
    expect(runDates({ title: "x", from: local(12, 30), to: local(1, 2, 0, 0, 2027) })).toBe("30 Dec - 2 Jan");
    // 90 days with today as the first end on 22 February; a week with timed events keeps its room
    const on = (title: string, d: number) => ev(title, local(2, d, 0, 0, 2027), 24, { allDay: true });
    expect(later(4, culture, [ahead[0]!, on("Edge", 22), on("Too far", 23)])).toEqual(["22 Feb Edge"]);
    expect(later(4, [ev("Past", local(11, 23, 9))])).toEqual([]);
    // the note stays last
    const kids = (buildWeek(culture, view, ["a note"], ahead, 4).root as any).children;
    expect(kids.at(-1).text).toBe("a note");
  });
  test("a week with nothing left says what is next, and a note goes under the week", () => {
    const next = ev("Christmas Eve", local(12, 24), 24, { allDay: true });
    const root = buildWeek([ev("Past", local(11, 23, 9))], view, [], [next]).root as any;
    expect(root.children.slice(1)).toEqual([
      { t: "text", text: "Next: Christmas Eve", size: "l", bold: true },
      { t: "text", text: "Thu 24 Dec · in 29 days", bold: true, tone: "accent" },
    ]);
    // a timed one says its time, and the day after this week is counted like any other
    const monday = (buildWeek([], view, [], [ev("Kickoff", local(11, 30, 9))]).root as any).children[2];
    expect(monday.text).toBe("Mon 30 Nov, 09:00 · in 5 days");
    expect((buildWeek([ev("Soon", local(11, 26, 9))], view, [], [next]).root as any).t).toBe("week");
    expect(text({ children: [(buildWeek([], view, ["Calendar 2: could not load it"]).root as any).children[1]] })).toEqual(["Calendar 2: could not load it"]);
  });
});

describe("the month beside the list", () => {
  const view = { now: NOW, firstDay: 1 as const, hour24: true, rows: 10, days: 7 };
  const parts2 = (card: { root: unknown }) => { const [month, list] = (card.root as any).children; return { month, list }; };

  test("today first, then the days ahead, with a time column", () => {
    const events = [ev("Now thing", local(11, 25, 7, 30), 1), ev("Parcel", local(11, 25, 16, 45)), allDayEv("Release", 11, 26), ev("Demo", local(11, 28, 14), 1, { calendar: 1 })];
    const { month, list } = parts2(buildAgenda(events, [], events, view));
    expect(text(list)).toEqual(["Wed 25 Nov", "2 events today", "Now", "Now thing", "16:45", "Parcel", "Tomorrow", "all day", "Release", "This week", "Sat 28", "Demo"]);
    expect(month).toMatchObject({ t: "month", month: "2026-11", today: "2026-11-25", selected: "2026-11-25", weekStart: 1 });
    expect(month.marks).toEqual([{ date: "2026-11-25", tone: "accent" }, { date: "2026-11-26", tone: "accent" }, { date: "2026-11-28", tone: "ok" }]);
    // in a longer list the title has a growing box of its own, so the time keeps its width
    expect(list.children[2]).toMatchObject({ t: "row", children: [{ text: "Now" }, { t: "col", grow: true, children: [{ text: "Now thing" }] }] });
  });
  test("few events: the list goes on past the days ahead, and says how far the next one is", () => {
    const later = [allDayEv("Christmas Eve", 12, 24), allDayEv("Christmas Day", 12, 25)];
    const { month, list } = parts2(buildAgenda([], later, [ev("Old", local(11, 20, 9))], view));
    expect(text(list)).toEqual(["Wed 25 Nov", "Nothing today", "Next in 29 days", "Christmas Eve", "24 Dec", "Christmas Day", "25 Dec"]);
    expect(month.selected).toBeUndefined(); // the next day listed is in another month
    expect(month.marks).toEqual([{ date: "2026-11-20", tone: "accent" }]);
    expect(text(parts2(buildAgenda([], [], [], view)).list)).toEqual(["Wed 25 Nov", "Nothing in the next 90 days"]);
    expect(parts2(buildAgenda([ev("Fri", local(11, 27, 9))], [], [], view)).month.selected).toBe("2026-11-27");
  });
  test("what goes past the days ahead is under Later; few events get two lines, and only as many as fit", () => {
    const soon = [ev("Soon", local(11, 26, 9))];
    const later = Array.from({ length: 9 }, (_, i) => allDayEv(`A rather long holiday name ${i}`, 12, 10 + i));
    const list = parts2(buildAgenda(soon, later, [], view)).list; // rows 10: a 4x4
    expect(text(list).slice(1, 8)).toEqual(["Nothing today", "Tomorrow", "Soon", "09:00", "Later", "A rather long holiday name 0", "10 Dec"]);
    expect(text(list).filter((t) => t === "Later")).toHaveLength(1);
    expect(list.children.filter((c: any) => c.t === "col")).toHaveLength(6);
    expect(parts2(buildAgenda(soon, later, [], { ...view, rows: 7 })).list.children.filter((c: any) => c.t === "col")).toHaveLength(4);
    // a window with plenty in it keeps one line each, and its own headings before Later
    const many = Array.from({ length: 5 }, (_, i) => ev(`m${i}`, local(11, 26 + i, 9)));
    const busy = text(parts2(buildAgenda(many, later.slice(0, 2), [], view)).list);
    expect(busy.filter((t) => ["Tomorrow", "This week", "Next week", "Later"].includes(t))).toEqual(["Tomorrow", "This week", "Next week", "Later"]);
  });
  test("the dot on 24 November is the calendar's own: Vietnam Culture Day", () => {
    const all = expand(parseEvents(holidays!), local(11, 1), local(12, 1) - 1, 0);
    expect(all.map((o) => o.title)).toEqual(["Vietnam Culture Day"]);
    expect(monthMarks(all, NOW)).toEqual([{ date: "2026-11-24", tone: "accent" }]);
  });
  test("ten events with headings and notes stay within 60 parts; dots within 62, a day each first", () => {
    const many = Array.from({ length: 30 }, (_, i) => ev(`event ${i}`, NOW + 3_600_000 + i * 11 * 3_600_000, 1, { calendar: i % 4 }));
    const root = buildAgenda(many, [], many, view, ["a", "b"]).root as any;
    expect(parts(root)).toBeLessThanOrEqual(60);
    expect(depth(root)).toBeLessThanOrEqual(6);
    expect(text(root.children[1])).toContain("+20 more");
    const full = Array.from({ length: 30 }, (_, d) => [0, 1, 2].map((c) => ev("x", local(11, d + 1, 9 + c), 1, { calendar: c }))).flat();
    const marks = monthMarks(full, NOW);
    expect(marks).toHaveLength(62);
    expect(new Set(marks.slice(0, 30).map((m) => m.date)).size).toBe(30);
  });
});

const SECRET = "private-9f3c2a-SECRET";
const LINK = `https://calendar.google.com/calendar/ical/me%40example.com/${SECRET}/basic.ics`;

function harness(settings: Record<string, unknown>, answer: (url: string) => Response | Error) {
  const clockRef = { now: NOW };
  const fetched: string[] = [];
  const logs: string[] = [];
  let provide: (s: any, tile?: any) => Promise<any> = async () => null;
  void createPlugin(() => clockRef.now).activate({
    id: "dev.nookdeck.calendar", log: (...a: unknown[]) => logs.push(a.join(" ")),
    settings: { get: () => settings },
    net: { fetch: async (url: string) => { fetched.push(url); const r = answer(url); if (r instanceof Error) throw r; return r; } },
    widgets: { provide: (_id: string, fn: any) => { provide = fn; }, push: () => {} },
    actions: { handle: () => {} },
  } as any);
  return { clockRef, fetched, logs, tile: async (s: Record<string, unknown> = {}, size?: { w: number; h: number }) => JSON.stringify(await provide({ ...settings, ...s }, size)) };
}
const ok = () => new Response(google!);

describe("the plugin", () => {
  test("with no link it says what to do and fetches nothing", async () => {
    const h = harness({}, ok);
    expect(await h.tile()).toContain("Add a calendar link");
    expect(h.fetched).toEqual([]);
  });

  test("the link and an event's description and place never reach the tile", async () => {
    const h = harness({ link1: LINK }, ok);
    const tile = await h.tile({ rows: 8 });
    expect(tile).toContain("Standup");
    for (const secret of [SECRET, "calendar.google.com", "me%40example.com", "secret-room", "Room 4"]) expect(tile).not.toContain(secret);
    expect(h.logs.join("\n")).not.toContain(SECRET);
  });

  test("an error that quotes the link is not passed on", async () => {
    const h = harness({ link1: LINK }, () => new Error(`Unable to connect to ${LINK}`));
    const err = await h.tile().then(() => "", (e) => String(e));
    expect(err).toContain("Calendar 1: could not load it");
    expect(err + h.logs.join("\n")).not.toContain(SECRET);
    expect(fetchProblem(new Error("x.example is not in this plugin's allowed hosts"))).toContain(UNSUPPORTED);
  });

  test("another provider gets a clear tile error and is never fetched", async () => {
    const h = harness({ link1: "https://cloud.example.com/remote.php/cal.ics" }, ok);
    await expect(h.tile()).rejects.toThrow("Calendar 1: only Google, iCloud and Outlook links work");
    expect(h.fetched).toEqual([]);
  });

  test("a good link still shows when another one is refused, in its own colour", async () => {
    const h = harness({ link1: "https://cloud.example.com/cal.ics", link2: LINK }, ok);
    const tile = await h.tile();
    expect(tile).toContain("Calendar 1: only Google, iCloud and Outlook links work");
    expect(tile).toContain('"tone":"ok"');
  });

  test("it fetches every 10 minutes, keeps the last copy when that fails, and retries after a minute", async () => {
    let fail = false;
    const h = harness({ link1: LINK }, () => (fail ? new Response("no", { status: 500 }) : ok()));
    await h.tile();
    h.clockRef.now += FETCH_EVERY_MS - 1000;
    await h.tile();
    expect(h.fetched).toHaveLength(1);
    fail = true;
    h.clockRef.now += 2000;
    const stale = await h.tile();
    expect(stale).toContain("showing the last copy");
    expect(stale).toContain("Standup");
    h.clockRef.now += RETRY_MS - 1000;
    await h.tile();
    expect(h.fetched).toHaveLength(2);
    fail = false;
    h.clockRef.now += 2000;
    expect(await h.tile()).not.toContain("last copy");
  });

  test("days ahead, first day and the clock come from the settings", async () => {
    const h = harness({ link1: LINK }, ok);
    expect(await h.tile({ days: 1, rows: 8 })).not.toContain('"Tomorrow"');
    expect(await h.tile({ days: 7, rows: 8, firstDay: "Monday" })).toContain("Next week");
    expect(await h.tile({ days: 7, rows: 8, hour24: false })).toContain("9 AM");
  });

  test("an empty week still names the next event, and only that one", async () => {
    const h = harness({ link1: LINK }, () => new Response(holidays!));
    const tile = await h.tile({ days: 7, rows: 8 });
    expect(tile).toContain("Next in 29 days");
    expect(tile).toContain("Christmas Eve");
    expect(tile).not.toContain("Christmas Day");
  });

  test("the tile's size chooses the view", async () => {
    const h = harness({ link1: LINK }, () => new Response(google!));
    const week = await h.tile({}, { w: 8, h: 4 });
    expect(week).toContain('"t":"week"');
    expect(week).not.toContain('"Today"');
    expect(await h.tile({}, { w: 4, h: 4 })).toContain('"t":"month"');
    expect(await h.tile({}, { w: 4, h: 2 })).toContain('"Today"');
    expect(await h.tile()).toContain('"Today"');
    expect(h.fetched).toHaveLength(1);
  });

  test("tiles that ask at once share one fetch", async () => {
    const h = harness({ link1: LINK }, ok);
    await Promise.all([h.tile(), h.tile(), h.tile()]);
    expect(h.fetched).toHaveLength(1);
  });
});
