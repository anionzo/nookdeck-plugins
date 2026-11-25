import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createPlugin } from "../src/index";
import { IOREG, PMSET, PROFILER, STYLES, buildCard, merge, parseBluetooth, parseIoreg, parsePmset, shortName, budsNote, parseIOBluetooth, IOBT, IOBT_SCRIPT, toneFor, lookFor, BOLT } from "../src/lib";

const fx = (f: string) => Bun.file(join(import.meta.dir, "fixtures", f)).text();
const [pm, ioNone, ioMagic, btNone, btOn, pods, iobt] = await Promise.all(["pmset-discharging.txt", "ioreg-internal-only.txt", "ioreg-magic.txt", "bluetooth-none-connected.json", "bluetooth-connected.json", "bluetooth-airpods.json", "iobluetooth-headset.json"].map(fx));

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
    expect(pods).toEqual({ name: "AirPods Pro", icon: "headphones", percent: 18, note: "L 95 · R 18 · Case 40", caseLevel: 40 });
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
    expect(parseBluetooth(pods!)).toEqual([{ name: "AirPods Pro", icon: "headphones", percent: 100, note: "L+R 100 · Case 88", caseLevel: 88 }]);
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
  test("the nameless entry with all three levels reads as earbuds", () => {
    const json = JSON.stringify({ SPBluetoothDataType: [{ device_connected: [{ "Bluetooth Device": { device_batteryLevelLeft: "100%", device_batteryLevelRight: "100%", device_batteryLevelCase: "88%" } }] }] });
    expect(parseBluetooth(json)).toEqual([{ name: "Earbuds", icon: "headphones", percent: 100, note: "L+R 100 · Case 88", caseLevel: 88 }]);
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
  const ringsOf = (card: any): any[] => { const out: any[] = []; const walk = (x: any) => { if (x.t === "ring") out.push(x); for (const c of x.children ?? []) walk(c); }; walk(card.root); return out; };
  const some = [
    { name: "This Mac", icon: "device-laptop", percent: 80, charging: true, mac: true, note: "Charging" },
    { name: "Mouse", icon: "mouse", percent: 9 },
    { name: "AirPods Pro", icon: "headphones", percent: 40, caseLevel: 88 },
  ];
  test("rings: icon inside, level under, tone by level, a bolt while charging", () => {
    expect(ringsOf(buildCard(some.slice(0, 2)))).toEqual([
      { t: "ring", value: 0.8, tone: "ok", icon: "device-laptop", size: "m", label: `${BOLT} 80%` },
      { t: "ring", value: 0.09, tone: "bad", icon: "mouse", size: "m", label: "9%" },
    ]);
  });
  test("the earbuds' case has a small ring while there is room, never in place of a device", () => {
    expect(ringsOf(buildCard(some)).map((r) => [r.icon, r.size])).toEqual([["device-laptop", "m"], ["mouse", "m"], ["headphones", "m"], ["battery-4", "s"]]);
    const full = [...some, { name: "Keyboard", icon: "keyboard", percent: 60 }];
    expect(ringsOf(buildCard(full)).map((r) => r.icon)).toEqual(["device-laptop", "mouse", "headphones", "keyboard"]);
  });
  test("four rings make a grid, or one row for a wide tile", () => {
    expect((buildCard(some).root as any).children.map((row: any) => row.children.length)).toEqual([2, 2]);
    expect((buildCard(some, "row").root as any).children.map((row: any) => row.children.length)).toEqual([4]);
    expect((buildCard(some.slice(0, 2)).root as any).children).toHaveLength(1);
  });
  test("list keeps names and second lines; lowest is the one ring that needs attention", () => {
    expect(JSON.stringify(buildCard(some, "list"))).toContain("Charging");
    expect(ringsOf(buildCard(some, "lowest")).map((r) => [r.label, r.size])).toEqual([["9%", "l"]]);
  });
  test("auto goes by the tile size; the setting wins over it", () => {
    const at = (w: number, h: number) => lookFor("auto", { w, h });
    expect([at(1, 1), at(2, 1), at(4, 2), at(2, 2), at(3, 3)]).toEqual(["lowest", "row", "row", "rings", "rings"]);
    expect(lookFor(undefined, { w: 1, h: 1 })).toBe("lowest");
    expect(lookFor("auto")).toBe("rings");
    expect(lookFor("list", { w: 1, h: 1 })).toBe("list");
    const five = Array.from({ length: 5 }, (_, i) => ({ name: `D${i}`, icon: "mouse", percent: 50 }));
    expect(ringsOf(buildCard(five, "row", { w: 2, h: 1 }))).toHaveLength(3);
    expect(ringsOf(buildCard(five, "row", { w: 4, h: 2 }))).toHaveLength(4);
  });
  test("many devices still fit the card limits", () => {
    for (const [n, style] of [0, 1, 6, 7, 8, 30].flatMap((n) => STYLES.map((s) => [n, lookFor(s)] as const))) {
      const card = buildCard(Array.from({ length: n }, (_, i) => ({ name: `Device ${i}`, icon: "bluetooth", percent: 50, note: "note" })), style);
      let nodes = 0, depth = 0;
      const walk = (x: any, d: number) => { nodes++; depth = Math.max(depth, d); for (const c of x.children ?? []) walk(c, d + 1); };
      walk(card.root, 1);
      expect(nodes).toBeLessThanOrEqual(60);
      expect(depth).toBeLessThanOrEqual(6);
    }
  });
});

