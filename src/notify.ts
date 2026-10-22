import { decryptSettingSecret, hasStoredResendKey } from "./secret-store";
import { clampText } from "./utils";

export type NotifySettings = {
  notify_enabled: string;
  admin_email: string;
  mail_from: string;
  mail_from_name: string;
  site_title: string;
  site_url: string;
  nickname: string;
  mail_tpl_comment_subject: string;
  mail_tpl_comment_body: string;
  mail_tpl_reply_subject: string;
  mail_tpl_reply_body: string;
};

/** Default mail templates (also used when saved value is empty). */
export const DEFAULT_MAIL_TEMPLATES = {
  mail_tpl_comment_subject: "【{{site_title}}】{{event}}：{{author}}",
  mail_tpl_comment_body: `{{nickname}}，你好：

动态收到{{event}}。
动态：{{post}}
评论者：{{author}}
内容：{{content}}

查看：{{link}}`,
  mail_tpl_reply_subject: "【{{site_title}}】{{author}} 回复了你",
  mail_tpl_reply_body: `{{parent_author}}：

{{author}} 回复了你的评论。
动态：{{post}}
回复：{{content}}

查看：{{link}}`,
} as const;

export type CommentNotifyPayload = {
  postId: string;
  postExcerpt: string;
  commentId: string;
  authorName: string;
  authorEmail?: string;
  content: string;
  parentId: string;
  parentAuthorName?: string;
  parentAuthorEmail?: string;
  siteOrigin: string;
};

function normalizeEmail(value: string): string {
  return String(value || "").trim().toLowerCase();
}

function looksLikeEmail(value: string): boolean {
  const v = value.trim();
  if (!v || v.length > 120 || /[\r\n,<>]/.test(v)) return false;
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(v);
}

