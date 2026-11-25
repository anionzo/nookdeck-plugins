import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createPlugin } from "../src/index";
import { IOREG, PMSET, PROFILER, STYLES, buildCard, merge, parseBluetooth, parseIoreg, parsePmset, shortName, budsNote, toneFor } from "../src/lib";

const fx = (f: string) => Bun.file(join(import.meta.dir, "fixtures", f)).text();
const [pm, ioNone, ioMagic, btNone, btOn, pods] = await Promise.all(["pmset-discharging.txt", "ioreg-internal-only.txt", "ioreg-magic.txt", "bluetooth-none-connected.json", "bluetooth-connected.json", "bluetooth-airpods.json"].map(fx));

const line = (state: string, source = "AC Power") => `Now drawing from '${source}'\n -InternalBattery-0 (id=1)\t80%; ${state} present: true\n`;

describe("pmset", () => {
  test("recorded: on battery with time left", () => {
    expect(parsePmset(pm!)).toMatchObject({ name: "This Mac", charging: false });
    expect(parsePmset(pm!)!.note).toMatch(/^\d+ h \d\d min left$/);
  });
  test("the other states", () => {
    expect(parsePmset(line("charging; 1:05 remaining"))).toMatchObject({ percent: 80, charging: true, note: "Charging" });
    expect(parsePmset(line("charging; (no estimate)"))!.note).toBe("Charging");
    expect(parsePmset(line("charged; 0:00 remaining"))!.note).toBe("Plugged in");
    expect(parsePmset(line("AC attached; not charging"))!.note).toBe("Plugged in");
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
    expect(pods).toEqual({ name: "AirPods Pro", icon: "headphones", percent: 18, note: "L 95 · R 18 · Case 40" });
    expect(parseBluetooth(btOn!).find((d) => d.name === "Case Only Buds")).toMatchObject({ percent: 55, note: "Case" });
  });
  test("a device both tools report is shown once; the Mac stays on top, then lowest first", () => {
    const all = merge(parsePmset(pm!), parseBluetooth(btOn!), parseIoreg(ioMagic!));
    expect(all.map((d) => d.name)).toEqual(["This Mac", "Magic Trackpad", "AirPods Pro", "Case Only Buds", "Magic Keyboard"]);
    expect(all.find((d) => d.name === "Magic Keyboard")!.percent).toBe(61);
    expect(all.map(toneFor)).toEqual(["ok", "bad", "bad", "ok", "ok"]);
  });
  test("tones: green above 50, amber 20 to 50, red below 20", () => {
    expect([100, 51, 50, 20, 19, 0].map((percent) => toneFor({ name: "x", icon: "x", percent }))).toEqual(["ok", "ok", "warn", "warn", "bad", "bad"]);
  });
});

describe("AirPods, as recorded on a Mac", () => {
  test("one device: the case's own Bluetooth LE beacon is not a second row", () => {
    expect(parseBluetooth(pods!)).toEqual([{ name: "AirPods Pro", icon: "headphones", percent: 100, note: "L+R 100 · Case 88" }]);
  });
  test("the beacon alone is shown as the earbuds case", () => {
    const only = JSON.parse(pods!);
    only.SPBluetoothDataType[0].device_connected.shift();
    expect(parseBluetooth(JSON.stringify(only))).toEqual([{ name: "Earbuds case", icon: "headphones", percent: 88 }]);
  });
  test("the detail line stays short enough for a 2x2 tile", () => {
    expect(budsNote(64, 71, 40)).toBe("L 64 · R 71 · Case 40");
    expect(budsNote(100, 99, 100)).toBe("L100 · R99 · Case 100");
    expect(budsNote(null, 100, null)).toBe("R 100");
  });
  test("one bud in, and no case level", () => {
    const one = JSON.stringify({ SPBluetoothDataType: [{ device_connected: [{ "AirPods Pro": { device_minorType: "Headphones", device_batteryLevelRight: "73%" } }] }] });
    expect(parseBluetooth(one)).toEqual([{ name: "AirPods Pro", icon: "headphones", percent: 73, note: "R 73" }]);
  });
  test("an owner suffix is dropped only when it is clearly one", () => {
    expect(shortName("AirPods Pro Thinhcv245")).toBe("AirPods Pro");
    expect(shortName("Magic Keyboard nam99")).toBe("Magic Keyboard");
    for (const keep of ["AirPods Pro", "AirPods Pro 2", "AirPods Max USB-C", "AirPods Pro Office", "AirPods Pro 2nd", "Duy’s AirPods Max", "WH-1000XM4", "JBL LIVE PRO2"]) expect(shortName(keep)).toBe(keep);
    // two that would look alike keep their full names
    const two = ["AirPods Pro a1", "AirPods Pro b2"].map((name) => ({ name, icon: "headphones", percent: 50 }));
    expect(merge(null, two, []).map((d) => d.name)).toEqual(["AirPods Pro a1", "AirPods Pro b2"]);
  });
});

describe("the card", () => {
  test("compact has no second lines; lowest shows only the lowest battery", () => {
    const list = [{ name: "This Mac", icon: "device-laptop", percent: 80, note: "Charging" }, { name: "Mouse", icon: "mouse", percent: 9 }];
    expect(JSON.stringify(buildCard(list, "compact"))).not.toContain("Charging");
    const low = JSON.stringify(buildCard(list, "lowest"));
    expect(low).toContain('"value":"9%"');
    expect(low).not.toContain("This Mac");
  });
  test("many devices still fit the card limits", () => {
    for (const [n, style] of [0, 1, 6, 7, 8, 30].flatMap((n) => STYLES.map((s) => [n, s] as const))) {
      const card = buildCard(Array.from({ length: n }, (_, i) => ({ name: `Device ${i}`, icon: "bluetooth", percent: 50, note: "note" })), style);
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
