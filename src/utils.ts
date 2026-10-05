export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const MAX_IMAGES = 9;
export const MAX_IMPORT_POSTS = 500;
export const API_BODY_LIMIT = 5_000_000;

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  const h = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    ...SECURITY_HEADERS,
  });
  new Headers(headers).forEach((v, k) => h.set(k, v));
  return new Response(JSON.stringify(data), { status, headers: h });
}

export function error(message: string, status = 400): Response {
  return json({ ok: false, error: message }, status);
}

export function isMissingD1Table(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.message} ${err.cause ?? ""}` : String(err);
  return /no such table/i.test(msg);
}

export function now(): number {
  return Date.now();
}

export function id(): string {
  return crypto.randomUUID();
}

export function parseImages(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return sanitizeImageList(parsed);
  } catch {
    return [];
  }
}

export async function readJson<T extends Record<string, unknown>>(request: Request): Promise<T | null> {
  try {
    const text = await request.text();
    if (text.length > API_BODY_LIMIT) return null;
    const data = JSON.parse(text) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    return data as T;
  } catch {
    return null;
  }
}

export function clampText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function decodePathOnce(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/** Collapse `.` / reject `..` after decoding. Returns "" if unsafe. */
export function sanitizeRelativePath(value: unknown, max = 500): string {
  let raw = clampText(value, 2000);
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "";
  raw = raw.split(/[?#]/)[0] || "/";
  for (let i = 0; i < 4; i++) {
    const next = decodePathOnce(raw);
    if (next == null) return "";
    if (next === raw) break;
    raw = next;
  }
  raw = raw.replace(/\\/g, "/");
  if (/[\0\r\n\s<>"'`]/.test(raw)) return "";
  const parts: string[] = [];
  for (const seg of raw.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") return "";
    parts.push(seg);
  }
  const out = `/${parts.join("/")}`;
  return out.slice(0, max);
}

export function isSafeAssetPath(pathname: string): boolean {
  return Boolean(sanitizeRelativePath(pathname.split("?")[0] || "/", 2048));
}

/**
 * Identify a blog page by path only (domain / query / hash ignored).
 * `/posts/foo`, `https://a.com/posts/foo/`, `https://b.net/posts/foo?x=1` → `/posts/foo`
 */
export function normalizePagePath(value: unknown, max = 500): string {
  let raw = clampText(value, 2000);
  if (!raw) return "";
  const beforeQuery = raw.split(/[?#]/)[0] || "";
  if (/\.\.|%2e/i.test(beforeQuery)) return "";
  try {
    if (/^https?:\/\//i.test(raw)) {
      raw = new URL(raw).pathname || "/";
    } else {
      const cut = raw.split(/[?#]/)[0] || "/";
      raw = cut.startsWith("/") ? cut : `/${cut}`;
    }
  } catch {
    return "";
  }
  const path = sanitizeRelativePath(raw, max);
  return path || "";
}

/** http(s) origin only (scheme + host). Relative URLs and credentials rejected. */
export function sanitizeSiteOrigin(value: unknown, fallback = ""): string {
  const raw = sanitizeUrl(value, 300);
  if (!/^https?:\/\//i.test(raw)) return fallback;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return fallback;
    if (u.username || u.password) return fallback;
    return `${u.protocol}//${u.host}`;
  } catch {
    return fallback;
  }
}

/** Allow http(s) URLs and same-origin relative paths like /img/a.jpg. Reject javascript:/data:/etc. */
export function sanitizeUrl(value: unknown, max = 500): string {
  const raw = clampText(value, max);
  if (!raw) return "";

  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      if (u.protocol !== "http:" && u.protocol !== "https:") return "";
      if (u.username || u.password) return "";
      return u.toString().slice(0, max);
    } catch {
      return "";
    }
  }

  return sanitizeRelativePath(raw, max);
}

/** Comma-separated http(s) Origins; empty means allow all. */
export function sanitizeCorsOrigins(value: unknown, max = 2000): string | null {
  const raw = clampText(value, max);
  if (!raw) return "";
  const parts = raw
    .split(/[\s,]+/)
    .map((s) => s.replace(/\/+$/, ""))
    .filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    try {
      const u = new URL(part);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      if (u.username || u.password) return null;
      if (u.pathname && u.pathname !== "/") return null;
      if (u.search || u.hash) return null;
      out.push(`${u.protocol}//${u.host}`);
    } catch {
      return null;
    }
  }
  return [...new Set(out)].join(",");
}

/** Comment homepage: http(s) only; bare domains get https:// prefix then validated. */
export function sanitizeAuthorUrl(value: unknown): string {
  let raw = clampText(value, 300);
  if (!raw) return "";
  if (!/^https?:\/\//i.test(raw)) {
    raw = `https://${raw}`;
  }
  const url = sanitizeUrl(raw, 300);
  if (!url || url.startsWith("/")) return "";
  return url;
}

export function sanitizeImageList(images: unknown): string[] {
  if (!Array.isArray(images)) return [];
  const out: string[] = [];
  for (const item of images) {
    const u = sanitizeUrl(item, 500);
    if (u) out.push(u);
    if (out.length >= MAX_IMAGES) break;
  }
  return out;
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(ba.length, bb.length, 1);
  const pa = new Uint8Array(len);
  const pb = new Uint8Array(len);
  pa.set(ba);
  pb.set(bb);
  let out = 0;
  for (let i = 0; i < len; i++) out |= pa[i] ^ pb[i];
  out |= ba.length ^ bb.length;
  return out === 0;
}

export function parseLimit(value: string | null, fallback = 20, max = 50): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

export function parseOffset(value: string | null): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), 1_000_000);
}

export function sanitizeClientId(value: unknown): string {
  const raw = clampText(value, 64);
  if (!/^[A-Za-z0-9._-]{8,64}$/.test(raw)) return "";
  return raw;
}

export function clampTimestamp(value: unknown, fallback = now()): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const t = Math.floor(n);
  const min = Date.UTC(2000, 0, 1);
  const max = now() + 86_400_000 * 366;
  if (t < min || t > max) return fallback;
  return t;
}

export function safeImportFilename(value: unknown): string {
  const raw = String(value || "import.md").replace(/\\/g, "/");
  const base = raw.split("/").pop() || "import.md";
  const cleaned = base.replace(/[^\w.\u4e00-\u9fff-]+/g, "_").slice(0, 120);
  return cleaned || "import.md";
}

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

export const HTML_CSP =
  "default-src 'self'; img-src 'self' https: data: blob:; media-src 'self' https: blob:; font-src 'self'; connect-src 'self' https://weavatar.com; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'";

export function applySecurityHeaders(headers: Headers, contentType = ""): void {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  if (contentType.includes("text/html")) {
    headers.set("Content-Security-Policy", HTML_CSP);
  }
}
