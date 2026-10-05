import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  requireAdmin,
  createAdminToken,
  getTokenSecret,
  getBearerToken,
  verifyAdminToken,
  getAuthRecord,
  setupAdminAccount,
  ensureTokenSecret,
  updateAdminAccount,
  normalizeUsername,
  validateUsername,
  validatePassword,
  verifyPassword,
} from "./auth";
import { filenameFromDate, parseMomentMarkdown, toMomentMarkdown, toMomentsIndexMarkdown } from "./markdown";
import { isResendConfigured, notifyCommentCreated, sendNotifyTestEmail } from "./notify";
import { encryptSettingSecret } from "./secret-store";
import {
  hasWebdavPassword,
  parseWebdavInterval,
  runWebdavBackup,
  sanitizeWebdavFolder,
  sanitizeWebdavUrl,
} from "./webdav";
import {
  API_BODY_LIMIT,
  applySecurityHeaders,
  clampText,
  clampTimestamp,
  error,
  id,
  isSafeAssetPath,
  isMissingD1Table,
  json,
  MAX_IMPORT_POSTS,
  now,
  normalizePagePath,
  parseImages,
  parseLimit,
  parseOffset,
  readJson,
  safeImportFilename,
  sanitizeAuthorUrl,
  sanitizeClientId,
  sanitizeCorsOrigins,
  sanitizeImageList,
  sanitizeSiteOrigin,
  sanitizeUrl,
} from "./utils";

type AppEnv = { Bindings: Env };

const DEFAULT_SETTINGS: Record<string, string> = {
  nickname: "AIOVTUE-雪",
  avatar: "/img/toux.webp",
  cover: "/hero/hero-1.mp4",
  site_title: "动态",
  site_description: "记录生活的点滴",
  notify_enabled: "1",
  admin_email: "",
  mail_from: "",
  mail_from_name: "动态通知",
  site_url: "",
  cors_origins: "",
  page_likes_enabled: "0",
  webdav_enabled: "0",
  webdav_url: "",
  webdav_username: "",
  webdav_folder: "AIOVTUE-memos",
  webdav_interval: "daily",
};

const PUBLIC_SETTINGS_HIDE = new Set([
  "admin_email",
  "mail_from",
  "mail_from_cf",
  "mail_from_resend",
  "mail_from_name",
  "notify_enabled",
  "site_url",
  "cors_origins",
  "resend_api_key",
  "admin_username",
  "admin_password_hash",
  "admin_token_secret",
  "page_like_password_hash",
  "page_likes_enabled",
  "bio",
  "webdav_enabled",
  "webdav_url",
  "webdav_username",
  "webdav_password",
  "webdav_folder",
  "webdav_interval",
  "webdav_last_backup_at",
  "webdav_last_error",
]);

/** Never expose or accept these via settings API (except resend_api_key handled specially). */
const FORBIDDEN_SETTINGS_KEYS = new Set([
  "admin_password",
  "ADMIN_PASSWORD",
  "admin_token_secret",
  "ADMIN_TOKEN_SECRET",
  "admin_username",
  "admin_password_hash",
  "page_like_password_hash",
  "password",
]);

function publicSettingsView(settings: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(settings)) {
    if (!PUBLIC_SETTINGS_HIDE.has(k) && !FORBIDDEN_SETTINGS_KEYS.has(k) && k !== "resend_api_key") {
      out[k] = v;
    }
  }
  return out;
}

/** Admin view: never return API key plaintext; only configured flag. */
function adminSettingsPayload(_env: Env, settings: Record<string, string>) {
  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries(settings)) {
    if (
      k === "resend_api_key" ||
      k === "webdav_password" ||
      k === "page_like_password_hash" ||
      k === "bio" ||
      FORBIDDEN_SETTINGS_KEYS.has(k)
    ) {
      continue;
    }
    data[k] = v;
  }
  return {
    data,
    meta: {
      resend_configured: isResendConfigured(settings),
      webdav_password_configured: hasWebdavPassword(settings.webdav_password || ""),
    },
  };
}

async function getSettingsMap(db: D1Database): Promise<Record<string, string>> {
  const { results } = await db.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  const map = { ...DEFAULT_SETTINGS };
  for (const row of results || []) map[row.key] = row.value ?? "";
  return map;
}

type PostRow = {
  id: string;
  content: string;
  images: string;
  created_at: number;
  updated_at: number;
  like_count: number;
  comment_count: number;
  liked?: number;
};

type LikerRow = { post_id: string; author_name: string; client_id: string };
type CommentRow = {
  id: string;
  post_id: string;
  parent_id?: string;
  author_name: string;
  author_email: string;
  author_url: string;
  content: string;
  created_at: number;
};

const COMMENT_COLUMNS =
  "id, post_id, parent_id, author_name, author_email, author_url, content, created_at";

type PublicLiker = { name: string };
type PublicComment = {
  id: string;
  post_id: string;
  parent_id: string;
  author_name: string;
  author_url: string;
  content: string;
  created_at: number;
};

function serializePublicComment(row: CommentRow): PublicComment {
  return {
    id: row.id,
    post_id: row.post_id,
    parent_id: row.parent_id || "",
    author_name: row.author_name,
    author_url: row.author_url || "",
    content: row.content,
    created_at: row.created_at,
  };
}

function serializePost(
  row: PostRow,
  clientId?: string | null,
  extras?: { likers?: PublicLiker[]; comments?: PublicComment[] },
) {
  return {
    id: row.id,
    content: row.content,
    images: parseImages(row.images),
    created_at: row.created_at,
    updated_at: row.updated_at,
    like_count: Number(row.like_count) || 0,
    comment_count: Number(row.comment_count) || 0,
    liked: clientId ? Boolean(row.liked) : undefined,
    likers: extras?.likers || [],
    comments: extras?.comments,
  };
}

async function loadLikersByPosts(db: D1Database, postIds: string[]) {
  const map = new Map<string, PublicLiker[]>();
  if (!postIds.length) return map;
  const placeholders = postIds.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT post_id, author_name, client_id FROM likes
       WHERE post_id IN (${placeholders})
       ORDER BY created_at ASC`,
    )
    .bind(...postIds)
    .all<LikerRow>();
  for (const row of results || []) {
    const list = map.get(row.post_id) || [];
    list.push({ name: row.author_name || "访客" });
    map.set(row.post_id, list);
  }
  return map;
}

async function loadCommentsByPosts(db: D1Database, postIds: string[]) {
  const map = new Map<string, PublicComment[]>();
  if (!postIds.length) return map;
  const placeholders = postIds.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT ${COMMENT_COLUMNS}
       FROM comments WHERE post_id IN (${placeholders})
       ORDER BY created_at ASC`,
    )
    .bind(...postIds)
    .all<CommentRow>();
  for (const row of results || []) {
    const list = map.get(row.post_id) || [];
    if (list.length >= 80) continue;
    list.push(serializePublicComment(row));
    map.set(row.post_id, list);
  }
  return map;
}

