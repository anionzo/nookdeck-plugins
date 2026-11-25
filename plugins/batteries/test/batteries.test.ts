import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createPlugin } from "../src/index";
import { IOREG, PMSET, PROFILER, buildCard, merge, parseBluetooth, parseIoreg, parsePmset, toneFor } from "../src/lib";

const fx = (f: string) => Bun.file(join(import.meta.dir, "fixtures", f)).text();
const [pm, ioNone, ioMagic, btNone, btOn] = await Promise.all(["pmset-discharging.txt", "ioreg-internal-only.txt", "ioreg-magic.txt", "bluetooth-none-connected.json", "bluetooth-connected.json"].map(fx));

const line = (state: string, source = "AC Power") => `Now drawing from '${source}'\n -InternalBattery-0 (id=1)\t80%; ${state} present: true\n`;

describe("pmset", () => {
  test("recorded: on battery with time left", () => {
    expect(parsePmset(pm!)).toMatchObject({ name: "This Mac", charging: false });
    expect(parsePmset(pm!)!.note).toMatch(/^\d+ h \d\d min left$/);
  });
  test("the other states", () => {
    expect(parsePmset(line("charging; 1:05 remaining"))).toMatchObject({ percent: 80, charging: true, note: "1 h 05 min to full" });
    expect(parsePmset(line("charging; 0:41 remaining"))!.note).toBe("41 min to full");
    expect(parsePmset(line("charging; (no estimate)"))!.note).toBe("Charging");
    expect(parsePmset(line("charged; 0:00 remaining"))!.note).toBe("Charged");
    expect(parsePmset(line("AC attached; not charging"))!.note).toBe("Plugged in, not charging");
    expect(parsePmset(line("discharging; (no estimate)", "Battery Power"))!.note).toBe("On battery");
  });
  test("a Mac without a battery", () => {
    expect(parsePmset("Now drawing from 'AC Power'\n")).toBeNull();
  });
});

describe("Bluetooth devices", () => {
  test("the built-in keyboard is not a Bluetooth device", () => {
    expect(parseIoreg(ioNone!)).toEqual([]);
  });
  test("Magic devices from ioreg", () => {
    expect(parseIoreg(ioMagic!)).toEqual([{ name: "Magic Keyboard", icon: "keyboard", percent: 62 }, { name: "Magic Trackpad", icon: "mouse", percent: 9 }]);
  });
  test("disconnected devices are hidden", () => {
    expect(parseBluetooth(btNone!)).toEqual([]);
    expect(parseBluetooth(btOn!).map((d) => d.name)).not.toContain("Old AirPods");
  });
  test("AirPods show the lower side, with each side and the case", () => {
    const pods = parseBluetooth(btOn!).find((d) => d.name === "AirPods Pro")!;
    expect(pods).toEqual({ name: "AirPods Pro", icon: "headphones", percent: 18, note: "L95 R18 case 40" });
    expect(parseBluetooth(btOn!).find((d) => d.name === "Case Only Buds")).toMatchObject({ percent: 55, note: "Case" });
  });
  test("a device both tools report is shown once", () => {
    const all = merge(parsePmset(pm!), parseBluetooth(btOn!), parseIoreg(ioMagic!));
    expect(all.map((d) => d.name)).toEqual(["This Mac", "AirPods Pro", "Case Only Buds", "Magic Keyboard", "Magic Trackpad"]);
    expect(all.find((d) => d.name === "Magic Keyboard")!.percent).toBe(61);
    expect(all.map(toneFor)).toEqual(["default", "warn", "default", "default", "bad"]);
  });
});

describe("the card", () => {
  test("many devices still fit the card limits", () => {
    for (const n of [0, 1, 6, 8, 30]) {
      const card = buildCard(Array.from({ length: n }, (_, i) => ({ name: `Device ${i}`, icon: "bluetooth", percent: 50, note: "note" })));
      let nodes = 0, depth = 0;
      const walk = (x: any, d: number) => { nodes++; depth = Math.max(depth, d); for (const c of x.children ?? []) walk(c, d + 1); };
      walk(card.root, 1);
      expect(nodes).toBeLessThanOrEqual(60);
      expect(depth).toBeLessThanOrEqual(6);
    }
  });
});

describe("the plugin", () => {
  const provider = (answer: (cmd: string) => { code: number; stdout: string }) => {
    let fn: any;
    createPlugin().activate({ log() {}, shell: { run: async (c: string) => answer(c) }, widgets: { provide: (_: string, f: unknown) => { fn = f; } }, actions: { handle() {} } } as any);
    return fn as (s: object) => Promise<any>;
  };
  const out: Record<string, string> = { [PMSET]: pm!, [IOREG]: ioMagic!, [PROFILER]: btOn! };
  test("one failing tool does not empty the card, and the Mac can be hidden", async () => {
    const p = provider((c) => (c === PROFILER ? { code: 1, stdout: "" } : { code: 0, stdout: out[c]! }));
    const card = JSON.stringify(await p({}));
    expect(card).toContain("This Mac");
    expect(card).toContain("Magic Keyboard");
    expect(JSON.stringify(await p({ showMac: false }))).not.toContain("This Mac");
  });
  test("all three failing is an error", async () => {
    await expect(provider(() => ({ code: 1, stdout: "" }))({})).rejects.toThrow("Could not read any battery");
  });
});
