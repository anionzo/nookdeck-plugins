// Pure logic of the Apple Shortcuts plugin: command lines, parsing and the card. No Nookdeck or Mac needed to test it.

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

export type Node = Record<string, unknown> & { t: string };

export function buildCard(names: string[], o: { columns?: number; max?: number; missing?: string[] } = {}): { root: Node } {
  const columns = Math.min(3, Math.max(1, Math.trunc(o.columns || 2)));
  const max = Math.min(MAX_BUTTONS, Math.max(1, Math.trunc(o.max || 8)));
  const usable = names.filter((n) => n.length <= MAX_NAME);
  const shown = usable.slice(0, max);
  const children: Node[] = [];
  for (let i = 0; i < shown.length; i += columns) {
    children.push({ t: "row", gap: 1, children: shown.slice(i, i + columns).map((name) => ({ t: "button", label: name, icon: "player-play", action: "run", args: { name } })) });
  }
  if (!shown.length && !o.missing?.length) children.push({ t: "text", text: "No shortcuts here yet", tone: "muted" });
  if (usable.length > shown.length) children.push({ t: "text", text: `+${usable.length - shown.length} more`, size: "s", tone: "muted" });
  if (o.missing?.length) children.push({ t: "text", text: `Not found: ${o.missing.join(", ")}`.slice(0, 200), size: "s", tone: "warn" });
  return { root: { t: "col", gap: 1, children } };
}

export const messageCard = (text: string): { root: Node } => ({ root: { t: "col", gap: 1, align: "center", children: [{ t: "text", text: text.slice(0, 200), size: "s", tone: "warn" }] } });
