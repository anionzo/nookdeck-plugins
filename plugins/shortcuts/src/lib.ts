// Pure logic of the Apple Shortcuts plugin: command lines, parsing and the card. No Nookdeck or Mac needed to test it.

import type { CardData, CardNode } from "@nookdeck/plugin";

export const SHORTCUTS = "/usr/bin/shortcuts";
export const MAX_BUTTONS = 24;
export const MAX_NAME = 200;
/** A button press has to answer within the agent's 20 s, so a longer shortcut is left running after this many 0.2 s ticks. */
export const WAIT_TICKS = 75;
export const STILL_RUNNING = "__NOOKDECK_STILL_RUNNING__";

/** One word for /bin/sh, whatever is in it. */
export const quote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

export function checkName(name: unknown): string {
  const n = typeof name === "string" ? name : "";
  if (!n.trim()) throw new Error("Choose a shortcut name first");
  if (n.length > MAX_NAME || /[\u0000-\u001f]/.test(n)) throw new Error("That is not a shortcut name");
  return n;
}

export const parseLines = (stdout: string): string[] => stdout.split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.trim() !== "");

export const listCommand = (folder?: string, bin = SHORTCUTS): string => `${bin} list${folder ? ` --folder-name ${quote(folder)}` : ""} 2>&1`;
export const foldersCommand = (bin = SHORTCUTS): string => `${bin} list --folders 2>&1`;

/**
 * Runs one shortcut. `--` keeps a name that starts with "-" from being read as an option. The output goes to a file, so a shortcut
 * that takes longer than the wait keeps running after this command has returned.
 */
export function runCommand(name: string, bin = SHORTCUTS, ticks = WAIT_TICKS): string {
  return [
    `f=$(/usr/bin/mktemp -t nookdeck-shortcut) || exit 1`,
    `${bin} run -- ${quote(checkName(name))} >"$f" 2>&1 </dev/null & p=$!`,
    `n=0; while kill -0 $p 2>/dev/null; do if [ $n -ge ${Math.trunc(ticks)} ]; then rm -f "$f"; echo ${STILL_RUNNING}; exit 0; fi; sleep 0.2; n=$((n+1)); done`,
    `wait $p; c=$?; cat "$f"; rm -f "$f"; exit $c`,
  ].join("\n");
}

/** The first useful line of what `shortcuts` printed. */
export function errorText(stdout: string, fallback: string): string {
  const line = parseLines(stdout)[0]?.replace(/^Error:\s*/, "").trim();
  return (line || fallback).slice(0, 180);
}

export const parseNames = (setting: unknown): string[] => (typeof setting === "string" ? setting.split(",").map((s) => s.trim()).filter(Boolean) : []);

/** The names from the list that were asked for, in the order asked. Apostrophes are matched loosely: people type ' for ’. */
export function pickNames(all: string[], wanted: string[]): { found: string[]; missing: string[] } {
  const key = (s: string) => s.normalize("NFC").replace(/[‘’]/g, "'").trim().toLowerCase();
  const byKey = new Map(all.map((n) => [key(n), n]));
  const found: string[] = [], missing: string[] = [];
  for (const w of wanted) {
    const real = byKey.get(key(w));
    if (real === undefined) missing.push(w);
    else if (!found.includes(real)) found.push(real);
  }
  return { found, missing };
}


/** The tile's size in grid cells. Nookdeck tells it from 0.5.1. */
export interface TileSize { w: number; h: number }
export const ICON = "bolt";
/**
 * An icon for a shortcut, guessed from whole words of its name (English, and Vietnamese where it is clear). The first line
 * that matches wins. macOS does not tell a plugin the shortcut's own icon. Only icons Nookdeck's cards have built in.
 */
