import type { PluginContext, PluginModule, Settings } from "@nookdeck/plugin";
import {
  ASSERTIONS, DARK_MODE, DISPLAY_OFF, LOCK, READ_APPEARANCE, awakeCommand, buildCard, checkMinutes, displayCaffeinates, failure,
  isAwake, permissionError, stopCommand, type Awake,
} from "./lib";

const KEY = "awake";
/** How long a refused permission stays written on the card. */
export const PROBLEM_MS = 60_000;
/** A new caffeinate takes a moment to show up in the system's list: how often it is looked for, 0.1 s apart. */
export const START_TRIES = 30;

export function createPlugin(now: () => number = Date.now): PluginModule {
  return {
    activate(ctx: PluginContext) {
      let problem: { text: string; at: number } | null = null;
      const shell = async (cmd: string) => {
        if (!ctx.shell) throw new Error("Allow this plugin to run commands first");
        return ctx.shell.run(cmd);
      };
      const run = async (cmd: string, fallback: string) => {
        const r = await shell(cmd);
        if (r.code === 0) { problem = null; return r.stdout; }
        const refused = permissionError(r.stdout);
        if (refused) problem = { text: refused, at: now() };
        throw new Error(failure(r.stdout, fallback));
      };

      /** Our caffeinate, only while it really runs: the pid is checked against the system's list, so another process is never touched. */
      async function awake(): Promise<Awake | null> {
        const saved = await ctx.storage.get(KEY);
        if (!isAwake(saved)) return null;
        if (!saved.until || saved.until > now()) {
          const r = await shell(ASSERTIONS);
          // when the list cannot be read, say what was saved and leave it alone
          if (r.code !== 0 || displayCaffeinates(r.stdout).includes(saved.pid)) return saved;
        }
        await ctx.storage.set(KEY, null);
        return null;
      }

      ctx.widgets.provide("controls", async (s: Settings) => {
        const [look, state] = await Promise.all([shell(READ_APPEARANCE), awake()]);
        const said = look.stdout.trim();
        if (problem && now() - problem.at > PROBLEM_MS) problem = null;
        return {
          render: "card",
          data: buildCard({
            appearance: look.code === 0 && (said === "Dark" || said === "Light") ? said : null,
            awake: state, minutes: checkMinutes(s.minutes), now: now(), problem: problem?.text,
          }),
        };
      }, { every: 5 });

      ctx.actions.handle("dark-mode", async (s: Settings) => {
        const mode = String(s.mode ?? "toggle");
        if (mode !== "toggle" && mode !== "light" && mode !== "dark") throw new Error("Mode must be toggle, light or dark");
        await run(DARK_MODE[mode], "Could not change the appearance");
      });

      /** Waits until the system lists the new caffeinate. It is saved only then, so a refresh in between cannot forget it. */
      async function listed(pid: number): Promise<boolean> {
        for (let i = 0; i < START_TRIES; i++) {
          const r = await shell(ASSERTIONS);
          if (r.code !== 0 || displayCaffeinates(r.stdout).includes(pid)) return true;
          await new Promise((done) => setTimeout(done, 100));
        }
        return false;
      }

      // two quick taps must not start two caffeinates
      let queue: Promise<unknown> = Promise.resolve();
      ctx.actions.handle("keep-awake", (s: Settings) => {
        const next = queue.then(async () => {
          const on = await awake();
          if (on) {
            await run(stopCommand(on.pid), "Could not turn keep awake off");
            await ctx.storage.set(KEY, null);
            return;
          }
          const minutes = checkMinutes(s.minutes);
          const pid = Number((await run(awakeCommand(minutes), "Could not keep the Mac awake")).trim());
          if (!Number.isInteger(pid) || pid <= 1) throw new Error("Could not keep the Mac awake");
          if (!(await listed(pid))) {
            await shell(stopCommand(pid));
            throw new Error("Could not keep the Mac awake");
          }
          await ctx.storage.set(KEY, { pid, until: minutes ? now() + minutes * 60_000 : 0 } satisfies Awake);
        });
        queue = next.catch(() => {});
        return next;
      });

      ctx.actions.handle("display-off", async () => { await run(DISPLAY_OFF, "Could not turn the display off"); });
      ctx.actions.handle("lock", async () => { await run(LOCK, "Could not lock the screen"); });
    },
  };
}

export default createPlugin();
