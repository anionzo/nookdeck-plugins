// Pure logic of the Batteries plugin: reading what pmset, ioreg and system_profiler print, and the card.

export const PMSET = "/usr/bin/pmset -g batt";
export const IOREG = "/usr/sbin/ioreg -r -c AppleDeviceManagementHIDEventService -l";
export const PROFILER = "/usr/sbin/system_profiler SPBluetoothDataType -json";

export const MAX_DEVICES = 8;

export interface Device { name: string; icon: string; percent: number; charging?: boolean; note?: string; mac?: boolean }

const clamp = (n: number) => Math.min(100, Math.max(0, Math.round(n)));

/** The Mac's own battery; null on a Mac without one. */
export function parsePmset(out: string): Device | null {
  const m = /-InternalBattery-\d+[^\n]*?\t\s*(\d{1,3})%;\s*([^;\n]+)(?:;\s*([^\n]*))?/.exec(out);
  if (!m) return null;
  const state = m[2]!.trim().toLowerCase();
  const time = /\b(\d{1,2}):(\d{2}) remaining/.exec(m[3] ?? "");
  const left = time && (time[1] !== "0" || time[2] !== "00") ? `${Number(time[1])} h ${time[2]} min` : "";
  const charging = state === "charging" || state === "finishing charge";
  const onPower = /'AC Power'/.test(out);
  const note = state === "discharging" ? (left ? `${left} left` : "On battery")
    : charging ? (left ? `Charging, ${left} to full` : "Charging")
    : state === "charged" ? "Charged"
    : onPower ? "Plugged in, not charging" : "";
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

/** Connected Bluetooth devices that report a level. AirPods report each side and the case: the tile shows the lower side. */
export function parseBluetooth(json: string): Device[] {
  let data: any;
  try { data = JSON.parse(json); } catch { throw new Error("Could not read the Bluetooth list"); }
  const found: Device[] = [];
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
        const note = [left !== null ? `L ${left}%` : "", right !== null ? `R ${right}%` : "", (sides.length || main !== null) && box !== null ? `Case ${box}%` : "", !sides.length && main === null ? "Case" : ""].filter(Boolean).join("  ");
        found.push({ name, icon: iconFor(String(p?.device_minorType ?? ""), name), percent, ...(note ? { note } : {}) });
      }
    }
  }
  return found;
}

/** The Mac first, then the others by name. A device both tools report is shown once, with the Bluetooth list's detail. */
export function merge(mac: Device | null, bluetooth: Device[], registry: Device[]): Device[] {
  const key = (n: string) => n.toLowerCase();
  const byName = new Map<string, Device>();
  for (const d of [...registry, ...bluetooth]) byName.set(key(d.name), d);
  const others = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  return [...(mac ? [mac] : []), ...others];
}

export type Node = Record<string, unknown> & { t: string };

export const toneFor = (d: Device): "ok" | "warn" | "bad" | "default" => (d.charging ? "ok" : d.percent <= 10 ? "bad" : d.percent <= 20 ? "warn" : "default");

export function buildCard(devices: Device[]): { root: Node } {
  const shown = devices.slice(0, MAX_DEVICES);
  // a card holds at most 60 nodes: the second line (time left, each AirPod) is dropped when there are many devices
  const notes = shown.length <= 6;
  const children: Node[] = shown.map((d) => {
    const tone = toneFor(d);
    const toned = tone === "default" ? {} : { tone };
    const middle: Node[] = [
      { t: "text", text: d.name.slice(0, 200), size: "s" },
      { t: "progress", value: d.percent / 100, ...toned },
      ...(notes && d.note ? [{ t: "text", text: d.note, size: "s", tone: "muted" } as Node] : []),
    ];
    return { t: "row", gap: 2, align: "center", children: [
      { t: "icon", name: d.charging ? "bolt" : d.icon, ...toned },
      { t: "col", gap: 0, grow: true, children: middle },
      { t: "text", text: `${d.percent}%`, bold: true, ...toned },
    ] };
  });
  if (!shown.length) children.push({ t: "text", text: "No battery to show", tone: "muted" });
  if (devices.length > shown.length) children.push({ t: "text", text: `+${devices.length - shown.length} more`, size: "s", tone: "muted" });
  return { root: { t: "col", gap: 2, children } };
}
