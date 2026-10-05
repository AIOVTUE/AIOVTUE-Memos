import {
  api,
  avatarMedia,
  defaultAvatar,
  escapeHtml,
  formatTime,
  fetchAuthStatus,
  getDisplayName,
  getToken,
  getVisitorProfile,
  gravatarUrl,
  isVideoUrl,
  needsSetup,
  setToken,
  setVisitorProfile,
  toast,
} from "./api.js";
import { renderMarkdown } from "./markdown.js";
import { initDesktopScrollDamping } from "./smooth-scroll.js";
import { initTheme, toggleTheme, getTheme } from "./theme.js";

const FEED_PAGE_SIZE = 10;

const state = {
  settings: null,
  posts: [],
  isAdmin: false,
  feedOffset: 0,
  feedTotal: 0,
  feedLoading: false,
  feedHasMore: true,
};

const feedEl = document.getElementById("feed");
const composeMask = document.getElementById("composeMask");
const editPostMask = document.getElementById("editPostMask");
const loginMask = document.getElementById("loginMask");
const lightbox = document.getElementById("lightbox");
const accountBtn = document.getElementById("accountBtn");
const accountDropdown = document.getElementById("accountDropdown");

const MORE_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="6" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="18" cy="12" r="1.7" fill="currentColor"/></svg>`;

let feedObserver = null;

const COMMENT_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2m0 14H6l-2 2V4h16v12z"/></svg>`;
const LIKE_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;

function renderCoverAvatar(src) {
  const url = src || defaultAvatar();
  const el = document.getElementById("coverAvatar");
  el.innerHTML = isVideoUrl(url)
    ? `<video src="${escapeHtml(url)}" muted playsinline preload="metadata" disablepictureinpicture></video>`
    : `<img src="${escapeHtml(url)}" alt="" />`;
}

function closeAccountMenu() {
  accountDropdown.hidden = true;
  accountBtn.setAttribute("aria-expanded", "false");
}

function openAccountMenu() {
  accountDropdown.hidden = false;
  accountBtn.setAttribute("aria-expanded", "true");
}

let setupMode = false;

function setLoginMode(isSetup) {
  setupMode = Boolean(isSetup);
  const title = document.getElementById("loginTitle");
  const hint = document.getElementById("loginHint");
  const submit = document.getElementById("loginSubmit");
  const wrap = document.getElementById("loginPassword2Field");
  const pass = document.getElementById("loginPassword");
  if (title) title.textContent = setupMode ? "初始化站点" : "管理登录";
  if (hint) {
    hint.textContent = setupMode
      ? "数据库还没有管理员账号。设置后即可管理站点，不会清空已有动态、评论或点赞。"
      : "使用数据库中的管理员账号登录。";
  }
  if (submit) submit.textContent = setupMode ? "完成初始化" : "登录";
  if (wrap) wrap.hidden = !setupMode;
  if (pass) pass.autocomplete = setupMode ? "new-password" : "current-password";
}

async function openLogin() {
  closeAccountMenu();
  try {
    const initialized = await fetchAuthStatus();
    setLoginMode(!initialized);
  } catch {
    setLoginMode(false);
  }
  loginMask.classList.add("open");
  loginMask.setAttribute("aria-hidden", "false");
  document.getElementById("loginPassword").value = "";
  document.getElementById("loginPassword2").value = "";
  document.getElementById("loginUsername").focus();
}

function closeLogin() {
  loginMask.classList.remove("open");
  loginMask.setAttribute("aria-hidden", "true");
}

function applySettings(settings) {
  state.settings = settings;
  const title = settings.site_title || "动态";
  document.title = title;

  const nickname = settings.nickname || "AIOVTUE-雪";
  document.getElementById("coverNickname").textContent = nickname;

  const avatarSrc = settings.avatar || defaultAvatar(nickname);
  renderCoverAvatar(avatarSrc);

  const coverSrc = settings.cover || "/hero/hero-1.mp4";
  const coverVideo = document.getElementById("coverVideo");
  const coverImage = document.getElementById("coverImage");
  const header = document.getElementById("pageHeader");
  header.classList.add("has-cover");

  if (isVideoUrl(coverSrc)) {
    coverImage.hidden = true;
    coverImage.removeAttribute("src");
    coverVideo.hidden = false;
    if (coverVideo.getAttribute("src") !== coverSrc) coverVideo.src = coverSrc;
    coverVideo.play().catch(() => {});
  } else {
    coverVideo.pause();
    coverVideo.removeAttribute("src");
    coverVideo.load();
    coverVideo.hidden = true;
    coverImage.hidden = false;
    coverImage.src = coverSrc;
    coverImage.onerror = () => {
      coverImage.hidden = true;
      coverImage.removeAttribute("src");
      coverVideo.hidden = false;
      if (coverVideo.getAttribute("src") !== "/hero/hero-1.mp4") coverVideo.src = "/hero/hero-1.mp4";
      coverVideo.play().catch(() => {});
    };
  }
}

