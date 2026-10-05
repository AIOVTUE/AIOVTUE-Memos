import { json } from "./utils";

const PBKDF2_ITERATIONS = 100_000;
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24; // 24h
const USERNAME_RE = /^[a-zA-Z0-9._-]{2,32}$/;

export type AuthRecord = {
  username: string;
  passwordHash: string;
  tokenSecret: string;
  initialized: boolean;
};

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const b of arr) binary += String.fromCharCode(b);
  return btoa(binary);
}

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64(input: string): Uint8Array {
  const binary = atob(input);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function fromBase64Url(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  return fromBase64(padded);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function hmacSign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return toBase64Url(sig);
}

async function pbkdf2Hash(password: string, salt: Uint8Array): Promise<string> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    256,
  );
  return `pbkdf2:v1:${PBKDF2_ITERATIONS}:${toBase64(salt)}:${toBase64(bits)}`;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return pbkdf2Hash(password, salt);
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = String(stored || "").split(":");
  if (parts.length !== 5 || parts[0] !== "pbkdf2" || parts[1] !== "v1") return false;
  const salt = fromBase64(parts[3]);
  const expected = await pbkdf2Hash(password, salt);
  return timingSafeEqual(expected, stored);
}

export function normalizeUsername(value: unknown): string {
  return String(value || "").trim();
}

export function validateUsername(username: string): string | null {
  if (!USERNAME_RE.test(username)) return "账号须为 2–32 位字母、数字、点、下划线或短横线";
  return null;
}

export function validatePassword(password: string, { setup = false } = {}): string | null {
  const min = setup ? 6 : 1;
  if (password.length < min) return setup ? "密码至少 6 位" : "请输入密码";
  if (password.length > 128) return "密码过长";
  return null;
}

export function randomTokenSecret(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(32)));
}

export async function getAuthRecord(db: D1Database): Promise<AuthRecord> {
  const { results } = await db
    .prepare("SELECT key, value FROM settings WHERE key IN ('admin_username', 'admin_password_hash', 'admin_token_secret')")
    .all<{ key: string; value: string }>();
  const map: Record<string, string> = {};
  for (const row of results || []) map[row.key] = String(row.value || "").trim();
  const username = map.admin_username || "";
  const passwordHash = map.admin_password_hash || "";
  const tokenSecret = map.admin_token_secret || "";
  return {
    username,
    passwordHash,
    tokenSecret,
    // Account exists only when username + password hash are both set. Missing token is repaired, not a wipe.
    initialized: Boolean(username && passwordHash),
  };
}

async function writeSettings(db: D1Database, pairs: Array<{ key: string; value: string }>): Promise<void> {
  const stmts = pairs.map((p) =>
    db
      .prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .bind(p.key, p.value),
  );
  await db.batch(stmts);
}

export async function setupAdminAccount(
  db: D1Database,
  username: string,
  password: string,
): Promise<AuthRecord> {
  const hash = await hashPassword(password);
  // Only writes admin credential keys. Never deletes posts / comments / likes.
  await writeSettings(db, [
    { key: "admin_username", value: username },
    { key: "admin_password_hash", value: hash },
    { key: "admin_token_secret", value: randomTokenSecret() },
  ]);
  return getAuthRecord(db);
}

/** If credentials exist but HMAC secret was cleared, recreate it without touching posts. */
export async function ensureTokenSecret(db: D1Database, rec: AuthRecord): Promise<AuthRecord> {
  if (!rec.initialized || rec.tokenSecret) return rec;
  await writeSettings(db, [{ key: "admin_token_secret", value: randomTokenSecret() }]);
  return getAuthRecord(db);
}

export async function updateAdminAccount(
  db: D1Database,
  rec: AuthRecord,
  opts: { username?: string; password?: string },
): Promise<AuthRecord> {
  const pairs: Array<{ key: string; value: string }> = [];
  if (opts.username && opts.username !== rec.username) {
    pairs.push({ key: "admin_username", value: opts.username });
  }
  if (opts.password) {
    pairs.push({ key: "admin_password_hash", value: await hashPassword(opts.password) });
    pairs.push({ key: "admin_token_secret", value: randomTokenSecret() });
  }
  if (pairs.length) await writeSettings(db, pairs);
  return getAuthRecord(db);
}

export async function getTokenSecret(env: Env): Promise<string> {
  const rec = await ensureTokenSecret(env.DB, await getAuthRecord(env.DB));
  return rec.tokenSecret;
}

export async function createAdminToken(secret: string): Promise<string> {
  const exp = Date.now() + TOKEN_TTL_MS;
  const payload = String(exp);
  const sig = await hmacSign(secret, payload);
  return `${toBase64Url(new TextEncoder().encode(payload))}.${sig}`;
}

export async function verifyAdminToken(secret: string, token: string | null | undefined): Promise<boolean> {
  if (!secret || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payloadB64, sig] = parts;
  try {
    const payload = new TextDecoder().decode(fromBase64Url(payloadB64));
    const exp = Number(payload);
    if (!Number.isFinite(exp) || Date.now() > exp) return false;
    const expected = await hmacSign(secret, payload);
    return timingSafeEqual(sig, expected);
  } catch {
    return false;
  }
}

export function getBearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export async function requireAdmin(request: Request, env: Env): Promise<Response | null> {
  const rec = await ensureTokenSecret(env.DB, await getAuthRecord(env.DB));
  if (!rec.initialized) {
    return json({ ok: false, error: "站点尚未初始化，请先设置管理员账号", setup_required: true }, 401);
  }
  const token = getBearerToken(request);
  const ok = await verifyAdminToken(rec.tokenSecret, token);
  if (!ok) {
    return json({ ok: false, error: "未授权，请先登录管理账号" }, 401);
  }
  return null;
}