export const ICONS: ReadonlyArray<readonly [icon: string, words: string]> = [
  ["world", "translate|translator|translation|dịch"],
  ["moon", "sleep|bedtime|night|ngủ"],
  ["sun", "wake|morning|thức dậy"],
  ["camera", "camera|screenshot|chụp màn hình"],
  ["photo", "photo|photos|image|images|picture|pictures|ảnh"],
  ["music", "music|play|playlist|song|songs|nhạc"],
  ["clock", "timer|timers|focus|pomodoro|alarm|hẹn giờ|tập trung"],
  ["mail", "mail|email|e mail|gmail|inbox"],
  ["message", "message|messages|text|sms|tin nhắn|nhắn tin"],
  ["world", "vpn|shadowrocket|network|proxy|wifi|mạng"],
  ["file-text", "note|notes|ghi chú"],
  ["terminal-2", "script|scripts|run|terminal|shell"],
  ["app-window", "open|app|apps|mở|ứng dụng"],
];

/** the words of a name, one space around each, so a word is only ever matched whole */
const words = (s: string): string => ` ${s.normalize("NFC").toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean).join(" ")} `;

export function iconFor(name: string): string {
  const said = words(name);
  return ICONS.find(([, list]) => list.split("|").some((w) => said.includes(words(w))))?.[0] ?? ICON;
}
export const MAX_COLUMNS = 6;
export const MAX_ROWS = 4;

const within = (n: number, low: number, high: number) => Math.min(high, Math.max(low, Math.trunc(n)));

/**
 * How many buttons per row and how many in all. Left on automatic, a tile gets one button per cell across, one fewer from
 * four cells up so that names stay readable, and one row per cell down: two buttons on 2x1, 2 by 2 on 2x2, 3 by 2 on 4x2.
 * A setting wins over the size.
 */
export function gridFor(o: { columns?: number; max?: number }, tile?: TileSize): { columns: number; max: number } {
  const columns = o.columns ? within(o.columns, 1, MAX_COLUMNS) : tile ? within(tile.w >= 4 ? tile.w - 1 : tile.w, 1, MAX_COLUMNS) : 2;
  const max = o.max ? within(o.max, 1, MAX_BUTTONS) : tile ? columns * within(tile.h, 1, MAX_ROWS) : 8;
  return { columns, max };
}

/** A grid of tile buttons that fills the card: an icon above each name. */
export function buildCard(names: string[], o: { columns?: number; max?: number; missing?: string[] } = {}, tile?: TileSize): CardData {
  const { columns, max } = gridFor(o, tile);
  const usable = names.filter((n) => n.length <= MAX_NAME);
  let shown = usable.slice(0, max);
  // a card holds at most 60 parts
  const parts = (count: number) => count + Math.ceil(count / columns) * columns;
  while (parts(shown.length) > 55) shown = shown.slice(0, -1);
  const children: CardNode[] = [];
  for (let i = 0; i < shown.length; i += columns) {
    const cells: CardNode[] = shown.slice(i, i + columns).map((name) => ({ t: "button", label: name, icon: iconFor(name), layout: "tile", action: "run", args: { name } }) as CardNode);
    // a short last row keeps the width of the buttons above it
    while (i > 0 && cells.length < columns) cells.push({ t: "col", grow: true, children: [] });
    children.push({ t: "row", gap: 1, grow: true, children: cells });
  }
  if (!shown.length && !o.missing?.length) children.push({ t: "text", text: "No shortcuts here yet", tone: "muted" });
  // up to two cells high the count would cost the names their second line
  if (usable.length > shown.length && !(tile && tile.h <= 2)) children.push({ t: "text", text: `+${usable.length - shown.length} more`, size: "s", tone: "muted" });
  if (o.missing?.length) children.push({ t: "text", text: `Not found: ${o.missing.join(", ")}`.slice(0, 200), size: "s", tone: "warn" });
  return { root: { t: "col", gap: 1, children } };
}

export const messageCard = (text: string): CardData => ({ root: { t: "col", gap: 1, align: "center", children: [{ t: "text", text: text.slice(0, 200), size: "s", tone: "warn" }] } });