function renderImages(images) {
  if (!images?.length) return "";
  const list = images.slice(0, 36);
  const countClass = Math.min(Math.max(list.length, 1), 9);
  const items = list
    .map(
      (src) =>
        `<button type="button" class="travel-moment__photo" data-full="${escapeHtml(src)}" aria-label="查看图片"><img src="${escapeHtml(src)}" alt="" loading="lazy" decoding="async" /></button>`,
    )
    .join("");
  return `<div class="travel-moment__photos travel-moment__photos--count-${countClass}">${items}</div>`;
}

function renderCommentForm() {
  const profile = getVisitorProfile();
  return `
    <form class="tk-submit" data-comment-form>
      <div class="moment-reply-hint" data-reply-hint hidden>
        <span>回复 <strong data-reply-name></strong></span>
        <button type="button" class="moment-reply-cancel" data-cancel-reply>取消</button>
      </div>
      <input type="hidden" name="parent_id" value="" />
      <div class="tk-row tk-row--compose">
        <div class="tk-avatar" data-nick-avatar data-avatar-mail="${escapeHtml(profile.mail)}" data-avatar-nick="${escapeHtml(profile.nick)}">
          <span class="tk-avatar-fallback">${escapeHtml((profile.nick || "访").slice(0, 1).toUpperCase() || "访")}</span>
        </div>
        <div class="tk-meta-input">
          <div class="tk-meta-input__item">
            <span class="tk-meta-input__label">昵称</span>
            <input name="nick" type="text" maxlength="40" placeholder=" " value="${escapeHtml(profile.nick)}" required autocomplete="nickname" />
          </div>
          <div class="tk-meta-input__item">
            <span class="tk-meta-input__label">邮箱</span>
            <input name="mail" type="email" maxlength="120" placeholder="填写后可收到回复通知" value="${escapeHtml(profile.mail)}" autocomplete="email" />
          </div>
          <div class="tk-meta-input__item">
            <span class="tk-meta-input__label">网站</span>
            <input name="link" type="text" maxlength="300" placeholder=" " value="${escapeHtml(profile.link)}" autocomplete="url" />
          </div>
        </div>
        <div class="tk-input">
          <textarea name="content" maxlength="1000" placeholder="分享你的想法..." required></textarea>
        </div>
      </div>
      <div class="tk-row tk-row--actions">
        <button class="btn" type="submit">发送</button>
      </div>
    </form>
  `;
}

function commentById(post, id) {
  return (post.comments || []).find((c) => c.id === id) || null;
}

function renderLikes(post) {
  const likers = post.likers || [];
  if (!likers.length && !post.like_count) return "";
  const names = likers.length
    ? likers.map((l) => `<span class="moment-like-name">${escapeHtml(l.name || "访客")}</span>`).join('<span class="moment-like-sep">，</span>')
    : `<span class="moment-like-name">${post.like_count} 人</span>`;
  return `<div class="moment-likes"><span class="moment-likes__icon" aria-hidden="true">${LIKE_ICON}</span><div class="moment-likes__names">${names}</div></div>`;
}

function renderCommentItems(post) {
  const comments = post.comments || [];
  if (!comments.length) return "";
  const list = comments
    .map((c) => {
      const nick = escapeHtml(c.author_name);
      const safeUrl = typeof c.author_url === "string" && /^https?:\/\//i.test(c.author_url.trim())
        ? c.author_url.trim()
        : "";
      const nickHtml = safeUrl
        ? `<a class="moment-comment-nick" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer nofollow">${nick}</a>`
        : `<span class="moment-comment-nick">${nick}</span>`;
      const parent = c.parent_id ? commentById(post, c.parent_id) : null;
      const replyHtml = parent
        ? `<span class="moment-comment-reply">回复</span><span class="moment-comment-nick">@${escapeHtml(parent.author_name)}</span>`
        : "";
      return `<div class="moment-comment-item" data-comment-id="${escapeHtml(c.id)}" data-reply role="button" tabindex="0">${nickHtml}${replyHtml}<span class="moment-comment-colon">：</span><span class="moment-comment-text md-inline">${renderMarkdown(c.content)}</span></div>`;
    })
    .join("");
  return `<div class="moment-comments">${list}</div>`;
}

function renderInteraction(post) {
  const likes = renderLikes(post);
  const comments = renderCommentItems(post);
  if (!likes && !comments) {
    return `<div class="moment-interaction" hidden></div>`;
  }
  return `<div class="moment-interaction">${likes}${comments}</div>`;
}

