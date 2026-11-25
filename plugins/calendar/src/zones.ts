/** Time zones of ICS files, turned into instants. IANA names go to Intl; Outlook's Windows names are mapped to IANA. */

/** A date and time on the wall, in no particular zone. */
export interface Wall { y: number; mo: number; d: number; h: number; mi: number; s: number }

/** The Windows zone names Outlook and Exchange write as TZID (Unicode CLDR windowsZones, the default territory). */
export const WINDOWS_ZONES: Record<string, string> = {
  "Dateline Standard Time": "Etc/GMT+12", "Hawaiian Standard Time": "Pacific/Honolulu", "Alaskan Standard Time": "America/Anchorage",
  "Pacific Standard Time": "America/Los_Angeles", "US Mountain Standard Time": "America/Phoenix", "Mountain Standard Time": "America/Denver",
  "Central America Standard Time": "America/Guatemala", "Central Standard Time": "America/Chicago", "Central Standard Time (Mexico)": "America/Mexico_City",
  "Canada Central Standard Time": "America/Regina", "SA Pacific Standard Time": "America/Bogota", "Eastern Standard Time": "America/New_York",
  "US Eastern Standard Time": "America/Indianapolis", "Venezuela Standard Time": "America/Caracas", "Atlantic Standard Time": "America/Halifax",
  "SA Western Standard Time": "America/La_Paz", "Pacific SA Standard Time": "America/Santiago", "Newfoundland Standard Time": "America/St_Johns",
  "E. South America Standard Time": "America/Sao_Paulo", "Argentina Standard Time": "America/Buenos_Aires", "SA Eastern Standard Time": "America/Cayenne",
  "Greenland Standard Time": "America/Godthab", "Azores Standard Time": "Atlantic/Azores", "Cape Verde Standard Time": "Atlantic/Cape_Verde",
  "UTC": "Etc/UTC", "GMT Standard Time": "Europe/London", "Greenwich Standard Time": "Atlantic/Reykjavik", "Morocco Standard Time": "Africa/Casablanca",
  "W. Europe Standard Time": "Europe/Berlin", "Central Europe Standard Time": "Europe/Budapest", "Romance Standard Time": "Europe/Paris",
  "Central European Standard Time": "Europe/Warsaw", "W. Central Africa Standard Time": "Africa/Lagos", "GTB Standard Time": "Europe/Bucharest",
  "E. Europe Standard Time": "Europe/Chisinau", "FLE Standard Time": "Europe/Kiev", "Egypt Standard Time": "Africa/Cairo",
  "South Africa Standard Time": "Africa/Johannesburg", "Israel Standard Time": "Asia/Jerusalem", "Jordan Standard Time": "Asia/Amman",
  "Middle East Standard Time": "Asia/Beirut", "Turkey Standard Time": "Europe/Istanbul", "Arabic Standard Time": "Asia/Baghdad",
  "Arab Standard Time": "Asia/Riyadh", "Russian Standard Time": "Europe/Moscow", "E. Africa Standard Time": "Africa/Nairobi",
  "Iran Standard Time": "Asia/Tehran", "Arabian Standard Time": "Asia/Dubai", "Azerbaijan Standard Time": "Asia/Baku",
  "Georgian Standard Time": "Asia/Tbilisi", "Caucasus Standard Time": "Asia/Yerevan", "Afghanistan Standard Time": "Asia/Kabul",
  "West Asia Standard Time": "Asia/Tashkent", "Pakistan Standard Time": "Asia/Karachi", "India Standard Time": "Asia/Calcutta",
  "Sri Lanka Standard Time": "Asia/Colombo", "Nepal Standard Time": "Asia/Katmandu", "Central Asia Standard Time": "Asia/Almaty",
  "Bangladesh Standard Time": "Asia/Dhaka", "Myanmar Standard Time": "Asia/Rangoon", "SE Asia Standard Time": "Asia/Bangkok",
  "North Asia Standard Time": "Asia/Krasnoyarsk", "China Standard Time": "Asia/Shanghai", "Singapore Standard Time": "Asia/Singapore",
  "W. Australia Standard Time": "Australia/Perth", "Taipei Standard Time": "Asia/Taipei", "Ulaanbaatar Standard Time": "Asia/Ulaanbaatar",
  "Tokyo Standard Time": "Asia/Tokyo", "Korea Standard Time": "Asia/Seoul", "Cen. Australia Standard Time": "Australia/Adelaide",
  "AUS Central Standard Time": "Australia/Darwin", "E. Australia Standard Time": "Australia/Brisbane", "AUS Eastern Standard Time": "Australia/Sydney",
  "West Pacific Standard Time": "Pacific/Port_Moresby", "Tasmania Standard Time": "Australia/Hobart", "Vladivostok Standard Time": "Asia/Vladivostok",
  "Central Pacific Standard Time": "Pacific/Guadalcanal", "New Zealand Standard Time": "Pacific/Auckland", "Fiji Standard Time": "Pacific/Fiji",
  "Tonga Standard Time": "Pacific/Tongatapu",
};

const formats = new Map<string, Intl.DateTimeFormat | null>();
function formatter(zone: string): Intl.DateTimeFormat | null {
  let f = formats.get(zone);
  if (f === undefined) {
    try { f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
    catch { f = null; }
    formats.set(zone, f);
  }
  return f;
}

/** The IANA zone for a TZID, or null when Intl knows neither the name nor a mapping for it. */
export function ianaZone(tzid: string): string | null {
  // some producers prefix a path: /freeassociation.sourceforge.net/Europe/London
  const name = tzid.replace(/^\/[^/]+\/(?=[A-Za-z]+\/)/, "");
  const mapped = WINDOWS_ZONES[name] ?? name;
  return formatter(mapped) ? mapped : null;
}

export const wallAsUtc = (w: Wall): number => Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);

function offsetAt(zone: string, instant: number): number {
  const p: Record<string, number> = {};
  for (const part of formatter(zone)!.formatToParts(instant)) if (part.type !== "literal") p[part.type] = Number(part.value);
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour! % 24, p.minute!, p.second!) - Math.floor(instant / 1000) * 1000;
}

/** The instant a wall time names in an IANA zone. A time skipped by summer time moves forward; a repeated one is the first. */
export function wallInZone(w: Wall, zone: string): number {
  const utc = wallAsUtc(w);
  const early = utc - offsetAt(zone, utc - 86_400_000);
  const late = utc - offsetAt(zone, utc + 86_400_000);
  const fits = (t: number) => t + offsetAt(zone, t) === utc;
  if (fits(early)) return early;
  if (fits(late)) return late;
  return early;
}

/** The computer's own zone: floating times, and zones nobody can name. */
export const wallInLocal = (w: Wall): number => new Date(w.y, w.mo - 1, w.d, w.h, w.mi, w.s).getTime();