async function getPostLikers(db: D1Database, postId: string) {
  const map = await loadLikersByPosts(db, [postId]);
  return map.get(postId) || [];
}

type ImportablePost = {
  content: string;
  images: string[];
  created_at: number;
  source?: string;
};

function normalizeImportPost(raw: Record<string, unknown>, source?: string): ImportablePost | null {
  const content = clampText(raw.content, 4000);
  const images = sanitizeImageList(raw.images);
  if (!content && images.length === 0) return null;

  let createdAt = now();
  if (typeof raw.created_at === "number" || typeof raw.created_at === "string") {
    createdAt = clampTimestamp(raw.created_at, now());
  } else if (typeof raw.date === "string") {
    createdAt = clampTimestamp(raw.date, now());
  }

  return { content, images, created_at: createdAt, source };
}

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    await next();
    applySecurityHeaders(c.res.headers, c.res.headers.get("content-type") || "");
  });

  app.use("/api/*", async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      const rawLen = c.req.header("content-length");
      if (rawLen == null || rawLen === "") return error("缺少 Content-Length", 411);
      const len = Number(rawLen);
      if (!Number.isFinite(len) || len < 0) return error("无效的 Content-Length", 400);
      if (len > API_BODY_LIMIT) return error("请求体过大", 413);
    }
    let raw = "";
    try {
      const row = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'cors_origins'")
        .first<{ value: string }>();
      raw = String(row?.value || "").trim();
    } catch (err) {
      if (!isMissingD1Table(err)) throw err;
    }
    const allowed = raw
      ? raw.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    const corsMw = cors({
      origin: (origin) => {
        if (!allowed.length) return "*";
        if (origin && allowed.includes(origin)) return origin;
        return "";
      },
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "X-Client-Id"],
    });
    return corsMw(c, next);
  });

  app.get("/api/health", async (c) => {
    const rec = await getAuthRecord(c.env.DB);
    return json({ ok: true, service: "AIOVTUE-memos", initialized: rec.initialized });
  });

  // ---------- Auth ----------
  app.get("/api/auth/status", async (c) => {
    const rec = await getAuthRecord(c.env.DB);
    return json({ ok: true, data: { initialized: rec.initialized } });
  });

  app.post("/api/auth/setup", async (c) => {
    const rec = await getAuthRecord(c.env.DB);
    if (rec.initialized) return error("站点已初始化，请直接登录", 409);
    const body = await readJson<{ username?: string; password?: string }>(c.req.raw);
    if (!body) return error("无效的 JSON");
    const username = normalizeUsername(body.username);
    const password = typeof body.password === "string" ? body.password : "";
    const userErr = validateUsername(username);
    if (userErr) return error(userErr);
    const passErr = validatePassword(password, { setup: true });
    if (passErr) return error(passErr);
    const created = await setupAdminAccount(c.env.DB, username, password);
    const token = await createAdminToken(created.tokenSecret);
    return json({ ok: true, token, expires_in: 86400, message: "初始化成功", data: { username } });
  });

  app.post("/api/auth/login", async (c) => {
    let rec = await getAuthRecord(c.env.DB);
    if (!rec.initialized) {
      return json({ ok: false, error: "站点尚未初始化，请先设置管理员账号", setup_required: true }, 401);
    }
    rec = await ensureTokenSecret(c.env.DB, rec);
    const body = await readJson<{ username?: string; password?: string }>(c.req.raw);
    if (!body) return error("无效的 JSON");
    const username = normalizeUsername(body.username);
    const password = typeof body.password === "string" ? body.password : "";
    if (!username || !password) return error("请输入账号和密码", 401);
    if (username !== rec.username) {
      await verifyPassword(password, rec.passwordHash);
      return error("账号或密码错误", 401);
    }
    const ok = await verifyPassword(password, rec.passwordHash);
    if (!ok) return error("账号或密码错误", 401);
    const token = await createAdminToken(rec.tokenSecret);
    return json({ ok: true, token, expires_in: 86400, data: { username } });
  });

  app.get("/api/auth/verify", async (c) => {
    const denied = await requireAdmin(c.req.raw, c.env);
    if (denied) return denied;
    const rec = await getAuthRecord(c.env.DB);
    return json({ ok: true, data: { username: rec.username } });
  });

  app.put("/api/admin/account", async (c) => {
    const denied = await requireAdmin(c.req.raw, c.env);
    if (denied) return denied;
    const rec = await getAuthRecord(c.env.DB);
    const body = await readJson<{
      username?: string;
      current_password?: string;
      new_password?: string;
    }>(c.req.raw);
    if (!body) return error("无效的 JSON");
    const current = typeof body.current_password === "string" ? body.current_password : "";
    if (!current || !(await verifyPassword(current, rec.passwordHash))) {
      return error("当前密码错误", 401);
    }
    let nextUsername = rec.username;
    if ("username" in body) {
      const username = normalizeUsername(body.username);
      const userErr = validateUsername(username);
      if (userErr) return error(userErr);
      nextUsername = username;
    }
    let nextPassword: string | undefined;
    if (typeof body.new_password === "string" && body.new_password.length) {
      const passErr = validatePassword(body.new_password, { setup: true });
      if (passErr) return error(passErr);
      nextPassword = body.new_password;
    }
    await updateAdminAccount(c.env.DB, rec, {
      username: nextUsername,
      password: nextPassword,
    });
    const updated = await getAuthRecord(c.env.DB);
    const token = nextPassword ? await createAdminToken(updated.tokenSecret) : undefined;
    return json({
      ok: true,
      message: "账号已更新",
      data: { username: nextUsername },
      ...(token ? { token, expires_in: 86400 } : {}),
    });
  });

  // ---------- Settings ----------
  app.get("/api/settings", async (c) => {
    const settings = await getSettingsMap(c.env.DB);
    const token = getBearerToken(c.req.raw);
    if (!token) return json({ ok: true, data: publicSettingsView(settings) });
    const isAdmin = await verifyAdminToken(await getTokenSecret(c.env), token);
    if (!isAdmin) return json({ ok: true, data: publicSettingsView(settings) });
    return json({ ok: true, ...adminSettingsPayload(c.env, settings) });
  });

  app.put("/api/settings", async (c) => {
    const denied = await requireAdmin(c.req.raw, c.env);
    if (denied) return denied;

    const body = await readJson<Record<string, unknown>>(c.req.raw);
    if (!body) return error("无效的 JSON");

    for (const key of Object.keys(body)) {
      if (FORBIDDEN_SETTINGS_KEYS.has(key) || FORBIDDEN_SETTINGS_KEYS.has(key.toLowerCase())) {
        return error("禁止通过设置接口写入管理密码等敏感键", 400);
      }
    }

    const allowed = [
      "nickname",
      "avatar",
      "cover",
      "site_title",
      "site_description",
      "notify_enabled",
      "admin_email",
      "mail_from",
      "mail_from_name",
      "site_url",
      "cors_origins",
      "page_likes_enabled",
      "webdav_enabled",
      "webdav_url",
      "webdav_username",
      "webdav_folder",
      "webdav_interval",
    ] as const;
    const updates: Array<{ key: string; value: string }> = [];
    for (const key of allowed) {
      if (key in body) {
        const max =
          key === "site_description" ||
          key === "avatar" ||
          key === "cover" ||
          key === "site_url" ||
          key === "cors_origins" ||
          key === "webdav_url"
            ? 500
            : 300;
        let value = clampText(body[key], key === "cors_origins" ? 2000 : max);
        if (key === "avatar" || key === "cover") {
          value = sanitizeUrl(value, max);
          if (!value && clampText(body[key], max)) return error(`${key} 链接无效`);
        }
        if (key === "site_url" && value) {
          value = sanitizeUrl(value, max);
          if (!value) return error("site_url 链接无效");
        }
        if (key === "cors_origins") {
          const cors = sanitizeCorsOrigins(body[key], 2000);
          if (cors === null) return error("cors_origins 须为 http(s) Origin，逗号分隔，不要带路径");
          value = cors;
        }
        if (key === "notify_enabled" || key === "page_likes_enabled" || key === "webdav_enabled") {
          value = value === "0" ? "0" : "1";
        }
        if (key === "webdav_url") {
          value = value ? sanitizeWebdavUrl(value) : "";
          if (clampText(body[key], 500) && !value) return error("WebDAV 地址须为 http(s)，不要带账号密码");
        }
        if (key === "webdav_folder") {
          const folder = sanitizeWebdavFolder(body[key]);
          if (folder === null) return error("WebDAV 目录无效");
          value = folder;
        }
        if (key === "webdav_interval") {
          const raw = clampText(body[key], 20);
          if (raw && raw !== "daily" && raw !== "weekly" && raw !== "monthly") return error("备份周期无效");
          value = parseWebdavInterval(raw);
        }
        if (key === "webdav_username" && /[\r\n]/.test(value)) return error("WebDAV 用户名无效");
        if ((key === "admin_email" || key === "mail_from") && value) {
          if (!value.includes("@") || value.includes(" ")) return error(`${key} 邮箱格式无效`);
        }
        updates.push({ key, value });
      }
    }

    // Resend API key: encrypt at rest; empty + clear flag removes; blank alone keeps existing.
    if ("resend_api_key" in body || body.clear_resend_api_key === true) {
      if (body.clear_resend_api_key === true) {
        updates.push({ key: "resend_api_key", value: "" });
      } else {
        const raw = typeof body.resend_api_key === "string" ? body.resend_api_key.trim() : "";
        if (raw && !/^[\u2022*]+$/.test(raw)) {
          if (raw.length < 10 || raw.length > 200) return error("Resend API Key 长度无效");
          try {
            const enc = await encryptSettingSecret(c.env, raw);
            updates.push({ key: "resend_api_key", value: enc });
          } catch (err) {
            const message = err instanceof Error ? err.message : "加密失败";
            return error(message, 500);
          }
        }
      }
    }

    if ("webdav_password" in body || body.clear_webdav_password === true) {
      if (body.clear_webdav_password === true) {
        updates.push({ key: "webdav_password", value: "" });
      } else {
        const raw = typeof body.webdav_password === "string" ? body.webdav_password.trim() : "";
        if (raw && !/^[\u2022*]+$/.test(raw)) {
          if (raw.length > 200) return error("WebDAV 密码过长");
          try {
            const enc = await encryptSettingSecret(c.env, raw);
            updates.push({ key: "webdav_password", value: enc });
          } catch (err) {
            const message = err instanceof Error ? err.message : "加密失败";
            return error(message, 500);
          }
        }
      }
    }

    if (!updates.length) return error("没有可更新的字段");

    const stmts = updates.map((u) =>
      c.env.DB.prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).bind(u.key, u.value),
    );
    await c.env.DB.batch(stmts);
    const settings = await getSettingsMap(c.env.DB);
    return json({ ok: true, ...adminSettingsPayload(c.env, settings) });
  });

  app.post("/api/admin/notify-test", async (c) => {
    const denied = await requireAdmin(c.req.raw, c.env);
    if (denied) return denied;

    const body = await readJson<{
      admin_email?: string;
      mail_from?: string;
      mail_from_name?: string;
      site_title?: string;
      site_url?: string;
      resend_api_key?: string;
    }>(c.req.raw);
    const saved = await getSettingsMap(c.env.DB);
    const to = clampText(body?.admin_email, 120) || clampText(saved.admin_email, 120);
    const mailFrom =
      clampText(body?.mail_from, 120) ||
      clampText(saved.mail_from, 120) ||
      clampText(saved.mail_from_resend, 120) ||
      clampText(saved.mail_from_cf, 120);
    const mailFromName =
      clampText(body?.mail_from_name, 80) || clampText(saved.mail_from_name, 80) || "动态通知";
    const siteTitle = clampText(body?.site_title, 80) || saved.site_title || "动态";
    const requestOrigin = new URL(c.req.url).origin;
    const siteOrigin =
      sanitizeSiteOrigin(body?.site_url, "") ||
      sanitizeSiteOrigin(saved.site_url, "") ||
      requestOrigin;
    const apiKeyOverride =
      typeof body?.resend_api_key === "string" &&
      body.resend_api_key.trim() &&
      !/^[\u2022*]+$/.test(body.resend_api_key.trim())
        ? body.resend_api_key.trim()
        : undefined;

    try {
      await sendNotifyTestEmail(c.env, saved, {
        to,
        mailFrom,
        mailFromName,
        siteTitle,
        siteOrigin,
        apiKey: apiKeyOverride,
      });
      return json({ ok: true, message: `测试邮件已发送至 ${to}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : "发送失败";
      return error(message, 400);
    }
  });

  app.post("/api/admin/webdav-backup", async (c) => {
    const denied = await requireAdmin(c.req.raw, c.env);
    if (denied) return denied;
    const body = await readJson<{
      url?: string;
      username?: string;
      password?: string;
      folder?: string;
    }>(c.req.raw);
    const passwordRaw = typeof body?.password === "string" ? body.password.trim() : "";
    const result = await runWebdavBackup(c.env, {
      force: true,
      url: typeof body?.url === "string" ? body.url : undefined,
      username: typeof body?.username === "string" ? body.username : undefined,
      password: passwordRaw && !/^[\u2022*]+$/.test(passwordRaw) ? passwordRaw : undefined,
      folder: typeof body?.folder === "string" ? body.folder : undefined,
    });
    if (!result.ok) return error(result.error, 400);
    if (result.skipped) return error(result.reason || "已跳过", 400);
    return json({
      ok: true,
      message: `已备份 ${result.count} 条动态`,
      data: result,
    });
  });

  // ---------- Import / Export ----------
  app.get("/api/posts/export", async (c) => {
    const denied = await requireAdmin(c.req.raw, c.env);
    if (denied) return denied;

    const rows = await c.env.DB.prepare(
      `SELECT id, content, images, created_at, updated_at FROM posts ORDER BY created_at DESC`,
    ).all<{
      id: string;
      content: string;
      images: string;
      created_at: number;
      updated_at: number;
    }>();

    const posts = (rows.results || []).map((row) => ({
      id: row.id,
      content: row.content,
      images: parseImages(row.images),
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

    const settings = await getSettingsMap(c.env.DB);
    const used = new Set<string>();
    const files = [
      {
        name: "content/moments/_index.md",
        content: toMomentsIndexMarkdown({
          site_title: settings.site_title,
          cover: settings.cover,
        }),
      },
      ...posts.map((post) => {
        const name = filenameFromDate(post.created_at, used);
        return {
          name: `content/moments/${name}`,
          content: toMomentMarkdown(post),
        };
      }),
    ];

    return json({
      ok: true,
      format: "hugo-markdown",
      target: "hugo-content-moments",
      hint: "解压到 Hugo 站点根目录，会得到 content/moments/，可直接替换使用",
      exported_at: now(),
      count: posts.length,
      files,
    });
  });

  app.post("/api/posts/import", async (c) => {
    const denied = await requireAdmin(c.req.raw, c.env);
    if (denied) return denied;

    const body = await readJson<{
      mode?: string;
      confirm_replace?: boolean;
      items?: Array<{ filename?: string; name?: string; markdown?: string; content?: string }>;
      files?: Array<{ filename?: string; name?: string; markdown?: string; content?: string }>;
      posts?: Array<Record<string, unknown>>;
      markdown?: string;
      filename?: string;
    }>(c.req.raw);

    if (!body) return error("无效的 JSON");

    const mode = body.mode === "replace" ? "replace" : "append";
    if (mode === "replace" && body.confirm_replace !== true) {
      return error("替换模式需要 confirm_replace: true");
    }
    const parsed: ImportablePost[] = [];
    const skipped: Array<{ source: string; reason: string }> = [];

    const fileItems = [...(body.items || []), ...(body.files || [])];
    for (const item of fileItems) {
      const filename = safeImportFilename(item.filename || item.name || "unknown.md");
      const markdown = item.markdown ?? item.content;
      if (typeof markdown !== "string") {
        skipped.push({ source: filename, reason: "缺少 markdown 内容" });
        continue;
      }
      if (/_index\.md$/i.test(filename)) {
        skipped.push({ source: filename, reason: "跳过 _index.md" });
        continue;
      }
      const moment = parseMomentMarkdown(markdown, filename);
      if (!moment) {
        skipped.push({ source: filename, reason: "无法解析或内容为空" });
        continue;
      }
      parsed.push({
        content: moment.content,
        images: sanitizeImageList(moment.images),
        created_at: clampTimestamp(moment.created_at),
        source: filename,
      });
    }

    if (typeof body.markdown === "string") {
      const moment = parseMomentMarkdown(body.markdown, safeImportFilename(body.filename || "import.md"));
      if (moment) {
        parsed.push({
          content: moment.content,
          images: sanitizeImageList(moment.images),
          created_at: clampTimestamp(moment.created_at),
          source: safeImportFilename(body.filename || "import.md"),
        });
      } else {
        skipped.push({ source: safeImportFilename(body.filename || "import.md"), reason: "无法解析或内容为空" });
      }
    }

    if (Array.isArray(body.posts)) {
      for (let i = 0; i < body.posts.length; i++) {
        const post = normalizeImportPost(body.posts[i], `posts[${i}]`);
        if (!post) {
          skipped.push({ source: `posts[${i}]`, reason: "内容和图片不能同时为空" });
          continue;
        }
        parsed.push(post);
      }
    }

    if (!parsed.length) return error(skipped.length ? "没有可导入的动态" : "请提供 items / files / posts");
    if (parsed.length > MAX_IMPORT_POSTS) {
      return error(`单次最多导入 ${MAX_IMPORT_POSTS} 条动态`);
    }

    if (mode === "replace") {
      await c.env.DB.batch([
        c.env.DB.prepare("DELETE FROM likes"),
        c.env.DB.prepare("DELETE FROM comments"),
        c.env.DB.prepare("DELETE FROM posts"),
      ]);
    }

    const existingKeys = new Set<string>();
    if (mode === "append") {
      const existing = await c.env.DB.prepare("SELECT content, created_at FROM posts").all<{
        content: string;
        created_at: number;
      }>();
      for (const row of existing.results || []) {
        existingKeys.add(`${row.created_at}::${row.content}`);
      }
    }

    const toInsert: ImportablePost[] = [];
    for (const post of parsed) {
      const key = `${post.created_at}::${post.content}`;
      if (mode === "append" && existingKeys.has(key)) {
        skipped.push({ source: post.source || "post", reason: "已存在相同内容与时间，已跳过" });
        continue;
      }
      existingKeys.add(key);
      toInsert.push(post);
    }

    const inserted: Array<{ id: string; content: string; images: string[]; created_at: number; source?: string }> = [];
    const stmts = [];
    for (const post of toInsert) {
      const postId = id();
      const ts = post.created_at;
      stmts.push(
        c.env.DB.prepare(
          "INSERT INTO posts (id, content, images, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        ).bind(postId, post.content, JSON.stringify(post.images), ts, ts),
      );
      inserted.push({
        id: postId,
        content: post.content,
        images: post.images,
        created_at: ts,
        source: post.source,
      });
    }

    const chunkSize = 50;
    for (let i = 0; i < stmts.length; i += chunkSize) {
      await c.env.DB.batch(stmts.slice(i, i + chunkSize));
    }

    return json({
      ok: true,
      mode,
      imported: inserted.length,
      skipped: skipped.length,
      data: inserted,
      skipped_items: skipped,
    }, 201);
  });

  // ---------- Posts ----------
  app.get("/api/posts", async (c) => {
    const limit = parseLimit(c.req.query("limit") ?? null);
    const offset = parseOffset(c.req.query("offset") ?? null);
    const clientId = sanitizeClientId(c.req.header("X-Client-Id") || c.req.query("client_id") || "");

    const listQuery = c.env.DB.prepare(
      `SELECT
         p.id, p.content, p.images, p.created_at, p.updated_at,
         (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
         (SELECT COUNT(*) FROM comments cm WHERE cm.post_id = p.id) AS comment_count,
         CASE WHEN ? != '' AND EXISTS(
           SELECT 1 FROM likes l2 WHERE l2.post_id = p.id AND l2.client_id = ?
         ) THEN 1 ELSE 0 END AS liked
       FROM posts p
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(clientId, clientId, limit, offset)
      .all<PostRow>();
    const countQuery = c.env.DB.prepare("SELECT COUNT(*) AS total FROM posts").first<{ total: number }>();
    const [rows, countRow] = await Promise.all([listQuery, countQuery]);

    const list = rows.results || [];
    const postIds = list.map((r) => r.id);
    const [likersMap, commentsMap] = await Promise.all([
      loadLikersByPosts(c.env.DB, postIds),
      loadCommentsByPosts(c.env.DB, postIds),
    ]);

    return json({
      ok: true,
      data: list.map((row) =>
        serializePost(row, clientId, {
          likers: likersMap.get(row.id) || [],
          comments: commentsMap.get(row.id) || [],
        }),
      ),
      meta: { total: Number(countRow?.total) || 0, limit, offset },
    });
  });

  app.get("/api/posts/:id", async (c) => {
    const postId = c.req.param("id");
    const clientId = sanitizeClientId(c.req.header("X-Client-Id") || c.req.query("client_id") || "");

    const row = await c.env.DB.prepare(
      `SELECT
         p.id, p.content, p.images, p.created_at, p.updated_at,
         (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
         (SELECT COUNT(*) FROM comments cm WHERE cm.post_id = p.id) AS comment_count,
         CASE WHEN ? != '' AND EXISTS(
           SELECT 1 FROM likes l2 WHERE l2.post_id = p.id AND l2.client_id = ?
         ) THEN 1 ELSE 0 END AS liked
       FROM posts p WHERE p.id = ?`,
    )
      .bind(clientId, clientId, postId)
      .first<PostRow>();

    if (!row) return error("动态不存在", 404);

    const [comments, likers] = await Promise.all([
      c.env.DB.prepare(
        `SELECT ${COMMENT_COLUMNS}
         FROM comments WHERE post_id = ? ORDER BY created_at ASC LIMIT 200`,
      )
        .bind(postId)
        .all<CommentRow>(),
      getPostLikers(c.env.DB, postId),
    ]);

    return json({
      ok: true,
      data: {
        ...serializePost(row, clientId, {
          likers,
          comments: (comments.results || []).map(serializePublicComment),
        }),
      },
    });
  });

  app.post("/api/posts", async (c) => {
    const denied = await requireAdmin(c.req.raw, c.env);
    if (denied) return denied;

    const body = await readJson<{ content?: string; images?: string[]; created_at?: number }>(c.req.raw);
    if (!body) return error("无效的 JSON");

    const content = clampText(body.content, 4000);
    const images = sanitizeImageList(body.images);

    if (!content && images.length === 0) return error("内容和图片不能同时为空");

    const postId = id();
    const ts = clampTimestamp(body.created_at, now());
    await c.env.DB.prepare(
      "INSERT INTO posts (id, content, images, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(postId, content, JSON.stringify(images), ts, ts)
      .run();

    return json({
      ok: true,
      data: {
        id: postId,
        content,
        images,
        created_at: ts,
        updated_at: ts,
        like_count: 0,
        comment_count: 0,
        liked: false,
        likers: [],
        comments: [],
      },
    }, 201);
  });

  app.put("/api/posts/:id", async (c) => {
    const denied = await requireAdmin(c.req.raw, c.env);
    if (denied) return denied;

    const postId = c.req.param("id");
    const existing = await c.env.DB.prepare(
      "SELECT id, created_at FROM posts WHERE id = ?",
    )
      .bind(postId)
      .first<{ id: string; created_at: number }>();
    if (!existing) return error("动态不存在", 404);

    const body = await readJson<{ content?: string; images?: string[]; created_at?: number }>(c.req.raw);
    if (!body) return error("无效的 JSON");

    const content = clampText(body.content, 4000);
    const images = sanitizeImageList(body.images);

    if (!content && images.length === 0) return error("内容和图片不能同时为空");

    const createdAt =
      body.created_at === undefined || body.created_at === null
        ? existing.created_at
        : clampTimestamp(body.created_at, existing.created_at);
    const updatedAt = now();

    await c.env.DB.prepare(
      "UPDATE posts SET content = ?, images = ?, created_at = ?, updated_at = ? WHERE id = ?",
    )
      .bind(content, JSON.stringify(images), createdAt, updatedAt, postId)
      .run();

    return json({
      ok: true,
      data: {
        id: postId,
        content,
        images,
        created_at: createdAt,
        updated_at: updatedAt,
      },
    });
  });

  app.delete("/api/posts/:id", async (c) => {
    const denied = await requireAdmin(c.req.raw, c.env);
    if (denied) return denied;

    const postId = c.req.param("id");
    const existing = await c.env.DB.prepare("SELECT id FROM posts WHERE id = ?").bind(postId).first();
    if (!existing) return error("动态不存在", 404);

    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM likes WHERE post_id = ?").bind(postId),
      c.env.DB.prepare("DELETE FROM comments WHERE post_id = ?").bind(postId),
      c.env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(postId),
    ]);

    return json({ ok: true });
  });

  // ---------- Likes ----------
  app.post("/api/posts/:id/likes", async (c) => {
    const postId = c.req.param("id");
    const body = await readJson<{ client_id?: string; author_name?: string }>(c.req.raw);
    const clientId = sanitizeClientId(body?.client_id || c.req.header("X-Client-Id"));
    if (!clientId) return error("缺少 client_id");
    const authorName = clampText(body?.author_name, 40);
    if (!authorName) return error("昵称不能为空");

    const post = await c.env.DB.prepare("SELECT id FROM posts WHERE id = ?").bind(postId).first();
    if (!post) return error("动态不存在", 404);

    await c.env.DB.prepare(
      `INSERT INTO likes (id, post_id, client_id, author_name, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(post_id, client_id) DO UPDATE SET author_name = excluded.author_name`,
    )
      .bind(id(), postId, clientId, authorName, now())
      .run();

    const [count, likers] = await Promise.all([
      c.env.DB.prepare("SELECT COUNT(*) AS total FROM likes WHERE post_id = ?")
        .bind(postId)
        .first<{ total: number }>(),
      getPostLikers(c.env.DB, postId),
    ]);

    return json({
      ok: true,
      liked: true,
      like_count: Number(count?.total) || 0,
      likers,
    });
  });

  app.delete("/api/posts/:id/likes", async (c) => {
    const postId = c.req.param("id");
    const body = await readJson<{ client_id?: string }>(c.req.raw);
    const clientId = sanitizeClientId(body?.client_id || c.req.header("X-Client-Id"));
    if (!clientId) return error("缺少 client_id");

    await c.env.DB.prepare("DELETE FROM likes WHERE post_id = ? AND client_id = ?")
      .bind(postId, clientId)
      .run();

    const [count, likers] = await Promise.all([
      c.env.DB.prepare("SELECT COUNT(*) AS total FROM likes WHERE post_id = ?")
        .bind(postId)
        .first<{ total: number }>(),
      getPostLikers(c.env.DB, postId),
    ]);

    return json({
      ok: true,
      liked: false,
      like_count: Number(count?.total) || 0,
      likers,
    });
  });

  // ---------- Comments ----------
  app.get("/api/posts/:id/comments", async (c) => {
    const postId = c.req.param("id");
    const post = await c.env.DB.prepare("SELECT id FROM posts WHERE id = ?").bind(postId).first();
    if (!post) return error("动态不存在", 404);

    const { results } = await c.env.DB.prepare(
      `SELECT ${COMMENT_COLUMNS}
       FROM comments WHERE post_id = ? ORDER BY created_at ASC LIMIT 200`,
    )
      .bind(postId)
      .all<CommentRow>();

    return json({
      ok: true,
      data: (results || []).map(serializePublicComment),
    });
  });

  app.post("/api/posts/:id/comments", async (c) => {
    const postId = c.req.param("id");
    const body = await readJson<{
      author_name?: string;
      author_email?: string;
      author_url?: string;
      content?: string;
      parent_id?: string;
    }>(c.req.raw);
    if (!body) return error("无效的 JSON");

    const authorName = clampText(body.author_name, 40);
    if (!authorName) return error("昵称不能为空");
    const authorEmail = clampText(body.author_email, 120);
    const authorUrl = sanitizeAuthorUrl(body.author_url);
    const content = clampText(body.content, 1000);
    if (!content) return error("评论内容不能为空");
    let parentId = clampText(body.parent_id, 64);

    const post = await c.env.DB.prepare(
      "SELECT id, content FROM posts WHERE id = ?",
    )
      .bind(postId)
      .first<{ id: string; content: string }>();
    if (!post) return error("动态不存在", 404);

    let parentAuthorName = "";
    let parentAuthorEmail = "";
    if (parentId) {
      const parent = await c.env.DB.prepare(
        "SELECT id, post_id, author_name, author_email FROM comments WHERE id = ?",
      )
        .bind(parentId)
        .first<{ id: string; post_id: string; author_name: string; author_email: string }>();
      if (!parent || parent.post_id !== postId) return error("回复的评论不存在");
      parentAuthorName = parent.author_name || "";
      parentAuthorEmail = parent.author_email || "";
    } else {
      parentId = "";
    }

    const commentId = id();
    const ts = now();
    await c.env.DB.prepare(
      `INSERT INTO comments (id, post_id, parent_id, author_name, author_email, author_url, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(commentId, postId, parentId, authorName, authorEmail, authorUrl, content, ts)
      .run();

    const settings = await getSettingsMap(c.env.DB);
    const siteOrigin =
      sanitizeSiteOrigin(settings.site_url, "") || new URL(c.req.url).origin;
    c.executionCtx.waitUntil(
      notifyCommentCreated(c.env, settings, {
        postId,
        postExcerpt: post.content || "",
        commentId,
        authorName,
        authorEmail,
        content,
        parentId,
        parentAuthorName,
        parentAuthorEmail,
        siteOrigin,
      }),
    );

    return json({
      ok: true,
      data: serializePublicComment({
        id: commentId,
        post_id: postId,
        parent_id: parentId,
        author_name: authorName,
        author_email: authorEmail,
        author_url: authorUrl,
        content,
        created_at: ts,
      }),
    }, 201);
  });

  app.delete("/api/comments/:id", async (c) => {
    const denied = await requireAdmin(c.req.raw, c.env);
    if (denied) return denied;

    const commentId = c.req.param("id");
    const existing = await c.env.DB.prepare("SELECT id FROM comments WHERE id = ?").bind(commentId).first();
    if (!existing) return error("评论不存在", 404);

    // 同时删除对该评论的直接回复
    const del = await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM comments WHERE parent_id = ?").bind(commentId),
      c.env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(commentId),
    ]);
    void del;

    return json({ ok: true });
  });

  // ---------- Admin management ----------
  app.get("/api/admin/comment-posts", async (c) => {
    const denied = await requireAdmin(c.req.raw, c.env);
    if (denied) return denied;

    const limit = parseLimit(c.req.query("limit") ?? null, 50, 200);
    const offset = parseOffset(c.req.query("offset") ?? null);

    const { results } = await c.env.DB.prepare(
      `SELECT
         p.id, p.content, p.created_at,
         (SELECT COUNT(*) FROM comments cm WHERE cm.post_id = p.id) AS comment_count,
         (SELECT MAX(cm.created_at) FROM comments cm WHERE cm.post_id = p.id) AS last_at
       FROM posts p
       WHERE EXISTS (SELECT 1 FROM comments cm WHERE cm.post_id = p.id)
       ORDER BY last_at DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(limit, offset)
      .all<{
        id: string;
        content: string;
        created_at: number;
        comment_count: number;
        last_at: number;
      }>();

    const countRow = await c.env.DB.prepare(
      `SELECT COUNT(*) AS total FROM posts p
       WHERE EXISTS (SELECT 1 FROM comments cm WHERE cm.post_id = p.id)`,
    ).first<{ total: number }>();

    return json({
      ok: true,
      data: (results || []).map((row) => ({
        id: row.id,
        content: row.content || "",
        created_at: row.created_at,
        comment_count: Number(row.comment_count) || 0,
        last_at: row.last_at,
      })),
      meta: { total: Number(countRow?.total) || 0, limit, offset },
    });
  });

  app.get("/api/admin/like-posts", async (c) => {
    const denied = await requireAdmin(c.req.raw, c.env);
    if (denied) return denied;

    const limit = parseLimit(c.req.query("limit") ?? null, 50, 200);
    const offset = parseOffset(c.req.query("offset") ?? null);

    const { results } = await c.env.DB.prepare(
      `SELECT
         p.id, p.content, p.created_at,
         (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
         (SELECT MAX(l.created_at) FROM likes l WHERE l.post_id = p.id) AS last_at
       FROM posts p
       WHERE EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id)
       ORDER BY last_at DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(limit, offset)
      .all<{
        id: string;
        content: string;
        created_at: number;
        like_count: number;
        last_at: number;
      }>();

    const countRow = await c.env.DB.prepare(
      `SELECT COUNT(*) AS total FROM posts p
       WHERE EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id)`,
    ).first<{ total: number }>();

    return json({
      ok: true,
      data: (results || []).map((row) => ({
        id: row.id,
        content: row.content || "",
        created_at: row.created_at,
        like_count: Number(row.like_count) || 0,
        last_at: row.last_at,
      })),
      meta: { total: Number(countRow?.total) || 0, limit, offset },
    });
  });

  app.get("/api/admin/page-likes", async (c) => {
    const denied = await requireAdmin(c.req.raw, c.env);
    if (denied) return denied;

    const limit = parseLimit(c.req.query("limit") ?? null, 50, 200);
    const offset = parseOffset(c.req.query("offset") ?? null);

    const { results } = await c.env.DB.prepare(
      `SELECT path, like_count, updated_at
       FROM page_likes
       WHERE like_count > 0
       ORDER BY like_count DESC, updated_at DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(limit, offset)
      .all<{ path: string; like_count: number; updated_at: number }>();

    const countRow = await c.env.DB.prepare(
      "SELECT COUNT(*) AS total FROM page_likes WHERE like_count > 0",
    ).first<{ total: number }>();

    return json({
      ok: true,
      data: (results || []).map((row) => ({
        path: row.path,
        like_count: Number(row.like_count) || 0,
        updated_at: row.updated_at,
      })),
      meta: { total: Number(countRow?.total) || 0, limit, offset },
    });
  });

  app.get("/api/admin/comments", async (c) => {
    const denied = await requireAdmin(c.req.raw, c.env);
    if (denied) return denied;

    const limit = parseLimit(c.req.query("limit") ?? null, 50, 200);
    const offset = parseOffset(c.req.query("offset") ?? null);
    const postId = clampText(c.req.query("post_id"), 64);

    const where = postId ? "WHERE cm.post_id = ?" : "";
    const binds = postId ? [postId, limit, offset] : [limit, offset];

    const { results } = await c.env.DB.prepare(
      `SELECT
         cm.id, cm.post_id, cm.parent_id, cm.author_name, cm.author_email, cm.author_url,
         cm.content, cm.created_at,
         p.content AS post_content, p.created_at AS post_created_at
       FROM comments cm
       LEFT JOIN posts p ON p.id = cm.post_id
       ${where}
       ORDER BY cm.created_at DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(...binds)
      .all();

    const countRow = postId
      ? await c.env.DB.prepare("SELECT COUNT(*) AS total FROM comments WHERE post_id = ?")
          .bind(postId)
          .first<{ total: number }>()
      : await c.env.DB.prepare("SELECT COUNT(*) AS total FROM comments").first<{ total: number }>();

    return json({
      ok: true,
      data: (results || []).map((row) => ({
        id: row.id,
        post_id: row.post_id,
        parent_id: row.parent_id || "",
        author_name: row.author_name,
        author_email: row.author_email || "",
        author_url: row.author_url || "",
        content: row.content,
        created_at: row.created_at,
        post_excerpt: String(row.post_content || "").slice(0, 80),
        post_created_at: row.post_created_at,
      })),
      meta: { total: Number(countRow?.total) || 0, limit, offset },
    });
  });

  app.get("/api/admin/likes", async (c) => {
    const denied = await requireAdmin(c.req.raw, c.env);
    if (denied) return denied;

    const limit = parseLimit(c.req.query("limit") ?? null, 50, 200);
    const offset = parseOffset(c.req.query("offset") ?? null);
    const postId = clampText(c.req.query("post_id"), 64);

    const where = postId ? "WHERE l.post_id = ?" : "";
    const binds = postId ? [postId, limit, offset] : [limit, offset];

    const { results } = await c.env.DB.prepare(
      `SELECT
         l.id, l.post_id, l.client_id, l.author_name, l.created_at,
         p.content AS post_content, p.created_at AS post_created_at
       FROM likes l
       LEFT JOIN posts p ON p.id = l.post_id
       ${where}
       ORDER BY l.created_at DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(...binds)
      .all();

    const countRow = postId
      ? await c.env.DB.prepare("SELECT COUNT(*) AS total FROM likes WHERE post_id = ?")
          .bind(postId)
          .first<{ total: number }>()
      : await c.env.DB.prepare("SELECT COUNT(*) AS total FROM likes").first<{ total: number }>();

    return json({
      ok: true,
      data: (results || []).map((row) => ({
        id: row.id,
        post_id: row.post_id,
        client_id: row.client_id,
        author_name: row.author_name || "访客",
        created_at: row.created_at,
        post_excerpt: String(row.post_content || "").slice(0, 80),
        post_created_at: row.post_created_at,
      })),
      meta: { total: Number(countRow?.total) || 0, limit, offset },
    });
  });

  app.delete("/api/likes/:id", async (c) => {
    const denied = await requireAdmin(c.req.raw, c.env);
    if (denied) return denied;

    const likeId = c.req.param("id");
    const existing = await c.env.DB.prepare("SELECT id FROM likes WHERE id = ?").bind(likeId).first();
    if (!existing) return error("点赞不存在", 404);

    await c.env.DB.prepare("DELETE FROM likes WHERE id = ?").bind(likeId).run();
    return json({ ok: true });
  });

  // ---------- Blog page likes (path only, domain ignored) ----------
  async function assertPageLikeWrite(env: Env, request: Request, password: string): Promise<Response | null> {
    const enabled = await env.DB.prepare("SELECT value FROM settings WHERE key = 'page_likes_enabled'")
      .first<{ value: string }>();
    if (String(enabled?.value || "0") === "0") return error("文章点赞未启用", 403);

    const rec = await getAuthRecord(env.DB);
    if (!rec.initialized) return error("站点尚未初始化，请先设置管理员账号", 401);

    const token = getBearerToken(request);
    if (token) {
      const recWithSecret = await ensureTokenSecret(env.DB, rec);
      if (await verifyAdminToken(recWithSecret.tokenSecret, token)) return null;
    }

    if (!password || !(await verifyPassword(password, rec.passwordHash))) {
      return error("站点密码错误", 401);
    }
    return null;
  }

  async function pageLikeState(db: D1Database, path: string, clientId: string) {
    const [countRow, likedRow] = await Promise.all([
      db.prepare("SELECT like_count FROM page_likes WHERE path = ?").bind(path).first<{ like_count: number }>(),
      clientId
        ? db
            .prepare("SELECT 1 AS ok FROM page_like_clients WHERE path = ? AND client_id = ?")
            .bind(path, clientId)
            .first<{ ok: number }>()
        : Promise.resolve(null),
    ]);
    return {
      path,
      like_count: Number(countRow?.like_count) || 0,
      liked: Boolean(likedRow),
    };
  }

  app.get("/api/page-likes", async (c) => {
    const path = normalizePagePath(c.req.query("url") || c.req.query("path"));
    if (!path) return error("缺少有效的文章网址 / 路径");
    const clientId = sanitizeClientId(c.req.header("X-Client-Id") || c.req.query("client_id") || "");
    return json({ ok: true, data: await pageLikeState(c.env.DB, path, clientId) });
  });

  app.post("/api/page-likes", async (c) => {
    const body = await readJson<{ url?: string; path?: string; password?: string; client_id?: string }>(c.req.raw);
    if (!body) return error("无效的 JSON");
    const denied = await assertPageLikeWrite(c.env, c.req.raw, typeof body.password === "string" ? body.password : "");
    if (denied) return denied;
    const path = normalizePagePath(body.url || body.path);
    if (!path) return error("缺少有效的文章网址 / 路径");
    const clientId = sanitizeClientId(body.client_id || c.req.header("X-Client-Id"));
    if (!clientId) return error("缺少 client_id");

    const already = await c.env.DB.prepare(
      "SELECT 1 AS ok FROM page_like_clients WHERE path = ? AND client_id = ?",
    )
      .bind(path, clientId)
      .first();
    if (!already) {
      const ts = now();
      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO page_likes (path, like_count, updated_at) VALUES (?, 1, ?)
           ON CONFLICT(path) DO UPDATE SET like_count = like_count + 1, updated_at = excluded.updated_at`,
        ).bind(path, ts),
        c.env.DB.prepare("INSERT INTO page_like_clients (path, client_id, created_at) VALUES (?, ?, ?)").bind(
          path,
          clientId,
          ts,
        ),
      ]);
    }
    return json({ ok: true, data: await pageLikeState(c.env.DB, path, clientId) });
  });

  app.delete("/api/page-likes", async (c) => {
    const body = await readJson<{ url?: string; path?: string; password?: string; client_id?: string }>(c.req.raw);
    if (!body) return error("无效的 JSON");
    const denied = await assertPageLikeWrite(c.env, c.req.raw, typeof body.password === "string" ? body.password : "");
    if (denied) return denied;
    const path = normalizePagePath(body.url || body.path);
    if (!path) return error("缺少有效的文章网址 / 路径");
    const clientId = sanitizeClientId(body.client_id || c.req.header("X-Client-Id"));
    if (!clientId) return error("缺少 client_id");

    const existed = await c.env.DB.prepare(
      "SELECT 1 AS ok FROM page_like_clients WHERE path = ? AND client_id = ?",
    )
      .bind(path, clientId)
      .first();
    if (existed) {
      const ts = now();
      await c.env.DB.batch([
        c.env.DB.prepare("DELETE FROM page_like_clients WHERE path = ? AND client_id = ?").bind(path, clientId),
        c.env.DB.prepare(
          `UPDATE page_likes SET like_count = MAX(like_count - 1, 0), updated_at = ? WHERE path = ?`,
        ).bind(ts, path),
      ]);
    }
    return json({ ok: true, data: await pageLikeState(c.env.DB, path, clientId) });
  });

  app.notFound(async (c) => {
    if (c.req.path.startsWith("/api/")) {
      return error("接口不存在", 404);
    }
    if (!isSafeAssetPath(c.req.path)) {
      return error("无效路径", 400);
    }
    let req = c.req.raw;
    let res = await c.env.ASSETS.fetch(req);
    for (let i = 0; i < 3 && res.status >= 300 && res.status < 400; i++) {
      const loc = res.headers.get("Location");
      if (!loc) break;
      const next = new URL(loc, req.url);
      if (next.origin !== new URL(c.req.url).origin) break;
      if (!isSafeAssetPath(next.pathname)) break;
      req = new Request(next, { method: "GET", headers: { Accept: req.headers.get("Accept") || "*/*" } });
      res = await c.env.ASSETS.fetch(req);
    }
    const headers = new Headers(res.headers);
    applySecurityHeaders(headers, headers.get("content-type") || "");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  });

  app.onError((err, c) => {
    console.error(err);
    if (isMissingD1Table(err)) {
      return error("数据库尚未建表，请在本机运行 npm run db:migrate:local", 503);
    }
    return error("服务器错误", 500);
  });

  return app;
}