function updateInteraction(postEl, post) {
  const next = renderInteraction(post);
  const current = postEl.querySelector(".moment-interaction");
  if (current) current.outerHTML = next;
  else {
    const composer = postEl.querySelector(".moment-composer");
    if (composer) composer.insertAdjacentHTML("beforebegin", next);
  }
}

function renderPost(post) {
  const nickname = state.settings?.nickname || "AIOVTUE-雪";
  const avatar = state.settings?.avatar || defaultAvatar(nickname);
  const likedClass = post.liked ? "is-liked is-active" : "";
  const moreBtn = state.isAdmin
    ? `<button type="button" class="travel-moment__more" data-edit-post title="编辑" aria-label="编辑动态">${MORE_ICON}</button>`
    : "";
  return `
    <article class="travel-moment" data-id="${escapeHtml(post.id)}">
      ${avatarMedia(avatar, "travel-moment__avatar", nickname)}
      <div class="travel-moment__main">
        <div class="travel-moment__name-row">
          <p class="travel-moment__name">${escapeHtml(nickname)}</p>
          ${moreBtn}
        </div>
        ${post.content ? `<div class="travel-moment__text md-body">${renderMarkdown(post.content)}</div>` : ""}
        ${renderImages(post.images)}
        <div class="travel-moment__footer">
          <time class="travel-moment__meta">${formatTime(post.created_at)}</time>
          <div class="travel-moment__actions">
            <button type="button" class="moment-like-toggle ${likedClass}" data-like aria-label="点赞">
              ${LIKE_ICON}
            </button>
            <button type="button" class="moment-comment-toggle" data-comment aria-expanded="false">
              ${COMMENT_ICON}<span>评论</span>
            </button>
          </div>
        </div>
        ${renderInteraction(post)}
        <div class="moment-composer moment-comment-host" hidden></div>
      </div>
    </article>
  `;
}

async function syncNickAvatar(form) {
  const nick = form.querySelector('input[name="nick"]')?.value || "";
  const mail = form.querySelector('input[name="mail"]')?.value || "";
  const avatar = form.querySelector("[data-nick-avatar]");
  if (!avatar) return;
  const token = (form._avatarToken = (form._avatarToken || 0) + 1);
  avatar.setAttribute("data-avatar-mail", mail.trim().toLowerCase());
  avatar.setAttribute("data-avatar-nick", nick.trim());
  const url = await gravatarUrl(mail, nick, 88);
  if (token !== form._avatarToken) return;
  if (url) {
    avatar.classList.add("tk-has-avatar");
    avatar.innerHTML = `<img class="tk-avatar-img" src="${escapeHtml(url)}" alt="" width="44" height="44" decoding="async" />`;
  } else {
    avatar.classList.remove("tk-has-avatar");
    avatar.innerHTML = `<span class="tk-avatar-fallback">${escapeHtml((nick.trim().slice(0, 1) || "访").toUpperCase())}</span>`;
  }
}

async function openCommentComposer(postEl, post, { focusNick = false, replyTo = null } = {}) {
  const composer = postEl.querySelector(".moment-composer");
  const toggle = postEl.querySelector("[data-comment]");
  document.querySelectorAll(".moment-composer").forEach((el) => {
    if (el !== composer) el.setAttribute("hidden", "");
  });
  document.querySelectorAll("[data-comment]").forEach((el) => {
    el.classList.remove("is-active");
    el.setAttribute("aria-expanded", "false");
  });
  composer.removeAttribute("hidden");
  toggle?.classList.add("is-active");
  toggle?.setAttribute("aria-expanded", "true");

  if (!Array.isArray(post.comments)) {
    await ensureComments(post);
    updateInteraction(postEl, post);
  }

  if (!composer.querySelector("[data-comment-form]")) {
    composer.innerHTML = renderCommentForm();
  }

  const form = composer.querySelector("[data-comment-form]");
  if (!form) return;
  const profile = getVisitorProfile();
  const nickInput = form.querySelector('input[name="nick"]');
  const mailInput = form.querySelector('input[name="mail"]');
  const linkInput = form.querySelector('input[name="link"]');
  const contentInput = form.querySelector('textarea[name="content"]');
  if (nickInput && !nickInput.value) nickInput.value = profile.nick;
  if (mailInput && !mailInput.value) mailInput.value = profile.mail;
  if (linkInput && !linkInput.value) linkInput.value = profile.link;

  setReplyTarget(form, replyTo);
  await syncNickAvatar(form);
  if (focusNick || !profile.nick) nickInput?.focus();
  else contentInput?.focus();
}

