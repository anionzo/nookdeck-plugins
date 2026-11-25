import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlugin } from "../src/index";
import { STILL_RUNNING, buildCard, gridFor, checkName, errorText, listCommand, parseLines, parseNames, pickNames, quote, runCommand } from "../src/lib";

const NASTY = ["Start focus", "What’s a shortcut?", "Say \"hi\"", "Bob's lamp", "Ảnh này được chụp ở đâu?", "$(touch pwned) `id` ; & | > x", "-h", "--input-path", "emoji 🎧 mix", "back\\slash", "*"];

const dir = mkdtempSync(join(tmpdir(), "nd-shortcuts-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const stub = (name: string, body: string) => { const p = join(dir, name); writeFileSync(p, `#!/bin/sh\n${body}\n`); chmodSync(p, 0o755); return p; };
const sh = async (cmd: string) => {
  const p = Bun.spawn(["/bin/sh", "-c", cmd], { cwd: dir, stdout: "pipe", stderr: "ignore" });
  const [stdout, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
  return { code, stdout };
};
const posix = process.platform !== "win32";

describe.if(posix)("the command line, run by a real /bin/sh with a stand-in for shortcuts", () => {
  const echo = stub("echo-args", `for a in "$@"; do printf '[%s]\\n' "$a"; done`);
  test("a name arrives as one argument, exactly as written", async () => {
    for (const name of NASTY) {
      const r = await sh(runCommand(name, echo));
      expect(r.code).toBe(0);
      expect(r.stdout).toBe(`[run]\n[--]\n[${name}]\n`);
    }
    expect(await Bun.file(join(dir, "pwned")).exists()).toBe(false);
  });
  test("a folder name is quoted too", async () => {
    const r = await sh(listCommand("Bob's \"stuff\" $HOME", echo));
    expect(r.stdout).toBe(`[list]\n[--folder-name]\n[Bob's "stuff" $HOME]\n`);
  });
  test("a failure keeps its exit code and message", async () => {
    const fail = stub("fail", `echo "Error: The operation couldn’t be completed. Couldn’t find shortcut" >&2; exit 1`);
    const r = await sh(runCommand("nope", fail));
    expect(r.code).toBe(1);
    expect(errorText(r.stdout, "x")).toBe("The operation couldn’t be completed. Couldn’t find shortcut");
  });
  test("a slow shortcut is left running and finishes later", async () => {
    const slow = stub("slow", `sleep 1; touch "${dir}/finished"`);
    const started = Date.now();
    const r = await sh(runCommand("slow one", slow, 2));
    expect(Date.now() - started).toBeLessThan(900);
    expect(r).toEqual({ code: 0, stdout: `${STILL_RUNNING}\n` });
    await Bun.sleep(1200);
    expect(await Bun.file(join(dir, "finished")).exists()).toBe(true);
  });
});

describe("parsing and the card", () => {
  test("lines, names and picking", () => {
    expect(parseLines("Start focus\r\n\nWhat’s a shortcut?\n")).toEqual(["Start focus", "What’s a shortcut?"]);
    expect(parseNames(" a, b ,, c ")).toEqual(["a", "b", "c"]);
    expect(pickNames(["What’s a shortcut?", "Open Today"], ["open today", "What's a shortcut?", "gone"])).toEqual({ found: ["Open Today", "What’s a shortcut?"], missing: ["gone"] });
  });
  test("quote and name checks", () => {
    expect(quote("it's")).toBe(`'it'\\''s'`);
    expect(() => checkName("")).toThrow();
    expect(() => checkName("a\nb")).toThrow();
    expect(() => checkName("x".repeat(201))).toThrow();
  });
  test("the card stays inside the card limits", () => {
    const names = Array.from({ length: 80 }, (_, i) => `Shortcut ${i}`);
    const card = buildCard(names, { columns: 1, max: 999 });
    let nodes = 0;
    const walk = (n: any) => { nodes++; for (const c of n.children ?? []) walk(c); };
    walk(card.root);
    expect(nodes).toBeLessThanOrEqual(60);
    expect(JSON.stringify(card).length).toBeLessThan(32_000);
    expect(JSON.stringify(card)).toContain("+56 more");
  });
});

describe("the plugin", () => {
  const harness = (answers: Record<string, { code: number; stdout: string }>) => {
    const calls: string[] = [];
    const providers: Record<string, any> = {}, handlers: Record<string, any> = {};
    let clock = 0;
    const ctx: any = {
      log() {},
      shell: { run: async (cmd: string) => { calls.push(cmd); for (const [k, v] of Object.entries(answers)) if (cmd.includes(k)) return v; return { code: 0, stdout: "" }; } },
      widgets: { provide: (id: string, fn: unknown) => { providers[id] = fn; } },
      actions: { handle: (id: string, fn: unknown) => { handlers[id] = fn; } },
    };
    createPlugin(() => clock).activate(ctx);
    return { calls, list: (s: object = {}) => providers.list(s), run: (s: object) => handlers.run(s), tick: (ms: number) => { clock += ms; } };
  };

  test("the list is read at most once a minute", async () => {
    const h = harness({ " list": { code: 0, stdout: "A\nB\n" } });
    await h.list(); await h.list(); h.tick(59_000); await h.list();
    expect(h.calls.length).toBe(1);
    h.tick(2_000); await h.list();
    expect(h.calls.length).toBe(2);
  });
  test("an unknown folder is an error, not every shortcut", async () => {
    const h = harness({ "--folders": { code: 0, stdout: "Work\n" }, " list": { code: 0, stdout: "A\nB\n" } });
    const bad = await h.list({ folder: "Wrok" });
    expect(JSON.stringify(bad)).toContain("No folder called");
    expect(JSON.stringify(bad)).not.toContain("button");
    expect(h.calls.some((c) => c.includes("--folder-name"))).toBe(false);
    expect(JSON.stringify(await h.list({ folder: "Work" }))).toContain("button");
  });
  test("a failing shortcut throws its message", async () => {
    const h = harness({ " run ": { code: 1, stdout: "Error: Couldn’t find shortcut\n" } });
    await expect(h.run({ name: "x" })).rejects.toThrow("Couldn’t find shortcut");
    await expect(h.run({ name: "" })).rejects.toThrow("Choose a shortcut");
  });
});

describe("the grid", () => {
  test("goes by the tile size; settings win", () => {
    const at = (w: number, h: number, o = {}) => gridFor(o, { w, h });
    expect([at(2, 1), at(2, 2), at(4, 2), at(8, 4)]).toEqual([{ columns: 2, max: 2 }, { columns: 2, max: 4 }, { columns: 3, max: 6 }, { columns: 6, max: 24 }]);
    expect(gridFor({})).toEqual({ columns: 2, max: 8 });
    expect(at(4, 2, { columns: 1, max: 4 })).toEqual({ columns: 1, max: 4 });
  });
  test("tile buttons with one icon; the count only on tiles three cells high or more", () => {
    const names = ["a", "b", "c", "d", "e", "f", "g"];
    const small = JSON.stringify(buildCard(names, {}, { w: 2, h: 2 }));
    expect(small).toContain('"icon":"bolt","layout":"tile"');
    expect(small).not.toContain("more");
    expect(JSON.stringify(buildCard(names, {}, { w: 2, h: 3 }))).toContain("+1 more");
  });
});
