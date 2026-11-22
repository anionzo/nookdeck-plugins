// Checks plugins.json, then each plugin's own nookdeck.json on GitHub:
//   entries: required fields, id format, no core.* ids, unique ids sorted by id, sha256 / version formats
//   manifests: fetched from the repo URL; id, version and permissions must match the entry
// Run: bun scripts/validate.ts            (OFFLINE=1 skips the manifest fetch)
const list = JSON.parse(await Bun.file("plugins.json").text());
const errors: string[] = [];
if (!Array.isArray(list)) errors.push("plugins.json must be an array");
const req = ["id", "name", "author", "repo", "version", "sha256", "description", "permissions"];
const seen = new Set<string>();
let prev = "";

function rawManifestUrl(repo: string): string | null {
  // https://github.com/o/r  or  https://github.com/o/r/tree/<branch>/<sub>
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)(?:\/tree\/([^/]+)(?:\/(.+))?)?\/?$/.exec(repo);
  if (!m) return null;
  const [, owner, name, branch = "main", sub = ""] = m;
  return `https://raw.githubusercontent.com/${owner}/${name}/${branch}/${sub ? sub.replace(/\/$/, "") + "/" : ""}nookdeck.json`;
}
const norm = (p: any) => JSON.stringify({ network: [...(p?.network ?? [])].sort(), shell: !!p?.shell, keyboard: !!p?.keyboard, storage: !!p?.storage });

for (const [i, p] of (Array.isArray(list) ? list : []).entries()) {
  const at = `entry ${i} (${p?.id ?? "?"})`;
  for (const k of req) if (p?.[k] === undefined) errors.push(`${at}: missing "${k}"`);
  if (p?.verified !== undefined && typeof p.verified !== "boolean") errors.push(`${at}: verified must be true or false`);
  if (typeof p?.id === "string") {
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+){2,}$/.test(p.id)) errors.push(`${at}: id must look like dev.author.name`);
    if (p.id.startsWith("core.")) errors.push(`${at}: core.* ids are reserved`);
    if (seen.has(p.id)) errors.push(`${at}: duplicate id`);
    if (p.id < prev) errors.push(`${at}: keep entries sorted by id`);
    seen.add(p.id); prev = p.id;
  }
  if (p?.version && !/^\d+\.\d+\.\d+$/.test(p.version)) errors.push(`${at}: version must be x.y.z`);
  if (p?.sha256 && !/^[a-f0-9]{64}$/.test(p.sha256)) errors.push(`${at}: sha256 must be 64 hex characters`);
  const url = typeof p?.repo === "string" ? rawManifestUrl(p.repo) : null;
  if (!url) { errors.push(`${at}: repo must be a GitHub URL (repo or /tree/<branch>/<folder>)`); continue; }
  if (process.env.OFFLINE === "1") continue;
  try {
    const r = await fetch(url);
    if (!r.ok) { errors.push(`${at}: could not fetch ${url} (${r.status})`); continue; }
    const m = await r.json();
    if (m.id !== p.id) errors.push(`${at}: nookdeck.json id is "${m.id}"`);
    if (m.version !== p.version) errors.push(`${at}: nookdeck.json version is "${m.version}"`);
    if (norm(m.permissions) !== norm(p.permissions)) errors.push(`${at}: permissions differ from nookdeck.json (${JSON.stringify(m.permissions)})`);
  } catch (e: any) { errors.push(`${at}: ${url}: ${e?.message ?? e}`); }
}
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log(`plugins.json OK (${seen.size} plugins)`);

// the README tables are generated: fail when they are out of date
{
  const { expectedReadme } = await import("./readme.ts");
  if ((await expectedReadme()) !== (await Bun.file("README.md").text())) { console.error("README.md is out of date: run bun scripts/readme.ts and commit"); process.exit(1); }
  console.log("README.md tables up to date");
}
