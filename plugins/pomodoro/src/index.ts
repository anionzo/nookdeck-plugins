import type { PluginContext, PluginModule } from "@nookdeck/plugin";
import { buildCard, lengths, readDays, readState, reset, settle, skip, toggle, type Days, type Lengths, type State } from "./lib";

/** A tap that arrives just after the phase ran out was meant for the old card: it must not start the next phase. */
export const LATE_TAP_MS = 2_000;

export interface Env {
  now: () => number;
  every: (fn: () => void, ms: number) => () => void;
}
const real: Env = {
  now: Date.now,
  every: (fn, ms) => { const t = setInterval(fn, ms); return () => clearInterval(t); },
};

export function createPlugin(env: Env = real): PluginModule {
  let stopTick: (() => void) | null = null;
  const stop = () => { stopTick?.(); stopTick = null; };

  return {
    activate(ctx: PluginContext) {
      // one at a time: a tick, a poll and a tap must never count a block twice or overwrite each other
      let queue: Promise<unknown> = Promise.resolve();
      const locked = <T>(fn: () => Promise<T>): Promise<T> => {
        const next = queue.then(fn);
        queue = next.catch(() => {});
        return next;
      };
      const len = (): Lengths => lengths(ctx.settings.get());

      async function load(): Promise<{ state: State; days: Days; finished: number | null }> {
        const [s, d] = await Promise.all([ctx.storage.get("timer"), ctx.storage.get("days")]);
        const out = settle(readState(s), readDays(d), env.now());
        if (out.finished !== null) {
          await ctx.storage.set("days", out.days);
          await ctx.storage.set("timer", out.state);
        }
        return out;
      }

      /** The card once a second, only while a phase runs. */
      function follow(state: State) {
        if (state.status !== "running") return stop();
        if (stopTick) return;
        stopTick = env.every(() => {
          void locked(async () => {
            const { state, days } = await load();
            ctx.widgets.push("timer", { render: "card", data: buildCard(state, days, len(), env.now()) });
            follow(state);
          }).catch((err) => ctx.log("tick failed:", err instanceof Error ? err.message : err));
        }, 1000);
      }

      ctx.widgets.provide("timer", () => locked(async () => {
        const { state, days } = await load();
        follow(state);
        return { render: "card", data: buildCard(state, days, len(), env.now()) };
      }), { every: 5 });

      const on = (id: string, change: (s: State) => State) => ctx.actions.handle(id, () => locked(async () => {
        const { state, finished } = await load();
        if (finished !== null && env.now() - finished < LATE_TAP_MS) return follow(state);
        const next = change(state);
        await ctx.storage.set("timer", next);
        follow(next);
      }));
      on("toggle", (s) => toggle(s, len(), env.now()));
      on("skip", skip);
      on("reset", reset);
    },
    deactivate: stop,
  };
}

export default createPlugin();
