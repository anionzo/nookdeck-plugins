import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createPlugin } from "../src/index";
import { ASSERTIONS, DARK_MODE, DISPLAY_OFF, LOCK, awakeCommand, awakeLabel, buildCard, ringText, checkMinutes, displayCaffeinates, failure, stopCommand } from "../src/lib";

const assertions = await Bun.file(join(import.meta.dir, "fixtures/assertions.txt")).text();

describe("parsing and commands", () => {
  test("only caffeinate processes that keep the display awake count", () => {
    // the fixture has `caffeinate -i` processes (system sleep only), another app's display assertion and one `caffeinate -d`
    expect(displayCaffeinates(assertions)).toEqual([4242]);
  });
  test("minutes are whole numbers in range, so nothing else reaches a command line", () => {
    expect(checkMinutes(undefined)).toBe(60);
    expect(checkMinutes("15")).toBe(15);
    for (const bad of [-1, 1441, 1.5, "5; rm -rf /", NaN]) expect(() => checkMinutes(bad)).toThrow();
    expect(awakeCommand(15)).toBe("nohup /usr/bin/caffeinate -d -t 900 -w $PPID >/dev/null 2>&1 & echo $!");
    expect(awakeCommand(0)).toBe("nohup /usr/bin/caffeinate -d -w $PPID >/dev/null 2>&1 & echo $!");
    for (const bad of [0, 1, -5, 2.5]) expect(() => stopCommand(bad)).toThrow();
  });
  test("labels and permission messages", () => {
    expect(awakeLabel(null, 0)).toBe("Keep awake");
    expect(awakeLabel({ pid: 9, until: 0 }, 0)).toBe("Awake");
    expect(awakeLabel({ pid: 9, until: 42 * 60_000 }, 0)).toBe("42 min");
    expect(awakeLabel({ pid: 9, until: 150 * 60_000 }, 0)).toBe("2 h 30 m");
    expect(failure("execution error: Not authorized to send Apple events to System Events. (-1743)", "x")).toContain("Automation");
    expect(failure("System Events got an error: osascript is not allowed to send keystrokes. (1002)", "x")).toContain("Accessibility");
    expect(failure("", "x")).toBe("x");
  });
  test("a ring for the time left, only on a wide tile with a timed keep awake", () => {
    const at = (tile: { w: number; h: number }, until: number, minutes?: number) => JSON.stringify(buildCard({ appearance: "Dark", awake: { pid: 9, until, minutes }, minutes: 60, now: 0, tile }));
    expect(at({ w: 4, h: 2 }, 42 * 60_000, 60)).toContain('"t":"ring","value":0.7,"tone":"accent","text":"42m"');
    expect(ringText({ pid: 9, until: 150 * 60_000 }, 0)).toBe("2h30");
    for (const none of [at({ w: 2, h: 2 }, 42 * 60_000, 60), at({ w: 4, h: 2 }, 0, 0), at({ w: 4, h: 2 }, 42 * 60_000)]) expect(none).not.toContain('"ring"');
  });
  test("one cell is one button, the chosen one", () => {
    const at = (single?: string, problem?: string) => (buildCard({ appearance: "Light", awake: null, minutes: 60, now: 0, tile: { w: 1, h: 1 }, single, problem }).root as any).children;
    expect(at().map((b: any) => b.action)).toEqual(["dark-mode"]);
    expect(["dark-mode", "keep-awake", "lock", "display-off"].map((x) => at(x)[0].action)).toEqual(["dark-mode", "keep-awake", "lock", "display-off"]);
    expect(at("lock", "Allow it")[0].tone).toBe("warn");
  });
  test("the card shows the state", () => {
    const card = JSON.stringify(buildCard({ appearance: "Dark", awake: { pid: 9, until: 0 }, minutes: 30, now: 0 }));
    expect(card).toContain('"label":"Dark","icon":"moon","layout":"tile"');
    expect(card).toContain('"label":"Awake"');
    expect(card).toContain('"minutes":30');
  });
});

