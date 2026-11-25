import { describe, expect, test } from "bun:test";
import { createPlugin } from "../src/index";
import { START, buildCard, clock, dayKey, lengths, prune, readDays, readState, remaining, settle, skip, toggle, type State } from "../src/lib";

const MIN = 60_000;
const len = lengths({});
const at = (day: number, h: number, m = 0, s = 0) => new Date(2026, 10, day, h, m, s).getTime();

describe("the timer", () => {
  test("lengths come from the settings, 1 to 180 minutes", () => {
    expect(len).toEqual({ focus: 25 * MIN, break: 5 * MIN });
    expect(lengths({ focus: 50, break: 10 })).toEqual({ focus: 50 * MIN, break: 10 * MIN });
    expect(lengths({ focus: 0, break: "x" })).toEqual({ focus: 25 * MIN, break: 5 * MIN });
    expect(lengths({ focus: 999 }).focus).toBe(180 * MIN);
  });
  test("start, pause, resume keep the time that is left", () => {
    const t0 = at(25, 9);
    const running = toggle(START, len, t0);
    expect(remaining(running, len, t0 + 10 * MIN).left).toBe(15 * MIN);
    const paused = toggle(running, len, t0 + 10 * MIN);
    expect(remaining(paused, len, t0 + 3 * 60 * MIN).left).toBe(15 * MIN);
    const again = toggle(paused, len, t0 + 3 * 60 * MIN);
    expect(remaining(again, len, t0 + 3 * 60 * MIN + 5 * MIN)).toEqual({ left: 10 * MIN, total: 25 * MIN });
  });
  test("a block that ended while nobody looked counts once, on the day it ended", () => {
    const running = toggle(START, len, at(25, 23, 30));
    const first = settle(running, {}, at(26, 8));
    expect(first.state).toEqual({ phase: "break", status: "ready" });
    expect(first.days).toEqual({ "2026-11-25": 1 });
    expect(settle(first.state, first.days, at(26, 9)).days).toEqual({ "2026-11-25": 1 });
  });
  test("a break and a skipped block do not count", () => {
    const brk = toggle(skip(START), len, at(25, 9));
    expect(brk.phase).toBe("break");
    expect(settle(brk, {}, at(25, 10))).toMatchObject({ days: {}, state: { phase: "focus", status: "ready" } });
    expect(skip(toggle(START, len, at(25, 9)))).toEqual({ phase: "break", status: "ready" });
  });
  test("the last 30 days are kept", () => {
    const days: Record<string, number> = {};
    for (let i = 0; i < 45; i++) days[dayKey(new Date(2026, 10, 25 - i, 12).getTime())] = 1;
    const kept = Object.keys(prune(days, at(25, 18))).sort();
    expect(kept).toHaveLength(30);
    expect([kept[0], kept.at(-1)]).toEqual(["2026-10-27", "2026-11-25"]);
  });
  test("damaged storage starts over", () => {
    for (const v of [null, 5, "x", [], { phase: "nap" }]) expect(readState(v)).toEqual(START);
    expect(readState({ phase: "break", status: "running" })).toEqual({ phase: "break", status: "ready" });
    expect(readDays({ "2026-11-25": 2, junk: 1, "2026-11-24": -1 })).toEqual({ "2026-11-25": 2 });
  });
  test("the clock rounds up", () => {
    expect([clock(25 * MIN), clock(24 * MIN + 59_001), clock(1), clock(0), clock(120 * MIN)]).toEqual(["25:00", "25:00", "00:01", "00:00", "120:00"]);
  });
  test("the card says what the buttons will do", () => {
    const find = (s: State) => JSON.stringify(buildCard(s, { "2026-11-25": 3 }, len, at(25, 9)));
    expect(find(START)).toContain('"label":"Start"');
    expect(find(START)).toContain('"text":"3 today"');
    expect(find(toggle(START, len, at(25, 9)))).toContain('"label":"Pause"');
    expect(find({ phase: "break", status: "paused", left: MIN, total: 5 * MIN })).toContain('"label":"Resume"');
  });
});

/** The plugin against a fake agent with its own clock. `store` outlives a restart, like the plugin's data file. */
function harness(store = new Map<string, unknown>(), clockRef = { now: at(25, 9) }) {
  const pushes: any[] = [];
  const acts: Record<string, (s: any) => any> = {};
  let provide: () => Promise<any> = async () => null;
  let tick: (() => void) | null = null;
  const plugin = createPlugin({ now: () => clockRef.now, every: (fn) => { tick = fn; return () => { tick = null; }; } });
  void plugin.activate({
    id: "dev.nookdeck.pomodoro", log: () => {},
    settings: { get: () => ({ focus: 25, break: 5 }) },
    storage: { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: unknown) => { store.set(k, structuredClone(v)); } },
    net: { fetch: async () => { throw new Error("no network"); } },
    widgets: { provide: (_id: string, fn: any) => { provide = () => fn({}); }, push: (_id: string, u: any) => pushes.push(u) },
    actions: { handle: (id: string, fn: any) => { acts[id] = fn; } },
  } as any);
  const settleTicks = () => new Promise((r) => setTimeout(r, 5));
  return {
    store, clockRef, pushes, plugin,
    act: (id: string) => acts[id]!({}),
    card: async () => JSON.stringify((await provide()).data),
    ticking: () => tick !== null,
    tick: async () => { tick?.(); await settleTicks(); },
  };
}

describe("the plugin", () => {
  test("it ticks every second only while a phase runs", async () => {
    const h = harness();
    await h.card();
    expect(h.ticking()).toBe(false);
    await h.act("toggle");
    expect(h.ticking()).toBe(true);
    h.clockRef.now += 1000;
    await h.tick();
    expect(JSON.stringify(h.pushes.at(-1))).toContain('"value":"24:59"');
    await h.act("toggle");
    expect(h.ticking()).toBe(false);
  });

  test("keeps time when its process was stopped while the phone slept, and counts the block once", async () => {
    const a = harness();
    await a.act("toggle");
    a.plugin.deactivate!();
    a.clockRef.now += 40 * MIN;
    const b = harness(a.store, a.clockRef);
    const card = await b.card();
    expect(card).toContain('"text":"Break"');
    expect(card).toContain('"text":"1 today"');
    expect(await b.card()).toContain('"text":"1 today"');
    expect(b.ticking()).toBe(false);
  });

  test("resumes ticking after a restart in the middle of a block", async () => {
    const a = harness();
    await a.act("toggle");
    a.plugin.deactivate!();
    a.clockRef.now += 10 * MIN;
    const b = harness(a.store, a.clockRef);
    expect(await b.card()).toContain('"value":"15:00"');
    expect(b.ticking()).toBe(true);
  });

  test("ticks, polls and taps together count a finished block once", async () => {
    const h = harness();
    await h.act("toggle");
    h.clockRef.now += 25 * MIN + 10_000;
    await Promise.all([h.card(), h.card(), h.tick(), h.act("reset")]);
    expect(h.store.get("days")).toEqual({ "2026-11-25": 1 });
  });

  test("a tap just as the time runs out does not start the break", async () => {
    const h = harness();
    await h.act("toggle");
    h.clockRef.now += 25 * MIN + 500;
    await h.act("toggle");
    expect(h.store.get("timer")).toEqual({ phase: "break", status: "ready" });
    await h.act("toggle");
    expect(h.store.get("timer")).toMatchObject({ phase: "break", status: "running" });
  });
});