function closeCommentComposer(postEl) {
  if (!postEl) {
    document.querySelectorAll(".moment-composer").forEach((el) => el.setAttribute("hidden", ""));
    document.querySelectorAll("[data-comment]").forEach((el) => {
      el.classList.remove("is-active");
      el.setAttribute("aria-expanded", "false");
    });
    return;
  }
  const composer = postEl.querySelector(".moment-composer");
  const toggle = postEl.querySelector("[data-comment]");
  const form = composer?.querySelector("[data-comment-form]");
  composer?.setAttribute("hidden", "");
  toggle?.classList.remove("is-active");
  toggle?.setAttribute("aria-expanded", "false");
  setReplyTarget(form, null);
}

function setReplyTarget(form, replyTo) {
  if (!form) return;
  const hint = form.querySelector("[data-reply-hint]");
  const nameEl = form.querySelector("[data-reply-name]");
  const parentInput = form.querySelector('input[name="parent_id"]');
  const contentInput = form.querySelector('textarea[name="content"]');
  if (!replyTo) {
    if (parentInput) parentInput.value = "";
    hint?.setAttribute("hidden", "");
    if (nameEl) nameEl.textContent = "";
    if (contentInput) contentInput.placeholder = "分享你的想法...";
    return;
  }
  if (parentInput) parentInput.value = replyTo.id || "";
  if (nameEl) nameEl.textContent = replyTo.author_name || "访客";
  hint?.removeAttribute("hidden");
  if (contentInput) contentInput.placeholder = `回复 ${replyTo.author_name || "访客"}...`;
}

function requireNickname(postEl, post) {
  const form = postEl?.querySelector("[data-comment-form]");
  const formNick = form?.querySelector('input[name="nick"]')?.value?.trim() || "";
  if (formNick) {
    const mail = form.querySelector('input[name="mail"]')?.value?.trim() || "";
    const link = form.querySelector('input[name="link"]')?.value?.trim() || "";
    setVisitorProfile({ nick: formNick, mail, link });
    return formNick;
  }
  const name = getDisplayName().trim();
  if (name) return name;
  openCommentComposer(postEl, post, { focusNick: true });
  toast("请先填写昵称");
  return "";
}

function normalizePost(p) {
  return {
    ...p,
    likers: p.likers || [],
    comments: Array.isArray(p.comments) ? p.comments : [],
  };
}

function feedStatusEl() {
  return feedEl.querySelector("[data-feed-status]");
}

function feedSentinelEl() {
  return feedEl.querySelector("[data-feed-sentinel]");
}

function updateFeedStatus() {
  const el = feedStatusEl();
  if (!el) return;
  if (state.feedLoading && state.posts.length) {
    el.hidden = false;
    el.textContent = "加载更多…";
    el.className = "moments-feed__status moments-feed__loading";
  } else if (!state.feedHasMore && state.posts.length) {
    el.hidden = false;
    el.textContent = state.feedTotal > FEED_PAGE_SIZE ? "已经到底了" : "";
    el.className = "moments-feed__status";
    if (!el.textContent) el.hidden = true;
  } else {
    el.hidden = true;
    el.textContent = "";
  }
}

function disconnectFeedObserver() {
  if (feedObserver) {
    feedObserver.disconnect();
    feedObserver = null;
  }
}

function observeFeedSentinel() {
  disconnectFeedObserver();
  const sentinel = feedSentinelEl();
  if (!sentinel || !state.feedHasMore) return;
  feedObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) loadFeedPage();
    },
    { root: null, rootMargin: "280px 0px", threshold: 0 },
  );
  feedObserver.observe(sentinel);
}

function renderFeed() {
  disconnectFeedObserver();
  if (!state.posts.length) {
    feedEl.innerHTML = `<p class="moments-feed__empty">还没有动态，登录后点击右上角 ＋ 发布第一条吧。</p>`;
    return;
  }
  feedEl.innerHTML = `${state.posts.map(renderPost).join("")}
    <div class="moments-feed__sentinel" data-feed-sentinel aria-hidden="true"></div>
    <p class="moments-feed__status" data-feed-status hidden></p>`;
  updateFeedStatus();
  observeFeedSentinel();
}

function appendPosts(posts) {
  if (!posts.length) {
    updateFeedStatus();
    observeFeedSentinel();
    return;
  }
  let sentinel = feedSentinelEl();
  if (!sentinel) {
    renderFeed();
    return;
  }
  sentinel.insertAdjacentHTML("beforebegin", posts.map(renderPost).join(""));
  updateFeedStatus();
  observeFeedSentinel();
}

