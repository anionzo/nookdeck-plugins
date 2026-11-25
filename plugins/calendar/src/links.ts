/** The calendar links. A link is a secret: nothing here returns it in a message, and nothing may log it. */

export const MAX_LINKS = 4;
/** The same hosts as `permissions.network` in nookdeck.json: the agent refuses any other. */
export const HOSTS = ["calendar.google.com", "*.icloud.com", "outlook.live.com", "outlook.office365.com", "outlook.office.com"];

const allowed = (host: string) => HOSTS.some((h) => (h.startsWith("*.") ? host.endsWith(h.slice(1)) : host === h));

export const UNSUPPORTED = "only Google, iCloud and Outlook links work";

/** webcal: and http: become https:. Returns the address to fetch, or why it cannot be used. */
export function checkLink(raw: string): { url: string } | { error: string } {
  const text = raw.trim().replace(/^webcals?:\/\//i, "https://").replace(/^http:\/\//i, "https://");
  let u: URL;
  try { u = new URL(text); } catch { return { error: "this is not a calendar link" }; }
  if (u.protocol !== "https:" || u.username || u.password) return { error: "this is not a calendar link" };
  return allowed(u.hostname.toLowerCase()) ? { url: u.toString() } : { error: UNSUPPORTED };
}

/** A fixed message for a failed fetch. The error itself is never passed on: it may carry the link. */
export function fetchProblem(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (/larger than \d+ bytes/.test(m)) return "this calendar is larger than 5 MB";
  if (/not in this plugin's allowed hosts/.test(m)) return `it redirects to another site: ${UNSUPPORTED}`;
  if (/permission denied/.test(m)) return "allow this plugin to use the network";
  return "could not load it";
}

export function statusProblem(status: number): string {
  return status === 401 || status === 403 || status === 404 ? "the link was refused: copy it again" : `the server answered ${status}`;
}
