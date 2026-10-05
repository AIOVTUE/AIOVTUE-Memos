const TOKEN_KEY = "hugo_memos_token";
const CLIENT_KEY = "hugo_memos_client_id";
const NAME_KEY = "hugo_memos_display_name";
const PROFILE_KEY = "hugo_memos_visitor_profile";

export function getClientId() {
  let id = localStorage.getItem(CLIENT_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(CLIENT_KEY, id);
  }
  return id;
}

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || "";
}

export function setToken(token) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

export function getVisitorProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        nick: String(parsed.nick || "").trim(),
        mail: String(parsed.mail || "").trim(),
        link: String(parsed.link || "").trim(),
      };
    }
  } catch {
    /* ignore */
  }
  const legacy = localStorage.getItem(NAME_KEY) || "";
  return { nick: legacy.trim(), mail: "", link: "" };
}

export function setVisitorProfile(profile = {}) {
  const next = {
    nick: String(profile.nick || "").trim(),
    mail: String(profile.mail || "").trim(),
    link: String(profile.link || "").trim(),
  };
  localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
  if (next.nick) localStorage.setItem(NAME_KEY, next.nick);
  else localStorage.removeItem(NAME_KEY);
  return next;
}

export function getDisplayName() {
  return getVisitorProfile().nick;
}

export function setDisplayName(name) {
  const profile = getVisitorProfile();
  setVisitorProfile({ ...profile, nick: name || "" });
}

export async function fetchAuthStatus() {
  const res = await api("/api/auth/status");
  return Boolean(res.data?.initialized);
}

export function needsSetup(err) {
  return Boolean(err?.data?.setup_required) || /尚未初始化/.test(String(err?.message || ""));
}

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("X-Client-Id", getClientId());
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({ ok: false, error: "响应解析失败" }));
  if (!res.ok || data.ok === false) {
    const err = new Error(data.error || `请求失败 (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function formatTime(ts) {
  const date = new Date(ts);
  const now = new Date();
  const diff = now - date;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  if (y === now.getFullYear()) return `${m}-${d} ${hh}:${mm}`;
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

/** Always include year: YYYY-MM-DD HH:mm */
export function formatDateTime(ts) {
  const date = new Date(ts);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

export function toast(message) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove("show"), 2200);
}

export function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function normalizeMail(mail = "") {
  return String(mail || "").trim().toLowerCase();
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** WeAvatar URL from email (SHA-256); empty when mail missing. */
const avatarUrlCache = new Map();
export async function gravatarUrl(mail, nick = "", size = 80) {
  const email = normalizeMail(mail);
  if (!email || !email.includes("@")) return "";
  const name = String(nick || "").trim() || "访客";
  const key = `${email}|${size}|${name}`;
  const cached = avatarUrlCache.get(key);
  if (cached) return cached;
  const hash = await sha256Hex(email);
  const url = `https://weavatar.com/avatar/${hash}?d=initials&name=${encodeURIComponent(name)}&s=${size}`;
  avatarUrlCache.set(key, url);
  return url;
}

export function commentAvatarHtml(mail, nick = "", className = "tk-avatar") {
  const initial = escapeHtml((String(nick || "访").trim().slice(0, 1) || "访").toUpperCase());
  const mailAttr = escapeHtml(normalizeMail(mail));
  const nickAttr = escapeHtml(String(nick || "").trim());
  return `<div class="${className}" data-avatar-mail="${mailAttr}" data-avatar-nick="${nickAttr}"><span class="tk-avatar-fallback">${initial}</span></div>`;
}

export async function hydrateAvatars(root = document) {
  const nodes = [...root.querySelectorAll("[data-avatar-mail]")];
  const groups = new Map();
  for (const el of nodes) {
    const mail = el.getAttribute("data-avatar-mail") || "";
    if (!mail) continue;
    const nick = el.getAttribute("data-avatar-nick") || "";
    const key = `${normalizeMail(mail)}|${nick}`;
    const group = groups.get(key) || { mail, nick, els: [] };
    group.els.push(el);
    groups.set(key, group);
  }
  await Promise.all(
    [...groups.values()].map(async (group) => {
      const url = await gravatarUrl(group.mail, group.nick, 80);
      if (!url) return;
      const html = `<img class="tk-avatar-img" src="${escapeHtml(url)}" alt="" width="40" height="40" loading="lazy" decoding="async" />`;
      for (const el of group.els) {
        el.classList.add("tk-has-avatar");
        el.innerHTML = html;
      }
    }),
  );
}

export function defaultAvatar(_name = "M") {
  return "/img/toux.webp";
}

export function isVideoUrl(url = "") {
  return /\.(mp4|webm|ogg)(\?|$)/i.test(url);
}

/** Feed avatar: video shows first frame (no autoplay), matching Hugo moments. */
export function avatarMedia(url, className = "travel-moment__avatar", alt = "头像") {
  const src = url || defaultAvatar();
  if (isVideoUrl(src)) {
    return `<video class="${className}" src="${escapeHtml(src)}" muted playsinline preload="metadata" disablepictureinpicture aria-hidden="true"></video>`;
  }
  return `<img class="${className}" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" width="42" height="42" loading="lazy" decoding="async" />`;
}