function prependPost(post) {
  const empty = feedEl.querySelector(".moments-feed__empty");
  if (empty || !state.posts.length) {
    state.posts = [post];
    renderFeed();
    return;
  }
  state.posts.unshift(post);
  state.feedTotal += 1;
  const first = feedEl.querySelector(".travel-moment");
  const html = renderPost(post);
  if (first) first.insertAdjacentHTML("beforebegin", html);
  else renderFeed();
}

async function ensureComments(post) {
  if (Array.isArray(post.comments)) return post.comments;
  try {
    const res = await api(`/api/posts/${post.id}/comments`);
    post.comments = res.data || [];
  } catch {
    post.comments = [];
  }
  return post.comments;
}

async function loadFeedPage({ reset = false } = {}) {
  if (state.feedLoading) return;
  if (!reset && !state.feedHasMore) return;

  state.feedLoading = true;
  if (reset) {
    disconnectFeedObserver();
    feedEl.innerHTML = `<p class="moments-feed__loading">加载中…</p>`;
  } else {
    updateFeedStatus();
  }

  try {
    const offset = reset ? 0 : state.feedOffset;
    const res = await api(`/api/posts?limit=${FEED_PAGE_SIZE}&offset=${offset}`);
    const batch = (res.data || []).map(normalizePost);
    state.feedTotal = Number(res.meta?.total) || 0;

    if (reset) {
      state.posts = batch;
      state.feedOffset = batch.length;
      state.feedHasMore = state.feedOffset < state.feedTotal;
      renderFeed();
    } else {
      const seen = new Set(state.posts.map((p) => p.id));
      const fresh = batch.filter((p) => !seen.has(p.id));
      state.posts.push(...fresh);
      state.feedOffset = offset + batch.length;
      state.feedHasMore = batch.length > 0 && state.feedOffset < state.feedTotal;
      appendPosts(fresh);
    }
  } catch (err) {
    if (reset || !state.posts.length) {
      feedEl.innerHTML = `<p class="moments-feed__error">${escapeHtml(err.message)}</p>`;
      throw err;
    }
    toast(err.message);
    updateFeedStatus();
  } finally {
    state.feedLoading = false;
    if (state.posts.length) updateFeedStatus();
  }
}

async function refresh() {
  const settingsRes = await api("/api/settings");
  applySettings(settingsRes.data);
  state.feedOffset = 0;
  state.feedTotal = 0;
  state.feedHasMore = true;
  await loadFeedPage({ reset: true });
}

function setAdminFromVerify(ok) {
  if (ok) {
    setAdminUi(true);
    return;
  }
  setToken("");
  setAdminUi(false);
  closeAccountMenu();
}

function toDatetimeLocalValue(ts) {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDatetimeLocalValue(value) {
  if (!value) return NaN;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : NaN;
}

const IMAGE_MD_RE = /!\[[^\]]*]\(([^)]+)\)/g;

function contentWithImages(post) {
  let text = (post.content || "").trim();
  const seen = new Set();
  for (const m of text.matchAll(IMAGE_MD_RE)) {
    const u = String(m[1] || "").trim();
    if (u) seen.add(u);
  }
  const extras = (post.images || []).filter((u) => u && !seen.has(u));
  if (extras.length) {
    text = [text, ...extras.map((u) => `![](${u})`)].filter(Boolean).join("\n");
  }
  return text;
}

