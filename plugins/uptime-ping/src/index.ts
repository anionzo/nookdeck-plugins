import { definePlugin } from "@nookdeck/plugin";

const KEEP = 30;

export default definePlugin({
  activate(ctx) {
    ctx.widgets.provide("status", async (s) => {
      const url = String(s.url ?? "");
      const slow = Number(s.slowMs ?? 1500);
      const host = (() => { try { return new URL(url).host; } catch { return url; } })();
      const key = `latency:${host}`;
      const past = ((await ctx.storage.get(key)) as number[] | undefined) ?? [];
      const t0 = Date.now();
      try {
        const res = await ctx.net.fetch(url, { method: "HEAD" });
        const ms = Date.now() - t0;
        const points = [...past, ms].slice(-KEEP);
        await ctx.storage.set(key, points);
        const state = !res.ok ? "error" : ms > slow ? "warn" : "ok";
        return { render: "status", data: { state, label: `${host} · ${res.status} · ${ms} ms`, title: host, value: String(ms), unit: "ms", detail: `HTTP ${res.status}`, points } };
      } catch (e) {
        ctx.log("check failed", host, String(e));
        return { render: "status", data: { state: "error", label: `${host} · no answer`, title: host, value: "Down", detail: "no answer", points: past } };
      }
    }, { every: 60 });
  },
});
