import type { PluginContext, PluginModule, Settings } from "@nookdeck/plugin";
import { IOBT, IOREG, PMSET, PROFILER, buildCard, lookFor, merge, parseIOBluetooth, parseBluetooth, parseIoreg, parsePmset, type Device, type TileSize } from "./lib";

/** The first time, macOS may hold the call while it asks about Bluetooth: the tile does not wait longer than this. */
export const IOBT_WAIT_MS = 5000;

export function createPlugin(iobtWait: number = IOBT_WAIT_MS): PluginModule {
  return {
    activate(ctx: PluginContext) {
      ctx.widgets.provide("levels", async (s: Settings, tile?: TileSize) => {
        const shell = ctx.shell;
        if (!shell) throw new Error("Allow this plugin to run commands first");
        let failed = 0;
        const read = async <T>(cmd: string, parse: (out: string) => T, empty: T): Promise<T> => {
          try {
            const r = await shell.run(cmd);
            if (r.code !== 0) throw new Error(`exit ${r.code}`);
            return parse(r.stdout);
          } catch (e) {
            failed++;
            // never the output itself: system_profiler prints addresses and serial numbers
            ctx.log("could not run", cmd.split(" ")[0], String(e));
            return empty;
          }
        };
        // an extra source: when it fails, is refused or takes too long, the others carry on without a word
        const extra = async (): Promise<Device[]> => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const late = new Promise<Device[]>((done) => { timer = setTimeout(() => done([]), iobtWait); });
          const asked = shell.run(IOBT).then((r) => (r.code === 0 ? parseIOBluetooth(r.stdout) : []), () => []);
          try { return await Promise.race([asked, late]); } finally { clearTimeout(timer); }
        };
        const [mac, bluetooth, registry, iobt] = await Promise.all([
          read<Device | null>(PMSET, parsePmset, null),
          read<Device[]>(PROFILER, parseBluetooth, []),
          read<Device[]>(IOREG, parseIoreg, []),
          extra(),
        ]);
        if (failed === 3 && !iobt.length) throw new Error("Could not read any battery");
        return { render: "card", data: buildCard(merge(s.showMac === false ? null : mac, bluetooth, registry, iobt), lookFor(s.style, tile), tile) };
      }, { every: 60 });
    },
  };
}

export default createPlugin();