function splitContentAndImages(raw) {
  const images = [];
  const content = String(raw || "")
    .replace(IMAGE_MD_RE, (_full, url) => {
      const u = String(url || "").trim();
      if (u) images.push(u);
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { content, images: images.slice(0, 9) };
}

function setAdminUi(isAdmin) {
  const prev = state.isAdmin;
  state.isAdmin = Boolean(isAdmin);
  document.getElementById("composeBtn").hidden = !state.isAdmin;
  const loginItem = document.getElementById("loginMenuBtn");
  const settingsItem = document.getElementById("settingsMenuItem");
  const logoutItem = document.getElementById("logoutBtn");
  if (loginItem) loginItem.hidden = state.isAdmin;
  if (settingsItem) settingsItem.hidden = !state.isAdmin;
  if (logoutItem) logoutItem.hidden = !state.isAdmin;
  if (prev !== state.isAdmin && state.posts.length) renderFeed();
}

function openCompose() {
  document.getElementById("composeTime").value = toDatetimeLocalValue(Date.now());
  composeMask.classList.add("open");
  composeMask.setAttribute("aria-hidden", "false");
  document.getElementById("composeContent").focus();
}

function closeCompose() {
  composeMask.classList.remove("open");
  composeMask.setAttribute("aria-hidden", "true");
}

function renderEditPostPreviewHtml(raw) {
  const { content, images } = splitContentAndImages(raw);
  const parts = [];
  if (content) parts.push(`<div class="travel-moment__text md-body">${renderMarkdown(content)}</div>`);
  if (images.length) {
    const countClass = Math.min(Math.max(images.length, 1), 9);
    const items = images
      .map((src) => {
        if (isVideoUrl(src)) {
          return `<div class="travel-moment__photo"><video src="${escapeHtml(src)}" muted playsinline controls preload="metadata"></video></div>`;
        }
        return `<div class="travel-moment__photo"><img src="${escapeHtml(src)}" alt="" loading="lazy" decoding="async" /></div>`;
      })
      .join("");
    parts.push(`<div class="travel-moment__photos travel-moment__photos--count-${countClass}">${items}</div>`);
  }
  if (!parts.length) return `<p class="edit-post-preview__empty">暂无内容</p>`;
  return parts.join("");
}

function setEditPostPreviewMode(preview) {
  const body = document.getElementById("editPostBody");
  const textarea = document.getElementById("editPostContent");
  const previewEl = document.getElementById("editPostPreview");
  const toggle = document.getElementById("editPostPreviewToggle");
  if (!body || !textarea || !previewEl || !toggle) return;
  if (preview) {
    previewEl.innerHTML = renderEditPostPreviewHtml(textarea.value);
    body.classList.add("is-preview");
    previewEl.setAttribute("aria-hidden", "false");
    toggle.textContent = "编辑";
    toggle.setAttribute("aria-pressed", "true");
  } else {
    body.classList.remove("is-preview");
    previewEl.setAttribute("aria-hidden", "true");
    previewEl.innerHTML = "";
    toggle.textContent = "预览";
    toggle.setAttribute("aria-pressed", "false");
  }
}

function openEditPost(post) {
  if (!post || !state.isAdmin) return;
  document.getElementById("editPostId").value = post.id;
  document.getElementById("editPostContent").value = contentWithImages(post);
  document.getElementById("editPostTime").value = toDatetimeLocalValue(post.created_at);
  setEditPostPreviewMode(false);
  editPostMask.classList.add("open");
  editPostMask.setAttribute("aria-hidden", "false");
  document.getElementById("editPostContent").focus();
}

function closeEditPost() {
  setEditPostPreviewMode(false);
  editPostMask.classList.remove("open");
  editPostMask.setAttribute("aria-hidden", "true");
}

function replacePostInFeed(post) {
  const idx = state.posts.findIndex((p) => p.id === post.id);
  if (idx >= 0) {
    const prev = state.posts[idx];
    state.posts[idx] = normalizePost({
      ...prev,
      ...post,
      comments: prev.comments,
      likers: post.likers || prev.likers || [],
      liked: typeof post.liked === "boolean" ? post.liked : prev.liked,
    });
  }
  const el = feedEl.querySelector(`.travel-moment[data-id="${CSS.escape(post.id)}"]`);
  if (!el) {
    renderFeed();
    return;
  }
  const next = state.posts.find((p) => p.id === post.id);
  el.outerHTML = renderPost(next);
}

function removePostFromFeed(postId) {
  state.posts = state.posts.filter((p) => p.id !== postId);
  state.feedTotal = Math.max(0, (state.feedTotal || 0) - 1);
  const el = feedEl.querySelector(`.travel-moment[data-id="${CSS.escape(postId)}"]`);
  if (el) el.remove();
  if (!state.posts.length) renderFeed();
  else updateFeedStatus();
}

accountBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (accountDropdown.hidden) openAccountMenu();
  else closeAccountMenu();
});

function syncThemeToggleLabel() {
  const btn = document.getElementById("themeToggleBtn");
  if (btn) btn.textContent = getTheme() === "dark" ? "浅色模式" : "深色模式";
}

document.getElementById("themeToggleBtn")?.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleTheme();
  syncThemeToggleLabel();
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  setToken("");
  setAdminUi(false);
  closeEditPost();
  closeAccountMenu();
  toast("已退出登录");
});

document.getElementById("loginCancel").addEventListener("click", closeLogin);
loginMask.addEventListener("click", (e) => {
  if (e.target === loginMask) closeLogin();
});

async function submitLogin() {
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value;
  if (!username) {
    toast("请输入账号");
    document.getElementById("loginUsername").focus();
    return;
  }
  if (!password) {
    toast("请输入密码");
    return;
  }
  if (setupMode) {
    const again = document.getElementById("loginPassword2").value;
    if (password !== again) {
      toast("两次密码不一致");
      return;
    }
  }
  try {
    const path = setupMode ? "/api/auth/setup" : "/api/auth/login";
    const res = await api(path, {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    setToken(res.token);
    setAdminUi(true);
    closeLogin();
    toast(setupMode ? "初始化成功" : "登录成功");
  } catch (err) {
    if (needsSetup(err)) {
      setLoginMode(true);
      toast("请先设置管理员账号（不会清空动态）");
      return;
    }
    toast(err.message);
  }
}

document.getElementById("loginSubmit").addEventListener("click", submitLogin);
document.getElementById("loginPassword").addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitLogin();
});
document.getElementById("loginPassword2").addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitLogin();
});
document.getElementById("loginUsername").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    if (setupMode) document.getElementById("loginPassword").focus();
    else submitLogin();
  }
});

