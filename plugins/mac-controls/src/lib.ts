// Pure logic of the Mac controls plugin: every command is a fixed string; the only values that vary are checked numbers.

import type { CardData, CardNode } from "@nookdeck/plugin";

export const MAX_MINUTES = 24 * 60;

/** Reading the appearance needs no permission: it is the user's own preference. Prints "Dark" or "Light". */
export const READ_APPEARANCE = `/usr/bin/osascript -l JavaScript -e 'ObjC.import("Foundation"); ObjC.unwrap($.NSUserDefaults.standardUserDefaults.stringForKey("AppleInterfaceStyle")) || "Light"' 2>&1`;

/** Changing it goes through System Events, which macOS guards with the Automation permission. */
export const DARK_MODE: Record<"toggle" | "light" | "dark", string> = {
  toggle: `/usr/bin/osascript -e 'tell application "System Events" to tell appearance preferences to set dark mode to not dark mode' 2>&1`,
  light: `/usr/bin/osascript -e 'tell application "System Events" to tell appearance preferences to set dark mode to false' 2>&1`,
  dark: `/usr/bin/osascript -e 'tell application "System Events" to tell appearance preferences to set dark mode to true' 2>&1`,
};

/** The system's own Lock Screen shortcut (Control + Command + Q): needs Automation and Accessibility. */
export const LOCK = `/usr/bin/osascript -e 'tell application "System Events" to keystroke "q" using {control down, command down}' 2>&1`;
export const DISPLAY_OFF = `/usr/bin/pmset displaysleepnow 2>&1`;
export const ASSERTIONS = `/usr/bin/pmset -g assertions 2>&1`;

export function checkMinutes(v: unknown, fallback = 60): number {
  const n = v === undefined || v === "" ? fallback : Number(v);
  if (!Number.isInteger(n) || n < 0 || n > MAX_MINUTES) throw new Error(`Minutes must be a whole number from 0 to ${MAX_MINUTES}`);
  return n;
}

/**
 * Starts `caffeinate -d` in the background and prints its pid. `-w $PPID` ties it to Nookdeck (the parent of this shell), so the Mac
 * is never left awake by a Nookdeck that has quit.
 */
export function awakeCommand(minutes: number): string {
  const seconds = checkMinutes(minutes) * 60;
  return `nohup /usr/bin/caffeinate -d${seconds ? ` -t ${seconds}` : ""} -w $PPID >/dev/null 2>&1 & echo $!`;
}

export function stopCommand(pid: number): string {
  if (!Number.isInteger(pid) || pid <= 1) throw new Error("bad process id");
  return `kill ${pid} 2>&1`;
}

/** The pids of the caffeinate processes that keep the DISPLAY awake right now. */
export function displayCaffeinates(assertions: string): number[] {
  const out = new Set<number>();
  for (const m of assertions.matchAll(/^\s*pid (\d+)\(caffeinate\): .*?\bPreventUserIdleDisplaySleep\b/gm)) out.add(Number(m[1]));
  return [...out];
}

export interface Awake { pid: number; /** ms since 1970; 0 = until turned off */ until: number; /** how long it was started for */ minutes?: number }
export const isAwake = (v: unknown): v is Awake => !!v && typeof v === "object" && Number.isInteger((v as Awake).pid) && typeof (v as Awake).until === "number";

export function awakeLabel(a: Awake | null, now: number): string {
  if (!a) return "Keep awake";
  if (!a.until) return "Awake";
  const min = Math.max(1, Math.ceil((a.until - now) / 60_000));
  return min < 90 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} m`;
}

/** The message for what osascript printed, when it was refused. */
export function permissionError(output: string): string | null {
  if (/-1743|not authori[sz]ed to send Apple events/i.test(output)) return "Allow Nookdeck to control System Events: System Settings, Privacy & Security, Automation";
  if (/\(1002\)|not allowed to send keystrokes|assistive access|-25211|-1719/i.test(output)) return "Allow Nookdeck under System Settings, Privacy & Security, Accessibility";
  return null;
}

export function failure(output: string, fallback: string): string {
  return permissionError(output) ?? (output.trim().split("\n")[0]?.slice(0, 180) || fallback);
}


/** The tile's size in grid cells. Nookdeck tells it from 0.5.1. */
export interface TileSize { w: number; h: number }

/** "42m", or "2h30" from an hour and a half: at most six characters fit inside a ring. */
export function ringText(a: Awake, now: number): string {
  const min = Math.max(1, Math.ceil((a.until - now) / 60_000));
  return min < 90 ? `${min}m` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
}

/** An icon above its name, filling its quarter of the card. */
const control = (label: string, icon: string, action: string, more: { args?: Record<string, string | number>; active?: boolean } = {}): CardNode =>
  ({ t: "button", label, icon, layout: "tile", action, ...more }) as CardNode;

/** in the order of the grid */
export const SINGLES = ["dark-mode", "keep-awake", "lock", "display-off"] as const;

export function buildCard(s: { appearance: "Dark" | "Light" | null; awake: Awake | null; minutes: number; now: number; problem?: string; tile?: TileSize; single?: unknown }): CardData {
  const dark = s.appearance === "Dark";
  // a wide tile has room to show how much of the keep-awake time is left
  const a = s.awake;
  const timed = !!a && a.until > 0 && !!a.minutes && !!s.tile && s.tile.w >= 4 && s.tile.h >= 2;
  const grid: CardNode[] = [
    { t: "row", gap: 1, grow: true, children: [
      control(s.appearance === null ? "Dark mode" : dark ? "Dark" : "Light", dark ? "moon" : "sun", "dark-mode", { args: { mode: "toggle" }, active: dark }),
      control(timed ? "Awake" : awakeLabel(s.awake, s.now), "coffee", "keep-awake", { args: { minutes: s.minutes }, active: !!s.awake }),
    ] },
    { t: "row", gap: 1, grow: true, children: [
      control("Lock", "lock", "lock"),
      control("Display off", "device-desktop", "display-off"),
    ] },
  ];
  // one cell has no room for four things to tap: it is one big button, chosen in the tile's settings
  if (s.tile && s.tile.w <= 1 && s.tile.h <= 1) {
    const all = grid.flatMap((row) => (row as { children: CardNode[] }).children);
    const one = all[Math.max(0, SINGLES.indexOf(s.single as (typeof SINGLES)[number]))] as Extract<CardNode, { t: "button" }>;
    // a refused permission has no line of its own here: the button turns amber, and the tap's message says what to allow
    return { root: { t: "col", children: [s.problem ? { ...one, tone: "warn" } : one] } };
  }
  const children: CardNode[] = timed
    ? [{ t: "row", gap: 2, grow: true, children: [
      { t: "ring", value: Math.min(1, Math.max(0, (a!.until - s.now) / (a!.minutes! * 60_000))), tone: "accent", text: ringText(a!, s.now), label: "Time left", size: "l", arc: "gauge" } as CardNode,
      { t: "col", gap: 1, grow: true, children: grid },
    ] }]
    : grid;
  if (s.problem) children.unshift({ t: "text", text: s.problem.slice(0, 200), size: "s", tone: "warn" });
  return { root: { t: "col", gap: 1, children } };
}
