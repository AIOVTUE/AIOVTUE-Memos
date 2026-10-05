import { decryptSettingSecret, hasStoredResendKey } from "./secret-store";
import { clampText, now, parseImages } from "./utils";

export const WEBDAV_MAX_BACKUPS = 3;
export const WEBDAV_INTERVALS = ["daily", "weekly", "monthly"] as const;
export type WebdavInterval = (typeof WEBDAV_INTERVALS)[number];

const BACKUP_NAME_RE = /^(?:AIOVTUE-memos|hugo-memos)-\d{8}-\d{6}\.json$/;
const INTERVAL_MS: Record<WebdavInterval, number> = {
  daily: 86_400_000,
  weekly: 86_400_000 * 7,
  monthly: 86_400_000 * 30,
};

function basicAuthHeader(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `Basic ${btoa(bin)}`;
}

function isBlockedDavHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "0.0.0.0" || h === "::" || h === "::1") return true;
  if (h === "169.254.169.254" || h.endsWith(".internal")) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    if (a.some((n) => n > 255)) return true;
    if (a[0] === 0 || a[0] === 10 || a[0] === 127) return true;
    if (a[0] === 169 && a[1] === 254) return true;
    if (a[0] === 172 && a[1] >= 16 && a[1] <= 31) return true;
    if (a[0] === 192 && a[1] === 168) return true;
  }
  return false;
}

