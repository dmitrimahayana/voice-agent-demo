export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}

export async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${url} -> ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

export function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v.trim() : v == null ? fallback : String(v);
}

/** Hex HMAC-SHA256 of `message`, for checking webhook signatures (Cal.com, ElevenLabs). */
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
  return [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function digits(phone: string): string {
  return phone.replace(/\D/g, "");
}

/** "Tuesday, November 18 at 10:30 AM" in the business time zone, for the agent to read aloud. */
export function spoken(iso: string, timeZone: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
  return `${day} at ${time}`;
}

/** Accepts "2026-11-18" and returns [start, end] ISO dates covering that day (UTC-safe window). */
export function dayWindow(date: string): { start: string; end: string } {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : new Date();
  const start = d.toISOString().slice(0, 10);
  const next = new Date(d.getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
  return { start, end: next };
}

/** Minimal CSV parser (handles quoted fields with commas and doubled quotes). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.some((x) => x.trim()));
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}
