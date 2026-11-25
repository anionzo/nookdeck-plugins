// Pure logic of the Batteries plugin: reading what pmset, ioreg and system_profiler print, and the card.

import type { CardData, CardNode } from "@nookdeck/plugin";

export const PMSET = "/usr/bin/pmset -g batt";
export const IOREG = "/usr/sbin/ioreg -r -c AppleDeviceManagementHIDEventService -l";
export const PROFILER = "/usr/sbin/system_profiler SPBluetoothDataType -json";

export const MAX_DEVICES = 7;

export interface Device { name: string; icon: string; percent: number; charging?: boolean; note?: string; mac?: boolean; caseLevel?: number }

const clamp = (n: number) => Math.min(100, Math.max(0, Math.round(n)));

/** The Mac's own battery; null on a Mac without one. */
export function parsePmset(out: string): Device | null {
  const m = /-InternalBattery-\d+[^\n]*?\t\s*(\d{1,3})%;\s*([^;\n]+)(?:;\s*([^\n]*))?/.exec(out);
  if (!m) return null;
  const state = m[2]!.trim().toLowerCase();
  const time = /\b(\d{1,2}):(\d{2}) remaining/.exec(m[3] ?? "");
  const hours = time ? Number(time[1]) : 0, minutes = time ? Number(time[2]) : 0;
  const left = hours ? `${hours} h ${time![2]} min` : minutes ? `${minutes} min` : "";
  const charging = state === "charging" || state === "finishing charge";
  const onPower = /'AC Power'/.test(out);
  const note = state === "discharging" ? (left ? `${left} left` : "On battery")
    : charging ? "Charging"
    : state === "charged" || onPower ? "Plugged in" : "";
  return { name: "This Mac", icon: "device-laptop", percent: clamp(Number(m[1])), charging, mac: true, ...(note ? { note } : {}) };
}

export function iconFor(kind: string, name: string): string {
  const s = `${kind} ${name}`.toLowerCase();
  if (/keyboard/.test(s) && !/trackpad/.test(s)) return "keyboard";
  if (/mouse|trackpad/.test(s)) return "mouse";
  if (/airpods|headphone|headset|buds|beats/.test(s)) return "headphones";
  if (/speaker/.test(s)) return "device-speaker";
  return "bluetooth";
}

const clean = (s: string) => s.replace(/ /g, " ").replace(/[​-‏\u0000-\u001f]/g, "").trim();

/** Magic Keyboard, Mouse and Trackpad report their level in the I/O Registry. */
export function parseIoreg(out: string): Device[] {
  const found: Device[] = [];
  for (const block of out.split(/^[ |]*\+-o /m)) {
    const level = /^[ |]*"BatteryPercent" = (\d{1,3})\s*$/m.exec(block);
    const product = /^[ |]*"Product" = "([^"\n]+)"\s*$/m.exec(block);
    if (!level || !product || /^[ |]*"Built-In" = Yes\s*$/m.test(block)) continue;
    const name = clean(product[1]!);
    found.push({ name, icon: iconFor("", name), percent: clamp(Number(level[1])) });
  }
  return found;
}

const percentOf = (v: unknown): number | null => {
  const m = typeof v === "string" ? /^\s*(\d{1,3})\s*%/.exec(v) : null;
  return m ? clamp(Number(m[1])) : null;
};

/**
 * macOS also lists AirPods as a nameless Bluetooth LE beacon, with no type and no product id: with only the case's level
 * while they are connected, and sometimes with all three levels when they are not the connected headphones.
 */
const isBeacon = (name: string, p: any) => name === "Bluetooth Device" && !p?.device_minorType && !p?.device_productID;

/** "L 64 · R 71 · Case 40", kept short enough for a 2x2 tile when the numbers are long. */
export function budsNote(left: number | null, right: number | null, box: number | null): string {
  const tail = box !== null ? [`Case ${box}`] : [];
  if (left !== null && left === right) return [`L+R ${left}`, ...tail].join(" · ");
  const join = (space: string) => [...(left !== null ? [`L${space}${left}`] : []), ...(right !== null ? [`R${space}${right}`] : []), ...tail].join(" · ");
  const wide = join(" ");
  return wide.length > 22 ? join("") : wide;
}

