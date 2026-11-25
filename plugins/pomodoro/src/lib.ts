/**
 * The timer, with no clock and no storage of its own: every function gets `now`. A running phase is kept as the time it ENDS, so
 * it stays right however long nobody asks: the phone asleep, the plugin's process stopped for being idle, or the computer asleep.
 */
export type Phase = "focus" | "break";
export type State =
  | { phase: Phase; status: "ready" }
  | { phase: Phase; status: "running"; endsAt: number; total: number }
  | { phase: Phase; status: "paused"; left: number; total: number };
/** Finished focus blocks per local day, "YYYY-MM-DD". */
export type Days = Record<string, number>;
export interface Lengths { focus: number; break: number }

export const KEEP_DAYS = 30;
export const START: State = { phase: "focus", status: "ready" };

const minutes = (v: unknown, fallback: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.min(180, Math.round(n)) : fallback;
};

/** The two phase lengths in ms, from the plugin's settings: 1 to 180 minutes. */
export const lengths = (s: Record<string, unknown>): Lengths => ({ focus: minutes(s.focus, 25) * 60_000, break: minutes(s.break, 5) * 60_000 });

export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Keeps today and the 29 days before it. */
export function prune(days: Days, now: number): Days {
  const d = new Date(now);
  const oldest = dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - (KEEP_DAYS - 1), 12).getTime());
  return Object.fromEntries(Object.entries(days).filter(([k]) => k >= oldest));
}

const isPhase = (v: unknown): v is Phase => v === "focus" || v === "break";
const positive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/** What storage gave back, or a fresh timer when it is missing or damaged. */
export function readState(v: any): State {
  if (!v || !isPhase(v.phase)) return START;
  if (v.status === "running" && positive(v.endsAt) && positive(v.total)) return { phase: v.phase, status: "running", endsAt: v.endsAt, total: v.total };
  if (v.status === "paused" && positive(v.left) && positive(v.total)) return { phase: v.phase, status: "paused", left: v.left, total: v.total };
  return { phase: v.phase, status: "ready" };
}

export function readDays(v: unknown): Days {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return Object.fromEntries(Object.entries(v).filter(([k, n]) => /^\d{4}-\d\d-\d\d$/.test(k) && positive(n))) as Days;
}

const other = (p: Phase): Phase => (p === "focus" ? "break" : "focus");

/**
 * Closes a phase whose time is up. The next one waits for Start. A finished focus block counts once, on the day it ENDED,
 * however late this is called.
 */
export function settle(state: State, days: Days, now: number): { state: State; days: Days; finished: number | null } {
  if (state.status !== "running" || state.endsAt > now) return { state, days, finished: null };
  let next = days;
  if (state.phase === "focus") {
    const key = dayKey(state.endsAt);
    next = prune({ ...days, [key]: (days[key] ?? 0) + 1 }, now);
  }
  return { state: { phase: other(state.phase), status: "ready" }, days: next, finished: state.endsAt };
}

export function toggle(state: State, len: Lengths, now: number): State {
  if (state.status === "running") return { phase: state.phase, status: "paused", left: Math.max(1, state.endsAt - now), total: state.total };
  const total = state.status === "paused" ? state.total : len[state.phase];
  const left = state.status === "paused" ? state.left : total;
  return { phase: state.phase, status: "running", endsAt: now + left, total };
}

/** To the other phase, waiting for Start. A skipped focus block does not count. */
export const skip = (state: State): State => ({ phase: other(state.phase), status: "ready" });
/** This phase again, from the top. */
export const reset = (state: State): State => ({ phase: state.phase, status: "ready" });

export function remaining(state: State, len: Lengths, now: number): { left: number; total: number } {
  if (state.status === "running") return { left: Math.max(0, state.endsAt - now), total: state.total };
  if (state.status === "paused") return { left: state.left, total: state.total };
  return { left: len[state.phase], total: len[state.phase] };
}

/** 24:59. Rounded up, so a full phase reads 25:00 and 00:00 only shows when it is over. */
export function clock(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function buildCard(state: State, days: Days, len: Lengths, now: number) {
  const { left, total } = remaining(state, len, now);
  const tone = state.phase === "focus" ? "accent" : "ok";
  const running = state.status === "running";
  return {
    root: { t: "col", gap: 1, children: [
      { t: "row", gap: 1, align: "between", children: [
        { t: "pill", text: state.phase === "focus" ? "Focus" : "Break", tone },
        { t: "text", text: `${days[dayKey(now)] ?? 0} today`, size: "s", tone: "muted" },
      ] },
      { t: "number", value: clock(left), size: "xl", ...(state.status === "paused" ? { tone: "muted" } : {}) },
      { t: "progress", value: Math.round(Math.min(1, Math.max(0, 1 - left / total)) * 1000) / 1000, tone },
      { t: "row", gap: 1, children: [
        { t: "button", label: running ? "Pause" : state.status === "paused" ? "Resume" : "Start", icon: running ? "player-pause" : "player-play", action: "toggle", ...(running ? { active: true } : {}) },
        { t: "button", label: "Skip", icon: "player-skip-forward", action: "skip" },
        { t: "button", label: "Reset", icon: "refresh", action: "reset" },
      ] },
    ] },
  };
}
