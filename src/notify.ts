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
};

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

function buildBodies(payload: CommentNotifyPayload, settings: NotifySettings, kind: "admin" | "reply") {
  const title = oneLine(settings.site_title || "动态", 80);
  const nick = oneLine(settings.nickname || "管理员", 40);
  const postLine = excerpt(payload.postExcerpt, 80) || "（无文字）";
  const commentLine = excerpt(payload.content, 200);
  const origin = safeSiteOrigin(payload.siteOrigin);
  const link = origin ? `${origin}/#post-${payload.postId}` : "";
  const author = oneLine(payload.authorName, 40);

  if (kind === "admin") {
    const isReply = Boolean(payload.parentId);
    const subject = isReply
      ? `【${title}】新回复：${author}`
      : `【${title}】新评论：${author}`;
    const replyHint = isReply
      ? `回复 @${oneLine(payload.parentAuthorName || "访客", 40)}`
      : "新评论";
    const text = [
      `${nick}，你好：`,
      "",
      `动态收到${replyHint}。`,
      `动态：${postLine}`,
      `评论者：${author}`,
      `内容：${commentLine}`,
      "",
      `查看：${link}`,
    ].join("\n");
    const html = `
      <p>${escapeHtml(nick)}，你好：</p>
      <p>动态收到<strong>${escapeHtml(replyHint)}</strong>。</p>
      <p><strong>动态：</strong>${escapeHtml(postLine)}</p>
      <p><strong>评论者：</strong>${escapeHtml(author)}</p>
      <p><strong>内容：</strong>${escapeHtml(commentLine)}</p>
      ${link ? `<p><a href="${escapeHtml(link)}">打开动态</a></p>` : ""}
    `;
    return { subject, text, html };
  }

  const parentNick = oneLine(payload.parentAuthorName || "你好", 40);
  const subject = `【${title}】${author} 回复了你`;
  const text = [
    `${parentNick}：`,
    "",
    `${author} 回复了你的评论。`,
    `动态：${postLine}`,
    `回复：${commentLine}`,
    "",
    `查看：${link}`,
  ].join("\n");
  const html = `
    <p>${escapeHtml(parentNick)}：</p>
    <p><strong>${escapeHtml(author)}</strong> 回复了你的评论。</p>
    <p><strong>动态：</strong>${escapeHtml(postLine)}</p>
    <p><strong>回复：</strong>${escapeHtml(commentLine)}</p>
    ${link ? `<p><a href="${escapeHtml(link)}">打开动态</a></p>` : ""}
  `;
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

async function sendViaResend(
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

  await sendViaResend(apiKey, to, mailFrom, mailFromName, subject, text, html);
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
    const tasks: Promise<void>[] = [];

    if (looksLikeEmail(adminEmail)) {
      const adminBody = buildBodies(payload, settings, "admin");
      tasks.push(
        sendViaResend(
          apiKey,
          adminEmail,
          settings.mail_from,
          settings.mail_from_name,
          adminBody.subject,
          adminBody.text,
          adminBody.html,
        ).catch((err) => console.error("[notify] admin Resend mail", redactSecrets(String(err)))),
      );
    }

    await Promise.all(tasks);
  } catch (err) {
    console.error("[notify] unexpected", redactSecrets(String(err)));
  }
}