/** Connected Bluetooth devices that report a level. AirPods report each side and the case: one device, showing the lower side. */
export function parseBluetooth(json: string): Device[] {
  let data: any;
  try { data = JSON.parse(json); } catch { throw new Error("Could not read the Bluetooth list"); }
  const found: Device[] = [];
  const beacons: Device[] = [];
  let caseSeen = false;
  for (const controller of Array.isArray(data?.SPBluetoothDataType) ? data.SPBluetoothDataType : []) {
    for (const entry of Array.isArray(controller?.device_connected) ? controller.device_connected : []) {
      for (const [rawName, p] of Object.entries<any>(entry ?? {})) {
        const left = percentOf(p?.device_batteryLevelLeft), right = percentOf(p?.device_batteryLevelRight);
        const box = percentOf(p?.device_batteryLevelCase);
        const main = percentOf(p?.device_batteryLevelMain) ?? percentOf(p?.device_batteryLevel);
        const sides = [left, right].filter((n): n is number => n !== null);
        const percent = sides.length ? Math.min(...sides) : main ?? box;
        if (percent === null) continue;
        const name = clean(rawName);
        const caseOnly = !sides.length && main === null;
        const note = caseOnly ? "Case" : budsNote(left, right, box);
        if (isBeacon(name, p) && (caseOnly || sides.length)) {
          beacons.push(caseOnly ? { name: "Earbuds case", icon: "headphones", percent } : { name: "Earbuds", icon: "headphones", percent, note, ...(box !== null ? { caseLevel: box } : {}) });
          continue;
        }
        if (box !== null) caseSeen = true;
        found.push({ name, icon: iconFor(String(p?.device_minorType ?? ""), name), percent, ...(note ? { note } : {}), ...(box !== null && !caseOnly ? { caseLevel: box } : {}) });
      }
    }
  }
  // when a device already tells its case's level, the beacon is that same case: shown only when nothing else does
  return caseSeen ? found : [...found, ...beacons.slice(0, 1)];
}

/**
 * "AirPods Pro Thinhcv245" reads as "AirPods Pro". Only for a known Apple model followed by one word that is clearly a user
 * name (letters and digits together); anything else keeps its full name.
 */
export function shortName(name: string): string {
  const m = /^(AirPods(?: Pro| Max)?(?: [2-4])?|Magic (?:Keyboard|Mouse|Trackpad)(?: [2-4])?) (\S+)$/.exec(name);
  return m && /[A-Za-z]/.test(m[2]!) && /\d/.test(m[2]!) && !/^(gen\d+|usb-?c|\d+(st|nd|rd|th))$/i.test(m[2]!) ? m[1]! : name;
}

/**
 * The Mac first, then the others from the lowest level up (a tile that is too small leaves out the last ones). A device both
 * tools report is shown once, with the Bluetooth list's detail. Names are shortened unless two devices would end up alike.
 */
export function merge(mac: Device | null, bluetooth: Device[], registry: Device[]): Device[] {
  const key = (n: string) => n.toLowerCase();
  const byName = new Map<string, Device>();
  for (const d of [...registry, ...bluetooth]) byName.set(key(d.name), d);
  const list = [...byName.values()];
  const named = list.map((d) => {
    const short = shortName(d.name);
    return short !== d.name && list.filter((o) => shortName(o.name) === short).length === 1 ? { ...d, name: short } : d;
  });
  named.sort((a, b) => a.percent - b.percent || a.name.localeCompare(b.name));
  return [...(mac ? [mac] : []), ...named];
}

export const STYLES = ["auto", "rings", "row", "list", "lowest"] as const;
export type Style = (typeof STYLES)[number];
export type Look = Exclude<Style, "auto">;
/** The tile's size in grid cells. Nookdeck tells it from 0.5.1. */
export interface TileSize { w: number; h: number }

/** The setting wins; "auto" goes by the tile: one cell shows the lowest battery, a wide tile one row, others the rings. */
export function lookFor(style: unknown, tile?: TileSize): Look {
  if (style !== "auto" && STYLES.includes(style as Style)) return style as Look;
  if (!tile) return "rings";
  if (tile.w <= 1 && tile.h <= 1) return "lowest";
  return tile.w >= 2 * tile.h ? "row" : "rings";
}

/** green above half, amber from 20 to 50, red below 20 */
type RingNode = Extract<CardNode, { t: "ring" }>;

export const toneFor = (d: Device): "ok" | "warn" | "bad" => (d.percent > 50 ? "ok" : d.percent >= 20 ? "warn" : "bad");