describe("the plugin", () => {
  const harness = () => {
    const calls: string[] = [];
    const store = new Map<string, unknown>();
    const alive = new Set<number>();
    const providers: Record<string, any> = {}, handlers: Record<string, any> = {};
    let clock = 1_000_000, nextPid = 100;
    let refuse = "";
    /** how many looks at the system's list a new caffeinate stays missing from it */
    let slow = 0, missing = 0;
    const ctx: any = {
      log() {},
      storage: { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: unknown) => { if (v == null) store.delete(k); else store.set(k, v); } },
      shell: {
        run: async (cmd: string) => {
          calls.push(cmd);
          if (refuse && cmd.includes("System Events")) return { code: 1, stdout: refuse };
          if (cmd === ASSERTIONS && missing > 0) { missing--; return { code: 0, stdout: "" }; }
          if (cmd === ASSERTIONS) return { code: 0, stdout: [...alive].map((p) => `   pid ${p}(caffeinate): [0x1] 00:00:01 PreventUserIdleDisplaySleep named: "caffeinate command-line tool"`).join("\n") };
          if (cmd.startsWith("nohup")) { missing = slow; alive.add(++nextPid); return { code: 0, stdout: `${nextPid}\n` }; }
          if (cmd.startsWith("kill ")) { alive.delete(Number(cmd.split(" ")[1])); return { code: 0, stdout: "" }; }
          if (cmd.includes("AppleInterfaceStyle")) return { code: 0, stdout: "Light\n" };
          return { code: 0, stdout: "" };
        },
      },
      widgets: { provide: (id: string, fn: unknown) => { providers[id] = fn; } },
      actions: { handle: (id: string, fn: unknown) => { handlers[id] = fn; } },
    };
    createPlugin(() => clock).activate(ctx);
    return { calls, store, alive, act: (id: string, s: object = {}) => handlers[id](s), card: async () => JSON.stringify(await providers.controls({})), tick: (ms: number) => { clock += ms; }, refuse: (s: string) => { refuse = s; }, slow: (n: number) => { slow = n; } };
  };

  test("keep awake turns on and off", async () => {
    const h = harness();
    await h.act("keep-awake", { minutes: 10 });
    expect(await h.card()).toContain("10 min");
    await h.act("keep-awake", { minutes: 10 });
    expect(h.alive.size).toBe(0);
    expect(await h.card()).toContain("Keep awake");
  });
  test("a refresh while caffeinate is still starting does not forget it", async () => {
    const h = harness();
    h.slow(3);
    const started = h.act("keep-awake", { minutes: 10 });
    await h.card();
    await started;
    expect(await h.card()).toContain("10 min");
    expect(h.alive.size).toBe(1);
  });
  test("one that never shows up is stopped and reported", async () => {
    const h = harness();
    h.slow(999);
    await expect(h.act("keep-awake", { minutes: 10 })).rejects.toThrow("Could not keep the Mac awake");
    expect(h.alive.size).toBe(0);
    expect(h.store.size).toBe(0);
  }, 10_000);
  test("two quick taps do not start two", async () => {
    const h = harness();
    await Promise.all([h.act("keep-awake", { minutes: 0 }), h.act("keep-awake", { minutes: 0 })]);
    expect(h.calls.filter((c) => c.startsWith("nohup")).length).toBe(1);
    expect(h.alive.size).toBe(0);
  });
  test("a caffeinate that ended is forgotten, and its pid is never killed", async () => {
    const h = harness();
    await h.act("keep-awake", { minutes: 5 });
    h.alive.clear(); // it ended, and the pid may now belong to anything
    expect(await h.card()).toContain("Keep awake");
    expect(h.store.size).toBe(0);
    await h.act("keep-awake", { minutes: 5 });
    expect(h.calls.some((c) => c.startsWith("kill "))).toBe(false);
  });
  test("a refused permission is thrown and written on the card for a minute", async () => {
    const h = harness();
    h.refuse("execution error: Not authorized to send Apple events to System Events. (-1743)");
    await expect(h.act("dark-mode", { mode: "toggle" })).rejects.toThrow("Automation");
    expect(await h.card()).toContain("Automation");
    h.tick(61_000);
    expect(await h.card()).not.toContain("Automation");
  });
  test("each button runs its fixed command", async () => {
    const h = harness();
    await h.act("dark-mode", { mode: "light" });
    await h.act("display-off");
    await h.act("lock");
    expect(h.calls).toEqual([DARK_MODE.light, DISPLAY_OFF, LOCK]);
    await expect(h.act("dark-mode", { mode: "x'; true" })).rejects.toThrow("toggle, light or dark");
  });
});