export function sanitizeWebdavUrl(value: unknown): string {
  const raw = clampText(value, 500);
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    if (u.username || u.password) return "";
    if (isBlockedDavHost(u.hostname)) return "";
    u.hash = "";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

/** Empty → default folder. `null` if the value contains `..` or illegal segments. */
export function sanitizeWebdavFolder(value: unknown): string | null {
  const raw = clampText(value, 200).replace(/\\/g, "/");
  if (!raw) return "AIOVTUE-memos";
  const parts: string[] = [];
  for (const seg of raw.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") return null;
    if (!/^[\w.\u4e00-\u9fff-]+$/.test(seg)) return null;
    parts.push(seg);
  }
  return parts.join("/") || "AIOVTUE-memos";
}

export function parseWebdavInterval(value: unknown): WebdavInterval {
  const raw = clampText(value, 20);
  if (raw === "weekly" || raw === "monthly" || raw === "daily") return raw;
  return "daily";
}

export function hasWebdavPassword(stored: string): boolean {
  return hasStoredResendKey(stored);
}

function joinDav(base: string, folder: string, file = ""): string {
  const root = base.replace(/\/+$/, "");
  const segs: string[] = [];
  if (folder) segs.push(...folder.split("/").filter(Boolean));
  if (file) segs.push(file);
  if (!segs.length) return `${root}/`;
  return `${root}/${segs.map(encodeURIComponent).join("/")}${file ? "" : "/"}`;
}

function backupFilename(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `AIOVTUE-memos-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}.json`;
}

async function upsert(db: D1Database, pairs: Array<{ key: string; value: string }>): Promise<void> {
  if (!pairs.length) return;
  await db.batch(
    pairs.map((u) =>
      db
        .prepare(
          "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .bind(u.key, u.value),
    ),
  );
}

async function davFetch(
  url: string,
  method: string,
  username: string,
  password: string,
  init: RequestInit = {},
): Promise<Response> {
  const allowedOrigin = new URL(url).origin;
  const headers = new Headers(init.headers);
  if (username || password) headers.set("Authorization", basicAuthHeader(username, password));
  let current = url;
  for (let hop = 0; hop < 3; hop++) {
    const res = await fetch(current, { ...init, method, headers, redirect: "manual" });
    const loc = res.headers.get("Location");
    if (!loc || res.status < 300 || res.status >= 400) return res;
    const next = sanitizeWebdavUrl(new URL(loc, current).toString());
    if (!next || new URL(next).origin !== allowedOrigin) {
      throw new Error("WebDAV 地址跳转到了不允许的主机");
    }
    current = next;
  }
  throw new Error("WebDAV 重定向过多");
}

function hrefToName(href: string): string {
  const raw = String(href || "")
    .replace(/&amp;/g, "&")
    .trim();
  let path = raw;
  try {
    if (/^https?:\/\//i.test(raw)) path = new URL(raw).pathname;
  } catch {
    return "";
  }
  const seg = decodeURIComponent(path.replace(/\/+$/, "").split("/").pop() || "");
  return seg;
}

function parsePropfindNames(xml: string): string[] {
  const names: string[] = [];
  const re = /<[^>]*href[^>]*>([^<]+)<\/[^>]*href>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const name = hrefToName(m[1] || "");
    if (BACKUP_NAME_RE.test(name)) names.push(name);
  }
  return [...new Set(names)];
}

async function ensureCollection(
  folderUrl: string,
  username: string,
  password: string,
): Promise<void> {
  const probe = await davFetch(folderUrl, "PROPFIND", username, password, {
    headers: { Depth: "0", "Content-Type": "application/xml; charset=utf-8" },
    body: `<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><displayname/></prop></propfind>`,
  });
  if (probe.status === 401 || probe.status === 403) throw new Error("WebDAV 认证失败，请检查账号和密码");
  if (probe.status === 207 || probe.status === 200 || probe.status === 405) return;
  if (probe.status !== 404 && probe.status !== 409) return;
  const created = await davFetch(folderUrl.replace(/\/+$/, ""), "MKCOL", username, password);
  if (!created.ok && created.status !== 201 && created.status !== 405 && created.status !== 409) {
    const t = await created.text().catch(() => "");
    throw new Error(`无法创建 WebDAV 目录（${created.status}）${t ? `：${t.slice(0, 120)}` : ""}`);
  }
}

async function pruneOldBackups(
  folderUrl: string,
  fileUrl: (name: string) => string,
  username: string,
  password: string,
): Promise<number> {
  const listed = await davFetch(folderUrl, "PROPFIND", username, password, {
    headers: { Depth: "1", "Content-Type": "application/xml; charset=utf-8" },
    body: `<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><displayname/></prop></propfind>`,
  });
  if (listed.status !== 207 && listed.status !== 200) return 0;
  const xml = await listed.text();
  const names = parsePropfindNames(xml).sort().reverse();
  const extra = names.slice(WEBDAV_MAX_BACKUPS);
  let pruned = 0;
  for (const name of extra) {
    const res = await davFetch(fileUrl(name), "DELETE", username, password);
    if (res.ok || res.status === 204 || res.status === 404) pruned += 1;
  }
  return pruned;
}

async function loadPostsBackup(db: D1Database): Promise<{
  format: string;
  version: number;
  exported_at: number;
  posts: Array<{ id: string; content: string; images: string[]; created_at: number; updated_at: number }>;
}> {
  const rows = await db
    .prepare(`SELECT id, content, images, created_at, updated_at FROM posts ORDER BY created_at DESC`)
    .all<{
      id: string;
      content: string;
      images: string;
      created_at: number;
      updated_at: number;
    }>();
  return {
    format: "aiovtue-memos-posts",
    version: 1,
    exported_at: now(),
    posts: (rows.results || []).map((row) => ({
      id: row.id,
      content: row.content,
      images: parseImages(row.images),
      created_at: row.created_at,
      updated_at: row.updated_at,
    })),
  };
}

export type WebdavBackupResult =
  | { ok: true; skipped?: false; file: string; count: number; pruned: number; exported_at: number }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; error: string };

export async function runWebdavBackup(
  env: Env,
  opts: {
    force?: boolean;
    url?: string;
    username?: string;
    password?: string;
    folder?: string;
  } = {},
): Promise<WebdavBackupResult> {
  const { results } = await env.DB.prepare("SELECT key, value FROM settings").all<{
    key: string;
    value: string;
  }>();
  const settings: Record<string, string> = {};
  for (const row of results || []) settings[row.key] = row.value ?? "";

  const enabled = settings.webdav_enabled === "1";
  if (!opts.force && !enabled) {
    return { ok: true, skipped: true, reason: "未启用" };
  }

  const url = sanitizeWebdavUrl(opts.url ?? settings.webdav_url);
  const username = clampText(opts.username ?? settings.webdav_username, 120);
  const folderRaw = sanitizeWebdavFolder(opts.folder ?? settings.webdav_folder);
  if (folderRaw === null) return { ok: false, error: "WebDAV 目录无效" };
  const folder = folderRaw;

  let password = typeof opts.password === "string" ? opts.password : "";
  if (!password) password = await decryptSettingSecret(env, settings.webdav_password || "");

  if (!url) return { ok: false, error: "请填写有效的 WebDAV 地址" };
  if (!password) return { ok: false, error: "请填写 WebDAV 密码" };

  const interval = parseWebdavInterval(settings.webdav_interval);
  const last = Number(settings.webdav_last_backup_at || 0);
  const ts = now();
  if (!opts.force && Number.isFinite(last) && last > 0 && ts - last < INTERVAL_MS[interval]) {
    return { ok: true, skipped: true, reason: "未到备份周期" };
  }

  try {
    const payload = await loadPostsBackup(env.DB);
    const name = backupFilename(payload.exported_at);
    const folderUrl = joinDav(url, folder);
    const fileUrl = (file: string) => joinDav(url, folder, file).replace(/\/$/, "");

    await ensureCollection(folderUrl, username, password);

    const body = JSON.stringify(payload);
    const put = await davFetch(fileUrl(name), "PUT", username, password, {
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body,
    });
    if (put.status === 401 || put.status === 403) {
      throw new Error("WebDAV 认证失败，请检查账号和密码");
    }
    if (!put.ok && put.status !== 201 && put.status !== 204) {
      const t = await put.text().catch(() => "");
      throw new Error(`上传失败（${put.status}）${t ? `：${t.slice(0, 160)}` : ""}`);
    }

    let pruned = 0;
    try {
      pruned = await pruneOldBackups(folderUrl, fileUrl, username, password);
    } catch {
      pruned = 0;
    }

    await upsert(env.DB, [
      { key: "webdav_last_backup_at", value: String(payload.exported_at) },
      { key: "webdav_last_error", value: "" },
    ]);

    return {
      ok: true,
      file: name,
      count: payload.posts.length,
      pruned,
      exported_at: payload.exported_at,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "备份失败";
    await upsert(env.DB, [{ key: "webdav_last_error", value: message.slice(0, 300) }]);
    return { ok: false, error: message };
  }
}