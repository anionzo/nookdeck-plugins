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

export interface Awake { pid: number; /** ms since 1970; 0 = until turned off */ until: number }
export const isAwake = (v: unknown): v is Awake => !!v && typeof v === "object" && Number.isInteger((v as Awake).pid) && typeof (v as Awake).until === "number";

export function awakeLabel(a: Awake | null, now: number): string {
  if (!a) return "Keep awake";
  if (!a.until) return "Awake";
  const min = Math.max(1, Math.ceil((a.until - now) / 60_000));
  return min < 90 ? `Awake ${min} min` : `Awake ${Math.floor(min / 60)} h ${min % 60} min`;
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


export function buildCard(s: { appearance: "Dark" | "Light" | null; awake: Awake | null; minutes: number; now: number; problem?: string }): CardData {
  const dark = s.appearance === "Dark";
  const children: CardNode[] = [
    { t: "row", gap: 1, children: [
      { t: "button", label: s.appearance === null ? "Dark mode" : dark ? "Dark" : "Light", icon: dark ? "moon" : "sun", action: "dark-mode", args: { mode: "toggle" }, active: dark },
      { t: "button", label: awakeLabel(s.awake, s.now), icon: "coffee", action: "keep-awake", args: { minutes: s.minutes }, active: !!s.awake },
    ] },
    { t: "row", gap: 1, children: [
      { t: "button", label: "Lock", icon: "lock", action: "lock" },
      { t: "button", label: "Display off", icon: "device-desktop", action: "display-off" },
    ] },
  ];
  // first: when a tile is too small, the deck leaves out the last parts
  if (s.problem) children.unshift({ t: "text", text: s.problem.slice(0, 200), size: "s", tone: "warn" });
  return { root: { t: "col", gap: 1, children } };
}