describe("IOBluetooth", () => {
  test("a headset that tells its level only here: one ring's worth, with the headphones icon and its real name", () => {
    expect(parseIOBluetooth(iobt!)).toEqual([{ name: "WH-1000XM4", icon: "headphones", percent: 80 }]);
  });
  test("0 is unknown; sides and case win over a single level; rubbish is nothing", () => {
    const one = (o: object) => parseIOBluetooth(JSON.stringify([{ name: "AirPods Pro", major: 4, single: 0, left: 0, right: 0, case: 0, combined: 0, ...o }]));
    expect(one({})).toEqual([]);
    expect(one({ single: 50, left: 64, right: 71, case: 40 })).toEqual([{ name: "AirPods Pro", icon: "headphones", percent: 64, note: "L 64 · R 71 · Case 40", caseLevel: 40 }]);
    expect(one({ combined: 55 })[0]!.percent).toBe(55);
    expect(one({ case: 30 })[0]).toMatchObject({ percent: 30, note: "Case" });
    expect(parseIOBluetooth("execution error")).toEqual([]);
  });
  test("merged by name: the sides are kept, and the nameless entry of the same pair is dropped", () => {
    const pair = { name: "AirPods Pro", icon: "headphones", percent: 64, note: "L 64 · R 71 · Case 40", caseLevel: 40 };
    const plain = { name: "AirPods Pro", icon: "headphones", percent: 70 };
    expect(merge(null, [plain], [], [pair])).toEqual([pair]);
    expect(merge(null, [pair], [], [plain])).toEqual([pair]);
    const beacon = { name: "Earbuds", icon: "headphones", percent: 64, note: "L 64 · R 71 · Case 40", caseLevel: 40 };
    expect(merge(null, [beacon], [], [pair]).map((d) => d.name)).toEqual(["AirPods Pro"]);
    expect(merge(null, [beacon], [], parseIOBluetooth(iobt!)).map((d) => d.name)).toEqual(["Earbuds", "WH-1000XM4"]);
  });
  test("the command only reads, and the shell gets the script whole", () => {
    expect(IOBT_SCRIPT).not.toContain("'");
    expect(IOBT.startsWith("/usr/bin/osascript -l JavaScript -e '")).toBe(true);
    expect(IOBT_SCRIPT).not.toMatch(/address|openConnection|closeConnection|remove|set[A-Z]/);
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
    const card = JSON.stringify(await p({ style: "list" }));
    expect(card).toContain("This Mac");
    expect(card).toContain("Magic Keyboard");
    expect(JSON.stringify(await p({ style: "list", showMac: false }))).not.toContain("This Mac");
  });
  test("IOBluetooth is extra: refused, silent or slow, the others carry on", async () => {
    const base = (c: string) => ({ code: 0, stdout: c === IOBT ? iobt! : out[c]! });
    expect(JSON.stringify(await provider(base)({ style: "list" }))).toContain("WH-1000XM4");
    const refused = provider((c) => (c === IOBT ? { code: 1, stdout: "" } : base(c)));
    expect(JSON.stringify(await refused({ style: "list" }))).toContain("This Mac");
    let slow: any;
    createPlugin(20).activate({ log() {}, shell: { run: (c: string) => (c === IOBT ? new Promise(() => {}) : Promise.resolve(base(c))) }, widgets: { provide: (_: string, f: unknown) => { slow = f; } }, actions: { handle() {} } } as any);
    expect(JSON.stringify(await slow({ style: "list" }))).toContain("This Mac");
  });
  test("all three failing is an error", async () => {
    await expect(provider(() => ({ code: 1, stdout: "" }))({})).rejects.toThrow("Could not read any battery");
  });
});

describe("the manifest's sample", () => {
  test("is the ring card the plugin builds for four devices, one charging and one low", async () => {
    const manifest = await Bun.file(join(import.meta.dir, "../nookdeck.json")).json();
    expect(manifest.widgets[0].preview).toEqual(buildCard([
      { name: "This Mac", icon: "device-laptop", percent: 95, charging: true, mac: true },
      { name: "Magic Mouse", icon: "mouse", percent: 18 },
      { name: "Magic Keyboard", icon: "keyboard", percent: 62 },
      { name: "Headphones", icon: "headphones", percent: 80 },
    ], "rings"));
  });
});