/** the second line of a row; charging is always said, also by a device that has nothing else to say */
const detailOf = (d: Device): string => d.note ?? (d.charging ? "Charging" : "");

function row(d: Device, details: boolean): CardNode {
  const tone = toneFor(d);
  // the bar is always coloured; the icon and the number only when the level needs attention
  const alert = tone === "ok" ? {} : { tone };
  const detail = details ? detailOf(d) : "";
  return { t: "row", gap: 2, align: "center", children: [
    { t: "icon", name: d.icon, ...alert },
    { t: "col", gap: 0, grow: true, children: [
      { t: "row", gap: 1, children: [
        { t: "col", gap: 0, grow: true, children: [{ t: "text", text: d.name.slice(0, 200), size: "s", bold: true }] },
        { t: "text", text: `${d.percent}%`, size: "s", bold: true, ...alert },
      ] },
      { t: "progress", value: d.percent / 100, tone },
      ...(detail ? [{ t: "text", text: detail, size: "s", tone: "muted" } as CardNode] : []),
    ] },
  ] };
}

/** the charging bolt, drawn as text (not as an emoji) */
export const BOLT = "\u26A1\uFE0E";
export const MAX_RINGS = 4;

const ring = (d: Device, size: "s" | "m" | "l"): RingNode => ({
  t: "ring", value: d.percent / 100, tone: toneFor(d), icon: d.icon, size,
  label: d.charging ? `${BOLT} ${d.percent}%` : `${d.percent}%`,
});

/**
 * Like the Batteries widget of iOS: a ring per device, its icon inside and its level under it. Up to four. When there is
 * room left, the earbuds' case gets a small ring of its own beside them. `oneRow` is for a wide tile; otherwise three or
 * four rings make a 2x2 grid.
 */
function rings(devices: Device[], oneRow: boolean, most: number): CardData {
  const shown = devices.slice(0, most);
  let spare = most - shown.length;
  const dials: RingNode[] = [];
  for (const d of shown) {
    dials.push(ring(d, "m"));
    if (d.caseLevel !== undefined && spare > 0) {
      spare--;
      dials.push(ring({ name: `${d.name} case`, icon: "battery-4", percent: d.caseLevel }, "s"));
    }
  }
  const perRow = oneRow || dials.length <= 2 ? MAX_RINGS : 2;
  const rows: CardNode[] = [];
  for (let i = 0; i < dials.length; i += perRow) {
    const cells: CardNode[] = dials.slice(i, i + perRow);
    // a short last row keeps the width of the rings above it
    while (i > 0 && cells.length < perRow) cells.push({ t: "col", grow: true, children: [] });
    rows.push({ t: "row", gap: 2, grow: true, children: cells });
  }
  if (devices.length > shown.length) rows.push({ t: "text", text: `+${devices.length - shown.length} more`, size: "s", tone: "muted" });
  return { root: { t: "col", gap: 2, children: rows } };
}

function lowest(devices: Device[]): CardData {
  const d = [...devices].sort((a, b) => a.percent - b.percent)[0];
  return d ? { root: { t: "col", children: [ring(d, "l") as CardNode] } } : empty();
}

const empty = (): CardData => ({ root: { t: "col", gap: 1, align: "center", children: [{ t: "text", text: "No battery to show", size: "s", tone: "muted" }] } });

export function buildCard(devices: Device[], style: Look = "rings", tile?: TileSize): CardData {
  if (style === "lowest") return lowest(devices);
  if (!devices.length) return empty();
  // a row on a tile two cells wide has room for three rings
  if (style !== "list") return rings(devices, style === "row", style === "row" && tile && tile.w < 3 ? MAX_RINGS - 1 : MAX_RINGS);
  const shown = devices.slice(0, MAX_DEVICES);
  // a card holds at most 60 parts: with many devices the second lines are left out
  const details = shown.length <= 6;
  const children: CardNode[] = shown.map((d) => row(d, details));
  if (devices.length > shown.length) children.push({ t: "text", text: `+${devices.length - shown.length} more`, size: "s", tone: "muted" });
  // spacers centre the rows from top to bottom; align: "center" on the column would centre every line of text too
  return { root: { t: "col", gap: 2, children: [{ t: "spacer" }, ...children, { t: "spacer" }] } };
}