document.addEventListener("click", (e) => {
  if (!e.target.closest("#accountMenu")) closeAccountMenu();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeAccountMenu();
    closeLogin();
    closeEditPost();
    closeCompose();
  }
});

feedEl.addEventListener("click", async (e) => {
  const postEl = e.target.closest(".travel-moment");
  if (!postEl) return;
  const postId = postEl.dataset.id;
  const post = state.posts.find((p) => p.id === postId);
  if (!post) return;

  if (e.target.closest("[data-edit-post]")) {
    e.stopPropagation();
    closeCompose();
    closeCommentComposer(postEl);
    openEditPost(post);
    return;
  }

  const photoBtn = e.target.closest(".travel-moment__photo");
  if (photoBtn) {
    document.getElementById("lightboxImg").src = photoBtn.dataset.full;
    lightbox.classList.add("open");
    return;
  }

  if (e.target.closest("[data-like]")) {
    const nick = requireNickname(postEl, post);
    if (!nick) return;
    try {
      const path = `/api/posts/${postId}/likes`;
      const res = post.liked
        ? await api(path, { method: "DELETE", body: JSON.stringify({}) })
        : await api(path, { method: "POST", body: JSON.stringify({ author_name: nick }) });
      post.liked = res.liked;
      post.like_count = res.like_count;
      post.likers = res.likers || [];
      updateInteraction(postEl, post);
      const likeBtn = postEl.querySelector("[data-like]");
      likeBtn.classList.toggle("is-liked", post.liked);
      likeBtn.classList.toggle("is-active", post.liked);
      likeBtn.innerHTML = LIKE_ICON;
      closeCommentComposer(postEl);
    } catch (err) {
      toast(err.message);
    }
    return;
  }

  if (e.target.closest("[data-comment]")) {
    const composer = postEl.querySelector(".moment-composer");
    const open = composer.hasAttribute("hidden");
    if (!open) {
      closeCommentComposer(postEl);
      return;
    }
    await openCommentComposer(postEl, post);
    return;
  }

  if (e.target.closest("[data-cancel-reply]")) {
    const form = postEl.querySelector("[data-comment-form]");
    setReplyTarget(form, null);
    form?.querySelector('textarea[name="content"]')?.focus();
    return;
  }

  const replyItem = e.target.closest("[data-reply]");
  if (replyItem && !e.target.closest("a")) {
    const commentId = replyItem.getAttribute("data-comment-id");
    const target = commentById(post, commentId);
    if (!target) return;
    await openCommentComposer(postEl, post, { replyTo: target });
    return;
  }
});

feedEl.addEventListener("input", (e) => {
  const meta = e.target.closest('input[name="nick"], input[name="mail"], input[name="link"]');
  if (!meta) return;
  const form = meta.closest("[data-comment-form]");
  if (!form) return;

  const nick = form.querySelector('input[name="nick"]')?.value?.trim() || "";
  const mail = form.querySelector('input[name="mail"]')?.value?.trim() || "";
  const link = form.querySelector('input[name="link"]')?.value?.trim() || "";
  if (nick || mail || link) setVisitorProfile({ nick, mail, link });

  if (meta.matches('input[name="nick"], input[name="mail"]')) {
    clearTimeout(form._avatarTimer);
    form._avatarTimer = setTimeout(() => {
      syncNickAvatar(form);
    }, 180);
  }
});

