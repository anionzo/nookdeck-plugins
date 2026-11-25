import type { PluginContext, PluginModule, Settings } from "@nookdeck/plugin";
import { IOREG, PMSET, PROFILER, STYLES, buildCard, merge, parseBluetooth, parseIoreg, parsePmset, type Device, type Style } from "./lib";

export function createPlugin(): PluginModule {
  return {
    activate(ctx: PluginContext) {
      ctx.widgets.provide("levels", async (s: Settings) => {
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
        const [mac, bluetooth, registry] = await Promise.all([
          read<Device | null>(PMSET, parsePmset, null),
          read<Device[]>(PROFILER, parseBluetooth, []),
          read<Device[]>(IOREG, parseIoreg, []),
        ]);
        if (failed === 3) throw new Error("Could not read any battery");
        const style = STYLES.includes(s.style as Style) ? (s.style as Style) : "details";
        return { render: "card", data: buildCard(merge(s.showMac === false ? null : mac, bluetooth, registry), style) };
      }, { every: 60 });
    },
  };
}

export default createPlugin();
