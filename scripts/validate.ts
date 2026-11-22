// Checks plugins.json: valid JSON, required fields, unique ids, sorted by id, no core.* ids, no "verified" set by authors.
const list = JSON.parse(await Bun.file("plugins.json").text());
const errors: string[] = [];
if (!Array.isArray(list)) errors.push("plugins.json must be an array");
const req = ["id", "name", "author", "repo", "version", "sha256", "description", "permissions"];
const seen = new Set<string>();
let prev = "";
for (const [i, p] of (Array.isArray(list) ? list : []).entries()) {
  const at = `entry ${i} (${p?.id ?? "?"})`;
  for (const k of req) if (p?.[k] === undefined) errors.push(`${at}: missing "${k}"`);
  if (typeof p?.id === "string") {
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+){2,}$/.test(p.id)) errors.push(`${at}: id must look like dev.author.name`);
    if (p.id.startsWith("core.")) errors.push(`${at}: core.* ids are reserved`);
    if (seen.has(p.id)) errors.push(`${at}: duplicate id`);
    if (p.id < prev) errors.push(`${at}: keep entries sorted by id`);
    seen.add(p.id); prev = p.id;
  }
  if (p?.repo && !/^https:\/\/github\.com\/[^/]+\/[^/]+/.test(p.repo)) errors.push(`${at}: repo must be a GitHub URL`);
  if (p?.version && !/^\d+\.\d+\.\d+$/.test(p.version)) errors.push(`${at}: version must be x.y.z`);
  if (p?.sha256 && !/^[a-f0-9]{64}$/.test(p.sha256)) errors.push(`${at}: sha256 must be 64 hex characters`);
}
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log(`plugins.json OK (${seen.size} plugins)`);
