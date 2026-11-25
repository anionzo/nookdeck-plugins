import type { PluginContext, PluginModule, Settings } from "@nookdeck/plugin";
import { STILL_RUNNING, buildCard, checkName, errorText, foldersCommand, listCommand, messageCard, parseLines, parseNames, pickNames, runCommand, type TileSize } from "./lib";

/** The list of shortcuts is read at most once a minute (spec D5). */
export const LIST_TTL_MS = 60_000;

export function createPlugin(now: () => number = Date.now): PluginModule {
  return {
    activate(ctx: PluginContext) {
      const cache = new Map<string, { at: number; value: Promise<string[]> }>();
      const shell = async (cmd: string) => {
        if (!ctx.shell) throw new Error("Allow this plugin to run commands first");
        return ctx.shell.run(cmd);
      };
      /** Cached lines of one `shortcuts list` call; a failed call is not cached. */
      const lines = (cmd: string): Promise<string[]> => {
        const hit = cache.get(cmd);
        if (hit && now() - hit.at < LIST_TTL_MS) return hit.value;
        const value = shell(cmd).then((r) => {
          if (r.code !== 0) throw new Error(errorText(r.stdout, "Could not read your shortcuts"));
          return parseLines(r.stdout);
        });
        cache.set(cmd, { at: now(), value });
        value.catch(() => cache.delete(cmd));
        return value;
      };

      ctx.widgets.provide("list", async (s: Settings, tile?: TileSize) => {
        // "auto" and 0 leave it to the tile's size
        const options = { columns: Number(s.columns) || 0, max: Number(s.max) || 0 };
        const wanted = parseNames(s.names);
        if (wanted.length) {
          const { found, missing } = pickNames(await lines(listCommand()), wanted);
          return { render: "card", data: buildCard(found, { ...options, missing }, tile) };
        }
        const folder = String(s.folder ?? "").trim();
        // `shortcuts list --folder-name <unknown>` prints every shortcut and succeeds, so the folder is checked first
        if (folder && !(await lines(foldersCommand())).includes(folder)) return { render: "card", data: messageCard(`No folder called "${folder}"`) };
        return { render: "card", data: buildCard(await lines(listCommand(folder || undefined)), options, tile) };
      }, { every: 60 });

      ctx.actions.handle("run", async (s: Settings) => {
        const name = checkName(s.name);
        const r = await shell(runCommand(name));
        if (r.stdout.includes(STILL_RUNNING)) { ctx.log("a shortcut is still running"); return; }
        if (r.code !== 0) throw new Error(errorText(r.stdout, "The shortcut failed"));
      });
    },
  };
}

export default createPlugin();