function escapeHtml(str: string): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeSiteOrigin(origin: string): string {
  try {
    const u = new URL(origin);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    if (u.username || u.password) return "";
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}

function excerpt(text: string, max = 120): string {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function oneLine(value: string, max = 120): string {
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function resolveMailFrom(settingsMap: Record<string, string>): string {
  return (
    clampText(settingsMap.mail_from, 120) ||
    clampText(settingsMap.mail_from_resend, 120) ||
    clampText(settingsMap.mail_from_cf, 120)
  );
}

const TPL_VAR_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return String(tpl || "").replace(TPL_VAR_RE, (_m, key: string) => vars[key] ?? "");
}

function textToNotifyHtml(text: string, link: string): string {
  const blocks = String(text || "")
    .split(/\n{2,}/)
    .map((block) => block.trimEnd())
    .filter((block) => block.length > 0);
  if (!blocks.length) return "<p></p>";
  const safeLink = link ? escapeHtml(link) : "";
  return blocks
    .map((block) => {
      let html = escapeHtml(block).replace(/\n/g, "<br>\n");
      if (safeLink && html.includes(safeLink)) {
        html = html.split(safeLink).join(`<a href="${safeLink}">${safeLink}</a>`);
      }
      return `<p>${html}</p>`;
    })
    .join("\n");
}

function resolveTpl(settings: NotifySettings, key: keyof typeof DEFAULT_MAIL_TEMPLATES): string {
  const raw = String(settings[key] || "").trim();
  return raw || DEFAULT_MAIL_TEMPLATES[key];
}

function buildBodies(payload: CommentNotifyPayload, settings: NotifySettings, kind: "admin" | "reply") {
  const title = oneLine(settings.site_title || "动态", 80);
  const nick = oneLine(settings.nickname || "管理员", 40);
  const postLine = excerpt(payload.postExcerpt, 80) || "（无文字）";
  const commentLine = excerpt(payload.content, 200);
  const origin = safeSiteOrigin(payload.siteOrigin);
  const link = origin ? `${origin}/#post-${payload.postId}` : "";
  const author = oneLine(payload.authorName, 40);
  const parentAuthor = oneLine(payload.parentAuthorName || "访客", 40);
  const isReply = Boolean(payload.parentId);
  const event = isReply ? `回复 @${parentAuthor}` : "新评论";

  const vars: Record<string, string> = {
    site_title: title,
    nickname: nick,
    author,
    content: commentLine,
    post: postLine,
    link,
    parent_author: parentAuthor,
    event,
  };

  const subjectTpl =
    kind === "reply"
      ? resolveTpl(settings, "mail_tpl_reply_subject")
      : resolveTpl(settings, "mail_tpl_comment_subject");
  const bodyTpl =
    kind === "reply"
      ? resolveTpl(settings, "mail_tpl_reply_body")
      : resolveTpl(settings, "mail_tpl_comment_body");

  const subject = oneLine(renderTemplate(subjectTpl, vars), 200) || `【${title}】通知`;
  const text = renderTemplate(bodyTpl, vars).replace(/\r\n/g, "\n").trimEnd();
  const html = textToNotifyHtml(text, link);
  return { subject, text, html };
}

/** True when encrypted (or legacy) API key exists in settings. */
export function isResendConfigured(settingsMap: Record<string, string>): boolean {
  return hasStoredResendKey(settingsMap.resend_api_key || "");
}

/** Resolve plaintext Resend API key from encrypted settings. */
export async function resolveResendApiKey(
  env: Env,
  settingsMap: Record<string, string>,
  override?: string,
): Promise<string> {
  const fromBody = clampText(override, 200);
  if (fromBody) return fromBody;
  const stored = settingsMap.resend_api_key || "";
  if (!stored) return "";
  const plain = await decryptSettingSecret(env, stored);
  if (!plain && stored) {
    throw new Error("无法解密 Resend API Key（请重新保存 Key）");
  }
  return plain;
}

/** Strip accidental secret material from messages returned to clients / logs. */
function redactSecrets(text: string): string {
  return String(text || "")
    .replace(/\bre_[A-Za-z0-9_]{8,}\b/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}

async function recordMailSent(db: D1Database, to: string): Promise<void> {
  try {
    const email = clampText(to, 120);
    if (!looksLikeEmail(email)) return;
    const id = crypto.randomUUID();
    const sentAt = Date.now();
    await db.prepare("INSERT INTO mail_log (id, to_email, sent_at) VALUES (?, ?, ?)").bind(id, email, sentAt).run();
    // 控制体积：只保留最近 500 条
    const countRow = await db.prepare("SELECT COUNT(*) AS n FROM mail_log").first<{ n: number }>();
    const n = Number(countRow?.n) || 0;
    if (n > 500) {
      await db
        .prepare(
          `DELETE FROM mail_log WHERE id IN (
             SELECT id FROM mail_log ORDER BY sent_at ASC LIMIT ?
           )`,
        )
        .bind(n - 500)
        .run();
    }
  } catch (err) {
    console.error("[notify] mail_log", redactSecrets(String(err)));
  }
}

async function sendViaResend(
  env: Env,
  apiKey: string,
  to: string,
  fromEmail: string,
  fromNameRaw: string,
  subject: string,
  text: string,
  html: string,
): Promise<void> {
  const key = String(apiKey || "").trim();
  if (!key) {
    throw new Error("未配置 Resend API Key（请在设置页「评论邮件通知」中填写并保存）");
  }
  const fromName = String(fromNameRaw || "")
    .replace(/[<>"]/g, "")
    .trim();
  const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, text, html }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let detail = body.slice(0, 240);
    try {
      const parsed = JSON.parse(body) as { message?: string; error?: string };
      detail = parsed.message || parsed.error || detail;
    } catch {
      /* keep raw */
    }
    throw new Error(`Resend 发送失败（${res.status}）：${redactSecrets(detail)}`);
  }
  await recordMailSent(env.DB, to);
}

/** Send a one-off test mail to verify Resend + address config. Throws on failure. */
export async function sendNotifyTestEmail(
  env: Env,
  settingsMap: Record<string, string>,
  opts: {
    to: string;
    mailFrom: string;
    mailFromName?: string;
    siteTitle?: string;
    siteOrigin?: string;
    /** Optional one-shot key from form (not persisted unless saved separately). */
    apiKey?: string;
  },
): Promise<void> {
  const to = clampText(opts.to, 120);
  const mailFrom = clampText(opts.mailFrom, 120);
  const mailFromName = clampText(opts.mailFromName, 80) || "动态通知";
  if (!looksLikeEmail(to)) throw new Error("管理员邮箱无效");
  if (!looksLikeEmail(mailFrom)) throw new Error("发件地址无效");

  const apiKey = await resolveResendApiKey(env, settingsMap, opts.apiKey);
  if (!apiKey) throw new Error("未配置 Resend API Key（请在设置页填写）");

  const title = oneLine(clampText(opts.siteTitle, 80) || "动态", 80);
  const origin = safeSiteOrigin(clampText(opts.siteOrigin, 300) || "");
  const subject = `【${title}】邮件通知测试成功`;
  const text = [
    "这是一封来自 AIOVTUE-memos 的测试邮件。",
    "",
    "若你收到此信，说明 Resend API Key、发件地址与管理员邮箱配置正确。",
    origin ? `站点：${origin}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const html = `
    <p>这是一封来自 <strong>AIOVTUE-memos</strong> 的测试邮件。</p>
    <p>若你收到此信，说明 Resend API Key、发件地址与管理员邮箱配置正确。</p>
    ${origin ? `<p>站点：<a href="${escapeHtml(origin)}">${escapeHtml(origin)}</a></p>` : ""}
  `;

  await sendViaResend(env, apiKey, to, mailFrom, mailFromName, subject, text, html);
}

/** Fire-and-forget comment notifications via Resend. Never throws to caller. */
export async function notifyCommentCreated(
  env: Env,
  settingsMap: Record<string, string>,
  payload: CommentNotifyPayload,
): Promise<void> {
  try {
    const settings: NotifySettings = {
      notify_enabled: settingsMap.notify_enabled ?? "1",
      admin_email: clampText(settingsMap.admin_email, 120),
      mail_from: resolveMailFrom(settingsMap),
      mail_from_name: clampText(settingsMap.mail_from_name, 80) || settingsMap.nickname || "动态通知",
      site_title: settingsMap.site_title || "动态",
      site_url: clampText(settingsMap.site_url, 300),
      nickname: settingsMap.nickname || "管理员",
      mail_tpl_comment_subject: settingsMap.mail_tpl_comment_subject || "",
      mail_tpl_comment_body: settingsMap.mail_tpl_comment_body || "",
      mail_tpl_reply_subject: settingsMap.mail_tpl_reply_subject || "",
      mail_tpl_reply_body: settingsMap.mail_tpl_reply_body || "",
    };

    if (settings.notify_enabled === "0") return;
    if (!looksLikeEmail(settings.mail_from)) {
      console.warn("[notify] mail_from missing/invalid");
      return;
    }

    let apiKey = "";
    try {
      apiKey = await resolveResendApiKey(env, settingsMap);
    } catch (err) {
      console.error("[notify] api key", redactSecrets(String(err)));
      return;
    }
    if (!apiKey) {
      console.warn("[notify] resend_api_key missing");
      return;
    }

    const adminEmail = settings.admin_email;
    const authorEmail = clampText(payload.authorEmail, 120);
    const parentEmail = clampText(payload.parentAuthorEmail, 120);
    const authorNorm = normalizeEmail(authorEmail);
    const adminNorm = normalizeEmail(adminEmail);
    const parentNorm = normalizeEmail(parentEmail);
    /** 评论者邮箱与管理员邮箱相同（忽略大小写）才视为管理员评论 */
    const isAdminEmailAuthor = Boolean(adminNorm && authorNorm && authorNorm === adminNorm);
    const notified = new Set<string>();
    const tasks: Promise<void>[] = [];

    const enqueue = (to: string, kind: "admin" | "reply", logTag: string) => {
      const key = normalizeEmail(to);
      if (!key || notified.has(key)) return;
      notified.add(key);
      const body = buildBodies(payload, settings, kind);
      tasks.push(
        sendViaResend(
          env,
          apiKey,
          to,
          settings.mail_from,
          settings.mail_from_name,
          body.subject,
          body.text,
          body.html,
        ).catch((err) => console.error(`[notify] ${logTag}`, redactSecrets(String(err)))),
      );
    };

    // 回复：通知被回复者（自己回自己不发；邮箱无效则跳过）
    if (payload.parentId && looksLikeEmail(parentEmail) && parentNorm !== authorNorm) {
      enqueue(parentEmail, "reply", "reply Resend mail");
    }

    // 非管理员邮箱的评论 / 回复：通知管理员（与被回复者同址时上面已发过，这里去重）
    if (!isAdminEmailAuthor && looksLikeEmail(adminEmail)) {
      enqueue(adminEmail, "admin", "admin Resend mail");
    }

    await Promise.all(tasks);
  } catch (err) {
    console.error("[notify] unexpected", redactSecrets(String(err)));
  }
}