feedEl.addEventListener("submit", async (e) => {
  const form = e.target.closest("[data-comment-form]");
  if (!form) return;
  e.preventDefault();
  const postEl = form.closest(".travel-moment");
  const postId = postEl.dataset.id;
  const post = state.posts.find((p) => p.id === postId);
  const fd = new FormData(form);
  const nick = String(fd.get("nick") || "").trim();
  const mail = String(fd.get("mail") || "").trim();
  const link = String(fd.get("link") || "").trim();
  const content = String(fd.get("content") || "").trim();
  const parentId = String(fd.get("parent_id") || "").trim();
  if (!nick) {
    toast("请填写昵称");
    form.querySelector('input[name="nick"]')?.focus();
    return;
  }
  if (!content) {
    toast("请填写评论内容");
    form.querySelector('textarea[name="content"]')?.focus();
    return;
  }
  setVisitorProfile({ nick, mail, link });
  try {
    const res = await api(`/api/posts/${postId}/comments`, {
      method: "POST",
      body: JSON.stringify({
        author_name: nick,
        author_email: mail,
        author_url: link,
        content,
        parent_id: parentId || undefined,
      }),
    });
    post.comments = [...(post.comments || []), res.data];
    post.comment_count = (post.comment_count || 0) + 1;
    form.querySelector('textarea[name="content"]').value = "";
    const nickInput = form.querySelector('input[name="nick"]');
    const mailInput = form.querySelector('input[name="mail"]');
    const linkInput = form.querySelector('input[name="link"]');
    if (nickInput) nickInput.value = nick;
    if (mailInput) mailInput.value = mail;
    if (linkInput) linkInput.value = link;
    setReplyTarget(form, null);
    syncNickAvatar(form);
    updateInteraction(postEl, post);
    closeCommentComposer(postEl);
  } catch (err) {
    toast(err.message);
  }
});

document.getElementById("composeBtn").addEventListener("click", openCompose);
document.getElementById("composeCancel").addEventListener("click", closeCompose);
composeMask.addEventListener("click", (e) => {
  if (e.target === composeMask) closeCompose();
});

document.getElementById("editPostCancel").addEventListener("click", closeEditPost);
document.getElementById("editPostPreviewToggle").addEventListener("click", () => {
  const body = document.getElementById("editPostBody");
  setEditPostPreviewMode(!body?.classList.contains("is-preview"));
});
editPostMask.addEventListener("click", (e) => {
  if (e.target === editPostMask) closeEditPost();
});

document.getElementById("editPostSave").addEventListener("click", async () => {
  const id = document.getElementById("editPostId").value;
  const { content, images } = splitContentAndImages(document.getElementById("editPostContent").value);
  const createdAt = fromDatetimeLocalValue(document.getElementById("editPostTime").value);
  if (!content && !images.length) {
    toast("内容和图片不能同时为空");
    return;
  }
  try {
    const body = { content, images };
    if (Number.isFinite(createdAt)) body.created_at = createdAt;
    const res = await api(`/api/posts/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    replacePostInFeed(res.data);
    closeEditPost();
    toast("已保存");
  } catch (err) {
    toast(err.message);
  }
});

document.getElementById("editPostDelete").addEventListener("click", async () => {
  const id = document.getElementById("editPostId").value;
  if (!confirm("确定删除这条动态？相关评论和点赞也会删除。")) return;
  try {
    await api(`/api/posts/${id}`, { method: "DELETE" });
    removePostFromFeed(id);
    closeEditPost();
    toast("已删除动态");
  } catch (err) {
    toast(err.message);
  }
});

document.getElementById("composeSubmit").addEventListener("click", async () => {
  const { content, images } = splitContentAndImages(document.getElementById("composeContent").value);
  const createdAt = fromDatetimeLocalValue(document.getElementById("composeTime").value);
  if (!content && !images.length) {
    toast("内容和图片不能同时为空");
    return;
  }
  try {
    const body = { content, images };
    if (Number.isFinite(createdAt)) body.created_at = createdAt;
    const res = await api("/api/posts", {
      method: "POST",
      body: JSON.stringify(body),
    });
    prependPost(normalizePost({ ...res.data, comments: [], likers: [], liked: false }));
    closeCompose();
    document.getElementById("composeContent").value = "";
    document.getElementById("composeTime").value = toDatetimeLocalValue(Date.now());
    toast("发布成功");
  } catch (err) {
    toast(err.message);
  }
});

lightbox.addEventListener("click", () => lightbox.classList.remove("open"));

initDesktopScrollDamping();
initTheme();
syncThemeToggleLabel();

(async function init() {
  try {
    const token = getToken();
    const authTask = token
      ? api("/api/auth/verify")
          .then((res) => ({ kind: "verify", ok: true, res }))
          .catch(() => ({ kind: "verify", ok: false, res: null }))
      : api("/api/auth/status")
          .then((res) => ({ kind: "status", ok: true, res }))
          .catch(() => ({ kind: "status", ok: false, res: null }));
    const [auth, settingsRes] = await Promise.all([authTask, api("/api/settings")]);
    applySettings(settingsRes.data);
    if (auth.kind === "verify") setAdminFromVerify(auth.ok);
    else setAdminUi(false);
    state.feedOffset = 0;
    state.feedTotal = 0;
    state.feedHasMore = true;
    await loadFeedPage({ reset: true });
    if (auth.kind === "status" && !auth.res?.data?.initialized) await openLogin();
  } catch (err) {
    feedEl.innerHTML = `<p class="moments-feed__error">${escapeHtml(err.message)}</p>`;
  }
})();
