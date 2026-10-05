import { api, escapeHtml, fetchAuthStatus, formatDateTime, getToken, isVideoUrl, needsSetup, setToken, toast } from "./api.js";
import { renderMarkdown } from "./markdown.js";
import { initTheme, toggleTheme, getTheme } from "./theme.js";

const fields = [
  "site_title",
  "nickname",
  "avatar",
  "cover",
  "site_description",
  "notify_enabled",
  "admin_email",
  "mail_from",
  "mail_from_name",
  "site_url",
  "cors_origins",
  "page_likes_enabled",
  "webdav_url",
  "webdav_username",
  "webdav_folder",
  "webdav_interval",
  "webdav_enabled",
];
const gate = document.getElementById("gate");
const panel = document.getElementById("panel");
const importStatus = document.getElementById("importStatus");
const editPostMask = document.getElementById("editPostMask");
const engageMask = document.getElementById("engageMask");

/** @type {Map<string, any>} */
const postsCache = new Map();

const POSTS_PAGE_SIZE = 12;
let postsPage = 1;
let postsTotal = 0;
let postsSelectMode = false;
/** @type {Set<string>} */
const selectedPostIds = new Set();

/** @type {{ type: "" | "comments" | "likes", postId: string, postExcerpt: string }} */
const engageState = { type: "", postId: "", postExcerpt: "" };

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

/** Merge stored image URLs into markdown body for editing. */
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

/** Split markdown images out of body (same shape as API images field). */
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

function openEditPost(post) {
  if (!post) return;
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

function renderEditPostPreviewHtml(raw) {
  const { content, images } = splitContentAndImages(raw);
  const parts = [];
  if (content) {
    parts.push(`<div class="travel-moment__text md-body">${renderMarkdown(content)}</div>`);
  }
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
  if (!parts.length) {
    return `<p class="edit-post-preview__empty">暂无内容</p>`;
  }
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

function renderMediaPreview(el, url, fallback) {
  const src = (url || fallback || "").trim();
  if (!src) {
    el.innerHTML = "";
    return;
  }
  const safe = escapeHtml(src);
  if (isVideoUrl(src)) {
    el.innerHTML = `<video src="${safe}" muted playsinline autoplay loop preload="metadata"></video>`;
  } else {
    el.innerHTML = `<img src="${safe}" alt="" />`;
  }
}

function syncMediaPreviews() {
  const avatarValue = document.getElementById("avatar")?.value || "/img/toux.webp";
  renderMediaPreview(
    document.getElementById("avatarPreview"),
    avatarValue,
    "/img/toux.webp",
  );
  renderMediaPreview(
    document.getElementById("coverPreview"),
    document.getElementById("cover")?.value,
    "/hero/hero-1.mp4",
  );
  renderMediaPreview(document.getElementById("sidebarAvatar"), avatarValue, "/img/toux.webp");
  const sub = document.getElementById("sidebarSubtitle");
  const nick = document.getElementById("nickname")?.value?.trim();
  if (sub) sub.textContent = nick || "AIOVTUE-memos";
}

function fillForm(data, meta) {
  if (!data.mail_from) {
    data.mail_from = data.mail_from_resend || data.mail_from_cf || "";
  }
  for (const key of fields) {
    const el = document.getElementById(key);
    if (!el) continue;
    if (key === "cover" && !data[key]) el.value = "/hero/hero-1.mp4";
    else if (key === "avatar" && !data[key]) el.value = "/img/toux.webp";
    else if (key === "notify_enabled") el.checked = data[key] !== "0";
    else if (key === "page_likes_enabled") el.checked = data[key] === "1";
    else if (key === "webdav_enabled") el.checked = data[key] === "1";
    else if (key === "webdav_interval") el.value = data[key] === "weekly" || data[key] === "monthly" ? data[key] : "daily";
    else if (key === "webdav_folder" && !data[key]) el.value = "AIOVTUE-memos";
    else el.value = data[key] || "";
  }
  const keyInput = document.getElementById("resend_api_key");
  if (keyInput) {
    keyInput.value = meta?.resend_configured ? "***********" : "";
    keyInput.placeholder = "re_xxxxxxxx";
  }
  const clearBtn = document.getElementById("clearResendKeyBtn");
  if (clearBtn) clearBtn.disabled = !meta?.resend_configured;
  const davPass = document.getElementById("webdav_password");
  if (davPass) {
    davPass.value = meta?.webdav_password_configured ? "***********" : "";
  }
  const clearDav = document.getElementById("clearWebdavPasswordBtn");
  if (clearDav) clearDav.disabled = !meta?.webdav_password_configured;
  fillWebdavStatus(data);
  syncPageLikesNav();
  syncMediaPreviews();
}

function readForm() {
  const body = {};
  for (const key of fields) {
    const el = document.getElementById(key);
    if (!el) continue;
    if (el.type === "checkbox") body[key] = el.checked ? "1" : "0";
    else body[key] = el.value.trim();
  }
  if (!body.cover) body.cover = "/hero/hero-1.mp4";
  if (!body.avatar) body.avatar = "/img/toux.webp";
  const keyVal = document.getElementById("resend_api_key")?.value?.trim() || "";
  if (keyVal && !/^\*+$/.test(keyVal)) body.resend_api_key = keyVal;
  const davPass = document.getElementById("webdav_password")?.value?.trim() || "";
  if (davPass && !/^\*+$/.test(davPass)) body.webdav_password = davPass;
  return body;
}

function fillWebdavStatus(data = {}) {
  const el = document.getElementById("webdavStatus");
  if (!el) return;
  const err = String(data.webdav_last_error || "").trim();
  const last = Number(data.webdav_last_backup_at || 0);
  if (err) {
    el.textContent = `上次失败：${err}`;
    return;
  }
  if (Number.isFinite(last) && last > 0) {
    el.textContent = `上次备份：${formatDateTime(last)}`;
    return;
  }
  el.textContent = "尚未备份";
}

function switchTab(tab) {
  const titles = {
    site: "基本设置",
    posts: "动态管理",
    comments: "评论管理",
    likes: "点赞管理",
    "page-likes": "页面点赞",
  };
  document.querySelectorAll(".settings-nav__item").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.tab === tab);
  });
  document.querySelectorAll(".settings-pane").forEach((pane) => {
    pane.hidden = pane.dataset.pane !== tab;
  });
  const titleEl = document.getElementById("settingsPaneTitle");
  if (titleEl) titleEl.textContent = titles[tab] || "站点设置";
  const saveBtn = document.getElementById("saveBtn");
  if (saveBtn) saveBtn.hidden = tab !== "site";
  closeSettingsSidebar();
  if (tab === "posts") loadPosts();
  if (tab === "comments") loadCommentPosts();
  if (tab === "likes") loadLikePosts();
  if (tab === "page-likes") loadPageLikes();
}

function openSettingsSidebar() {
  const shell = document.getElementById("panel");
  const mask = document.getElementById("settingsSidebarMask");
  const btn = document.getElementById("settingsMenuBtn");
  if (!shell || shell.hidden) return;
  shell.classList.add("is-sidebar-open");
  if (mask) mask.hidden = false;
  if (btn) btn.setAttribute("aria-expanded", "true");
}

function closeSettingsSidebar() {
  const shell = document.getElementById("panel");
  const mask = document.getElementById("settingsSidebarMask");
  const btn = document.getElementById("settingsMenuBtn");
  if (shell) shell.classList.remove("is-sidebar-open");
  if (mask) mask.hidden = true;
  if (btn) btn.setAttribute("aria-expanded", "false");
}

function toggleSettingsSidebar() {
  const shell = document.getElementById("panel");
  if (!shell || shell.hidden) return;
  if (shell.classList.contains("is-sidebar-open")) closeSettingsSidebar();
  else openSettingsSidebar();
}

function excerpt(text, max = 120) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

function renderPostRows(posts) {
  return posts
    .map((p) => {
      const selected = selectedPostIds.has(p.id);
      if (postsSelectMode) {
        return `<article class="manage-row manage-row--select${selected ? " is-selected" : ""}" data-post-id="${escapeHtml(p.id)}" role="checkbox" aria-checked="${selected ? "true" : "false"}" tabindex="0">
          <span class="manage-row__check" aria-hidden="true"></span>
          <p class="manage-row__text">${escapeHtml(excerpt(p.content, 64) || "（无文字）")}</p>
          <time class="manage-row__time">${formatDateTime(p.created_at)}</time>
        </article>`;
      }
      return `<article class="manage-row" data-post-id="${escapeHtml(p.id)}" role="button" tabindex="0">
        <p class="manage-row__text">${escapeHtml(excerpt(p.content, 64) || "（无文字）")}</p>
        <time class="manage-row__time">${formatDateTime(p.created_at)}</time>
      </article>`;
    })
    .join("");
}

function updatePostsSelectUi() {
  const selectBtn = document.getElementById("selectPostsBtn");
  const deleteBtn = document.getElementById("deleteSelectedPostsBtn");
  if (!selectBtn || !deleteBtn) return;
  selectBtn.textContent = postsSelectMode ? "取消" : "选择";
  selectBtn.setAttribute("aria-pressed", postsSelectMode ? "true" : "false");
  if (!postsSelectMode) {
    deleteBtn.hidden = true;
    deleteBtn.disabled = true;
    deleteBtn.textContent = "删除";
    return;
  }
  const count = selectedPostIds.size;
  deleteBtn.hidden = false;
  deleteBtn.disabled = count === 0;
  deleteBtn.textContent = count > 0 ? `删除(${count})` : "删除";
}

function setPostsSelectMode(on) {
  postsSelectMode = Boolean(on);
  if (!postsSelectMode) selectedPostIds.clear();
  updatePostsSelectUi();
  const list = document.getElementById("postsList");
  const posts = [...postsCache.values()];
  if (!posts.length) return;
  list.className = "manage-list manage-list--compact";
  list.innerHTML = renderPostRows(posts);
}

function togglePostSelection(postId) {
  if (!postId) return;
  if (selectedPostIds.has(postId)) selectedPostIds.delete(postId);
  else selectedPostIds.add(postId);
  const row = document.querySelector(`.manage-row[data-post-id="${CSS.escape(postId)}"]`);
  if (row) {
    const selected = selectedPostIds.has(postId);
    row.classList.toggle("is-selected", selected);
    row.setAttribute("aria-checked", selected ? "true" : "false");
  }
  updatePostsSelectUi();
}

async function loadPosts(page = postsPage) {
  const list = document.getElementById("postsList");
  const meta = document.getElementById("postsMeta");
  const pager = document.getElementById("postsPager");
  meta.textContent = "加载中…";
  try {
    let nextPage = Math.max(1, Number(page) || 1);
    const offset = (nextPage - 1) * POSTS_PAGE_SIZE;
    const res = await api(`/api/posts?limit=${POSTS_PAGE_SIZE}&offset=${offset}`);
    const posts = res.data || [];
    postsTotal = Number(res.meta?.total) || 0;
    const pages = Math.max(1, Math.ceil(postsTotal / POSTS_PAGE_SIZE) || 1);
    if (postsTotal > 0 && nextPage > pages) {
      return loadPosts(pages);
    }
    postsPage = nextPage;
    postsCache.clear();
    for (const p of posts) postsCache.set(p.id, p);
    meta.textContent =
      postsTotal > POSTS_PAGE_SIZE
        ? `共 ${postsTotal} 条动态 · 第 ${postsPage} / ${pages} 页`
        : `共 ${postsTotal} 条动态`;
    if (!posts.length) {
      list.className = "manage-list manage-list--compact";
      list.innerHTML = `<p class="manage-empty">暂无动态</p>`;
      if (pager) {
        pager.hidden = true;
        pager.innerHTML = "";
      }
      updatePostsSelectUi();
      return;
    }
    list.className = "manage-list manage-list--compact";
    list.innerHTML = renderPostRows(posts);
    renderPostsPager();
    updatePostsSelectUi();
  } catch (err) {
    meta.textContent = err.message;
    list.innerHTML = "";
    if (pager) {
      pager.hidden = true;
      pager.innerHTML = "";
    }
  }
}

function postsPageWindow(current, pages) {
  if (pages <= 7) {
    return Array.from({ length: pages }, (_, i) => i + 1);
  }
  const set = new Set([1, pages, current, current - 1, current + 1, current - 2, current + 2]);
  const list = [...set].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < list.length; i++) {
    if (i > 0 && list[i] - list[i - 1] > 1) out.push("…");
    out.push(list[i]);
  }
  return out;
}

function renderPostsPager() {
  const pager = document.getElementById("postsPager");
  if (!pager) return;
  const pages = Math.max(1, Math.ceil(postsTotal / POSTS_PAGE_SIZE) || 1);
  if (postsTotal <= POSTS_PAGE_SIZE) {
    pager.hidden = true;
    pager.innerHTML = "";
    return;
  }
  const current = Math.min(Math.max(1, postsPage), pages);
  const items = postsPageWindow(current, pages)
    .map((item) => {
      if (item === "…") return `<span class="manage-pager__ellipsis">…</span>`;
      const active = item === current ? " is-active" : "";
      return `<button type="button" class="manage-pager__btn${active}" data-posts-page="${item}" ${
        item === current ? 'aria-current="page"' : ""
      }>${item}</button>`;
    })
    .join("");
  pager.hidden = false;
  pager.innerHTML = `
    <button type="button" class="manage-pager__btn" data-posts-page="prev" ${current <= 1 ? "disabled" : ""} aria-label="上一页">上一页</button>
    ${items}
    <button type="button" class="manage-pager__btn" data-posts-page="next" ${current >= pages ? "disabled" : ""} aria-label="下一页">下一页</button>
  `;
}

function closeEngageDialog() {
  engageState.type = "";
  engageState.postId = "";
  engageState.postExcerpt = "";
  engageMask.classList.remove("open");
  engageMask.setAttribute("aria-hidden", "true");
  document.getElementById("engageList").innerHTML = "";
}

async function openEngageDialog(type, postId, postExcerpt = "") {
  engageState.type = type;
  engageState.postId = postId;
  engageState.postExcerpt = postExcerpt || "";
  document.getElementById("engageTitle").textContent = type === "likes" ? "管理点赞" : "管理评论";
  document.getElementById("engagePostMeta").textContent = postExcerpt
    ? `动态：${postExcerpt}`
    : "加载中…";
  document.getElementById("engageList").innerHTML = `<p class="manage-empty">加载中…</p>`;
  engageMask.classList.add("open");
  engageMask.setAttribute("aria-hidden", "false");
  await refreshEngageDialog();
}

async function refreshEngageDialog() {
  const list = document.getElementById("engageList");
  const meta = document.getElementById("engagePostMeta");
  const { type, postId } = engageState;
  if (!type || !postId) return;
  try {
    if (type === "comments") {
      const res = await api(`/api/admin/comments?post_id=${encodeURIComponent(postId)}&limit=200`);
      const rows = res.data || [];
      if (rows[0]?.post_excerpt) {
        engageState.postExcerpt = excerpt(rows[0].post_excerpt, 64) || "（无文字）";
      }
      const postLabel = engageState.postExcerpt || "（无文字）";
      meta.textContent = `动态：${postLabel} · ${res.meta?.total ?? rows.length} 条评论`;
      if (!rows.length) {
        list.innerHTML = `<p class="manage-empty">该动态暂无评论</p>`;
        return;
      }
      list.innerHTML = rows
        .map((c) => {
          const reply = c.parent_id ? " 回复" : "";
          const nick = escapeHtml(c.author_name || "访客");
          const body = escapeHtml(excerpt(c.content, 64) || "（空）");
          return `<article class="manage-row manage-row--action" data-comment-id="${escapeHtml(c.id)}">
            <div class="manage-row__main">
              <p class="manage-row__text"><span class="manage-row__nick">${nick}</span>${reply}：${body}</p>
            </div>
            <time class="manage-row__time">${formatDateTime(c.created_at)}</time>
            <button type="button" class="manage-row__del" data-del-comment="${escapeHtml(c.id)}">删除</button>
          </article>`;
        })
        .join("");
      return;
    }

    const res = await api(`/api/admin/likes?post_id=${encodeURIComponent(postId)}&limit=200`);
    const rows = res.data || [];
    if (rows[0]?.post_excerpt) {
      engageState.postExcerpt = excerpt(rows[0].post_excerpt, 64) || "（无文字）";
    }
    const postLabel = engageState.postExcerpt || "（无文字）";
    meta.textContent = `动态：${postLabel} · ${res.meta?.total ?? rows.length} 个赞`;
    if (!rows.length) {
      list.innerHTML = `<p class="manage-empty">该动态暂无点赞</p>`;
      return;
    }
    list.innerHTML = rows
      .map((l) => {
        const nick = escapeHtml(l.author_name || "访客");
        return `<article class="manage-row manage-row--action" data-like-id="${escapeHtml(l.id)}">
          <div class="manage-row__main">
            <p class="manage-row__text"><span class="manage-row__nick">${nick}</span></p>
          </div>
          <time class="manage-row__time">${formatDateTime(l.created_at)}</time>
          <button type="button" class="manage-row__del" data-del-like="${escapeHtml(l.id)}">删除</button>
        </article>`;
      })
      .join("");
  } catch (err) {
    meta.textContent = err.message;
    list.innerHTML = "";
  }
}

async function loadCommentPosts() {
  const list = document.getElementById("commentsList");
  const meta = document.getElementById("commentsMeta");
  meta.textContent = "加载中…";
  try {
    const res = await api("/api/admin/comment-posts?limit=100");
    const rows = res.data || [];
    meta.textContent = `共 ${res.meta?.total ?? rows.length} 条有评论的动态`;
    list.className = "manage-list manage-list--compact";
    if (!rows.length) {
      list.innerHTML = `<p class="manage-empty">暂无评论</p>`;
      return;
    }
    list.innerHTML = rows
      .map((p) => {
        return `<article class="manage-row manage-row--engage" data-comment-post-id="${escapeHtml(p.id)}" data-post-excerpt="${escapeHtml(excerpt(p.content, 64) || "（无文字）")}" role="button" tabindex="0">
          <p class="manage-row__text">${escapeHtml(excerpt(p.content, 64) || "（无文字）")}</p>
          <span class="manage-row__stats">${Number(p.comment_count) || 0} 条评论</span>
          <time class="manage-row__time">${formatDateTime(p.last_at || p.created_at)}</time>
        </article>`;
      })
      .join("");
  } catch (err) {
    meta.textContent = err.message;
    list.innerHTML = "";
  }
}

async function loadLikePosts() {
  const list = document.getElementById("likesList");
  const meta = document.getElementById("likesMeta");
  meta.textContent = "加载中…";
  try {
    const res = await api("/api/admin/like-posts?limit=100");
    const rows = res.data || [];
    meta.textContent = `共 ${res.meta?.total ?? rows.length} 条有点赞的动态`;
    list.className = "manage-list manage-list--compact";
    if (!rows.length) {
      list.innerHTML = `<p class="manage-empty">暂无点赞</p>`;
      return;
    }
    list.innerHTML = rows
      .map((p) => {
        return `<article class="manage-row manage-row--engage" data-like-post-id="${escapeHtml(p.id)}" data-post-excerpt="${escapeHtml(excerpt(p.content, 64) || "（无文字）")}" role="button" tabindex="0">
          <p class="manage-row__text">${escapeHtml(excerpt(p.content, 64) || "（无文字）")}</p>
          <span class="manage-row__stats">${Number(p.like_count) || 0} 个赞</span>
          <time class="manage-row__time">${formatDateTime(p.last_at || p.created_at)}</time>
        </article>`;
      })
      .join("");
  } catch (err) {
    meta.textContent = err.message;
    list.innerHTML = "";
  }
}

function pageLikesEnabled() {
  return Boolean(document.getElementById("page_likes_enabled")?.checked);
}

function syncPageLikesNav() {
  const nav = document.querySelector('.settings-nav__item[data-tab="page-likes"]');
  const enabled = pageLikesEnabled();
  if (nav) nav.hidden = !enabled;
  const pane = document.querySelector('.settings-pane[data-pane="page-likes"]');
  if (!enabled && pane && !pane.hidden) switchTab("site");
}

async function loadPageLikes() {
  const list = document.getElementById("pageLikesList");
  const meta = document.getElementById("pageLikesMeta");
  if (!list || !meta) return;
  if (!pageLikesEnabled()) {
    meta.textContent = "未启用文章点赞";
    list.innerHTML = "";
    return;
  }
  meta.textContent = "加载中…";
  try {
    const res = await api("/api/admin/page-likes?limit=200");
    const rows = res.data || [];
    meta.textContent = `共 ${res.meta?.total ?? rows.length} 个页面有点赞`;
    list.className = "manage-list manage-list--compact";
    if (!rows.length) {
      list.innerHTML = `<p class="manage-empty">暂无页面点赞</p>`;
      return;
    }
    list.innerHTML = rows
      .map((p) => {
        return `<article class="manage-row manage-row--engage manage-row--action">
          <p class="manage-row__text">${escapeHtml(p.path || "/")}</p>
          <span class="manage-row__stats">${Number(p.like_count) || 0} 个赞</span>
          <time class="manage-row__time">${formatDateTime(p.updated_at)}</time>
        </article>`;
      })
      .join("");
  } catch (err) {
    meta.textContent = err.message;
    list.innerHTML = "";
  }
}

async function enterPanel(verify = null) {
  const settingsP = api("/api/settings");
  const verifyP = verify?.data?.username
    ? Promise.resolve(verify)
    : api("/api/auth/verify").catch(() => null);
  const [res, verified] = await Promise.all([settingsP, verifyP]);
  fillForm(res.data, res.meta);
  const userEl = document.getElementById("account_username");
  if (userEl && verified?.data?.username) userEl.value = verified.data.username;
  gate.hidden = true;
  panel.hidden = false;
  switchTab("site");
}

let setupMode = false;

function setGateMode(isSetup) {
  setupMode = Boolean(isSetup);
  const title = document.getElementById("gateTitle");
  const hint = document.getElementById("gateHint");
  const btn = document.getElementById("loginBtn");
  const wrap = document.getElementById("password2Field");
  const pass = document.getElementById("password");
  if (title) title.textContent = setupMode ? "初始化管理员账号" : "管理登录";
  if (hint) {
    hint.textContent = setupMode
      ? "数据库中还没有管理员账号。创建账号不会清空已有动态、评论或点赞。"
      : "使用数据库中的管理员账号登录。";
  }
  if (btn) btn.textContent = setupMode ? "完成初始化" : "进入设置";
  if (wrap) wrap.hidden = !setupMode;
  if (pass) pass.autocomplete = setupMode ? "new-password" : "current-password";
}

async function tryRestoreSession() {
  if (getToken()) {
    try {
      const verify = await api("/api/auth/verify");
      setGateMode(false);
      await enterPanel(verify);
      return true;
    } catch {
      setToken("");
    }
  }
  try {
    const initialized = await fetchAuthStatus();
    setGateMode(!initialized);
  } catch {
    setGateMode(false);
  }
  return false;
}

function downloadBlob(filename, data, type = "application/octet-stream") {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Store-only ZIP (no compression) so Windows / macOS can extract the markdown files. */
function buildZip(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const name = enc.encode(String(file.name || "untitled.md").replace(/\\/g, "/"));
    const data = enc.encode(file.content || "");
    const crc = crc32(data);
    const gpFlag = 0x0800;

    const localHeader = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, gpFlag, true);
    lv.setUint16(10, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    localHeader.set(name, 30);
    localHeader.set(data, 30 + name.length);
    parts.push(localHeader);

    const centralHeader = new Uint8Array(46 + name.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, gpFlag, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    centralHeader.set(name, 46);
    central.push(centralHeader);
    offset += localHeader.length;
  }

  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const total = parts.reduce((n, b) => n + b.length, 0) + centralSize + end.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const b of parts) {
    out.set(b, pos);
    pos += b.length;
  }
  for (const b of central) {
    out.set(b, pos);
    pos += b.length;
  }
  out.set(end, pos);
  return out;
}

document.getElementById("settingsTabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".settings-nav__item");
  if (!tab) return;
  switchTab(tab.dataset.tab);
});

document.getElementById("settingsMenuBtn").addEventListener("click", () => {
  if (window.matchMedia("(max-width: 767px)").matches) toggleSettingsSidebar();
});

document.getElementById("settingsSidebarMask").addEventListener("click", closeSettingsSidebar);

window.addEventListener("resize", () => {
  if (!window.matchMedia("(max-width: 767px)").matches) closeSettingsSidebar();
});

document.getElementById("refreshPostsBtn").addEventListener("click", () => loadPosts(postsPage));

document.getElementById("selectPostsBtn").addEventListener("click", () => {
  setPostsSelectMode(!postsSelectMode);
});

document.getElementById("deleteSelectedPostsBtn").addEventListener("click", async () => {
  const ids = [...selectedPostIds];
  if (!ids.length) return;
  if (!confirm(`确定删除选中的 ${ids.length} 条动态？相关评论和点赞也会删除。`)) return;
  const btn = document.getElementById("deleteSelectedPostsBtn");
  btn.disabled = true;
  let ok = 0;
  let fail = 0;
  try {
    for (const id of ids) {
      try {
        await api(`/api/posts/${id}`, { method: "DELETE" });
        selectedPostIds.delete(id);
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    if (fail) toast(`已删除 ${ok} 条，失败 ${fail} 条`);
    else toast(`已删除 ${ok} 条动态`);
    if (!selectedPostIds.size) setPostsSelectMode(false);
    else updatePostsSelectUi();
    await loadPosts(postsPage);
  } catch (err) {
    toast(err.message);
    updatePostsSelectUi();
  }
});

document.getElementById("postsPager")?.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-posts-page]");
  if (!btn || btn.disabled) return;
  const raw = btn.getAttribute("data-posts-page");
  let page = postsPage;
  if (raw === "prev") page = postsPage - 1;
  else if (raw === "next") page = postsPage + 1;
  else page = Number(raw);
  if (!Number.isFinite(page) || page === postsPage) return;
  try {
    await loadPosts(page);
  } catch (err) {
    toast(err.message);
  }
});
document.getElementById("postsList").addEventListener("click", (e) => {
  const row = e.target.closest(".manage-row[data-post-id]");
  if (!row) return;
  const postId = row.getAttribute("data-post-id");
  if (postsSelectMode) {
    togglePostSelection(postId);
    return;
  }
  openEditPost(postsCache.get(postId));
});

document.getElementById("postsList").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const row = e.target.closest(".manage-row[data-post-id]");
  if (!row) return;
  e.preventDefault();
  const postId = row.getAttribute("data-post-id");
  if (postsSelectMode) {
    togglePostSelection(postId);
    return;
  }
  openEditPost(postsCache.get(postId));
});

document.getElementById("editPostCancel").addEventListener("click", closeEditPost);
document.getElementById("editPostPreviewToggle").addEventListener("click", () => {
  const body = document.getElementById("editPostBody");
  setEditPostPreviewMode(!body.classList.contains("is-preview"));
});
editPostMask.addEventListener("click", (e) => {
  if (e.target === editPostMask) closeEditPost();
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const shell = document.getElementById("panel");
  if (shell?.classList.contains("is-sidebar-open")) {
    closeSettingsSidebar();
    return;
  }
  if (engageMask.classList.contains("open")) {
    closeEngageDialog();
    refreshEngageParentList();
    return;
  }
  if (editPostMask.classList.contains("open")) closeEditPost();
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
    await api(`/api/posts/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    toast("已保存");
    closeEditPost();
    loadPosts();
  } catch (err) {
    toast(err.message);
  }
});

document.getElementById("editPostDelete").addEventListener("click", async () => {
  const id = document.getElementById("editPostId").value;
  if (!confirm("确定删除这条动态？相关评论和点赞也会删除。")) return;
  try {
    await api(`/api/posts/${id}`, { method: "DELETE" });
    toast("已删除动态");
    closeEditPost();
    loadPosts();
  } catch (err) {
    toast(err.message);
  }
});

document.getElementById("refreshCommentsBtn").addEventListener("click", () => loadCommentPosts());
document.getElementById("refreshLikesBtn").addEventListener("click", () => loadLikePosts());
document.getElementById("refreshPageLikesBtn")?.addEventListener("click", () => loadPageLikes());
document.getElementById("page_likes_enabled")?.addEventListener("change", () => {
  syncPageLikesNav();
});

function refreshEngageParentList() {
  if (engageState.type === "comments") loadCommentPosts();
  else if (engageState.type === "likes") loadLikePosts();
}

document.getElementById("engageClose").addEventListener("click", () => {
  closeEngageDialog();
  refreshEngageParentList();
});
engageMask.addEventListener("click", (e) => {
  if (e.target === engageMask) {
    closeEngageDialog();
    refreshEngageParentList();
  }
});

document.getElementById("commentsList").addEventListener("click", (e) => {
  const postRow = e.target.closest("[data-comment-post-id]");
  if (!postRow) return;
  openEngageDialog(
    "comments",
    postRow.getAttribute("data-comment-post-id"),
    postRow.getAttribute("data-post-excerpt") || "",
  );
});

document.getElementById("commentsList").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const postRow = e.target.closest("[data-comment-post-id]");
  if (!postRow) return;
  e.preventDefault();
  openEngageDialog(
    "comments",
    postRow.getAttribute("data-comment-post-id"),
    postRow.getAttribute("data-post-excerpt") || "",
  );
});

document.getElementById("likesList").addEventListener("click", (e) => {
  const postRow = e.target.closest("[data-like-post-id]");
  if (!postRow) return;
  openEngageDialog(
    "likes",
    postRow.getAttribute("data-like-post-id"),
    postRow.getAttribute("data-post-excerpt") || "",
  );
});

document.getElementById("likesList").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const postRow = e.target.closest("[data-like-post-id]");
  if (!postRow) return;
  e.preventDefault();
  openEngageDialog(
    "likes",
    postRow.getAttribute("data-like-post-id"),
    postRow.getAttribute("data-post-excerpt") || "",
  );
});

document.getElementById("engageList").addEventListener("click", async (e) => {
  const delComment = e.target.closest("[data-del-comment]");
  if (delComment) {
    const id = delComment.getAttribute("data-del-comment");
    if (!confirm("确定删除这条评论？其直接回复也会一并删除。")) return;
    try {
      await api(`/api/comments/${id}`, { method: "DELETE" });
      toast("已删除评论");
      await refreshEngageDialog();
      if (document.querySelector("#engageList .manage-empty")) {
        closeEngageDialog();
        await loadCommentPosts();
      }
    } catch (err) {
      toast(err.message);
    }
    return;
  }

  const delLike = e.target.closest("[data-del-like]");
  if (!delLike) return;
  const id = delLike.getAttribute("data-del-like");
  if (!confirm("确定删除这条点赞？")) return;
  try {
    await api(`/api/likes/${id}`, { method: "DELETE" });
    toast("已删除点赞");
    await refreshEngageDialog();
    if (document.querySelector("#engageList .manage-empty")) {
      closeEngageDialog();
      await loadLikePosts();
    }
  } catch (err) {
    toast(err.message);
  }
});

document.getElementById("loginBtn").addEventListener("click", async () => {
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  if (!username) {
    toast("请输入账号");
    document.getElementById("username").focus();
    return;
  }
  if (!password) {
    toast("请输入密码");
    return;
  }
  if (setupMode) {
    const again = document.getElementById("password2")?.value || "";
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
    await enterPanel({ data: { username } });
    toast(setupMode ? "初始化成功" : "登录成功");
  } catch (err) {
    if (needsSetup(err)) {
      setGateMode(true);
      toast("请先设置管理员账号（不会清空动态）");
      return;
    }
    toast(err.message);
  }
});

document.getElementById("password").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("loginBtn").click();
});
document.getElementById("username")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("password").focus();
});
document.getElementById("password2")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("loginBtn").click();
});

document.getElementById("clearResendKeyBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("clearResendKeyBtn");
  if (btn?.disabled) return;
  if (!confirm("确定清除已保存的 Resend API Key？")) return;
  if (btn) btn.disabled = true;
  try {
    const res = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ clear_resend_api_key: true }),
    });
    fillForm(res.data, res.meta);
    toast("已清除 API Key");
  } catch (err) {
    toast(err.message);
    if (btn) btn.disabled = false;
  }
});

document.getElementById("clearWebdavPasswordBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("clearWebdavPasswordBtn");
  if (btn?.disabled) return;
  if (!confirm("确定清除已保存的 WebDAV 密码？")) return;
  if (btn) btn.disabled = true;
  try {
    const res = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ clear_webdav_password: true }),
    });
    fillForm(res.data, res.meta);
    toast("已清除 WebDAV 密码");
  } catch (err) {
    toast(err.message);
    if (btn) btn.disabled = false;
  }
});

document.getElementById("webdavBackupBtn")?.addEventListener("click", async () => {
  const status = document.getElementById("webdavStatus");
  const btn = document.getElementById("webdavBackupBtn");
  const url = document.getElementById("webdav_url")?.value?.trim() || "";
  if (!url) {
    toast("请先填写 WebDAV 地址");
    document.getElementById("webdav_url")?.focus();
    return;
  }
  if (btn) btn.disabled = true;
  if (status) status.textContent = "正在备份…";
  try {
    const pass = document.getElementById("webdav_password")?.value?.trim() || "";
    const res = await api("/api/admin/webdav-backup", {
      method: "POST",
      body: JSON.stringify({
        url,
        username: document.getElementById("webdav_username")?.value?.trim() || "",
        password: /^\*+$/.test(pass) ? "" : pass,
        folder: document.getElementById("webdav_folder")?.value?.trim() || "",
      }),
    });
    const msg = res.message || "备份完成";
    fillWebdavStatus({
      webdav_last_error: "",
      webdav_last_backup_at: String(res.data?.exported_at || Date.now()),
    });
    toast(msg);
  } catch (err) {
    if (status) status.textContent = err.message;
    toast(err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
});

document.getElementById("notifyTestBtn")?.addEventListener("click", async () => {
  const status = document.getElementById("notifyTestStatus");
  const btn = document.getElementById("notifyTestBtn");
  const adminEmail = document.getElementById("admin_email")?.value?.trim() || "";
  const mailFrom = document.getElementById("mail_from")?.value?.trim() || "";
  if (!adminEmail) {
    toast("请先填写管理员邮箱");
    document.getElementById("admin_email")?.focus();
    return;
  }
  if (!mailFrom) {
    toast("请先填写 Resend 发件地址");
    document.getElementById("mail_from")?.focus();
    return;
  }
  if (btn) btn.disabled = true;
  if (status) status.textContent = "正在发送测试邮件…";
  try {
    const res = await api("/api/admin/notify-test", {
      method: "POST",
      body: JSON.stringify({
        admin_email: adminEmail,
        mail_from: mailFrom,
        mail_from_name: document.getElementById("mail_from_name")?.value?.trim() || "",
        site_title: document.getElementById("site_title")?.value?.trim() || "",
        site_url: document.getElementById("site_url")?.value?.trim() || "",
        resend_api_key: (() => {
          const v = document.getElementById("resend_api_key")?.value?.trim() || "";
          return /^\*+$/.test(v) ? "" : v;
        })(),
      }),
    });
    const msg = res.message || "测试邮件已发送";
    if (status) status.textContent = msg;
    toast(msg);
  } catch (err) {
    if (status) status.textContent = err.message;
    toast(err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
});

document.getElementById("saveBtn")?.addEventListener("click", async () => {
  try {
    const res = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify(readForm()),
    });
    fillForm(res.data, res.meta);
    toast("已保存");
  } catch (err) {
    toast(err.message);
  }
});

document.getElementById("accountSaveBtn")?.addEventListener("click", async () => {
  const username = document.getElementById("account_username")?.value?.trim() || "";
  const current = document.getElementById("account_current_password")?.value || "";
  const next = document.getElementById("account_new_password")?.value || "";
  if (!username) {
    toast("请填写账号");
    return;
  }
  if (!current) {
    toast("请填写当前密码");
    return;
  }
  try {
    const res = await api("/api/admin/account", {
      method: "PUT",
      body: JSON.stringify({
        username,
        current_password: current,
        new_password: next,
      }),
    });
    if (res.data?.username) document.getElementById("account_username").value = res.data.username;
    if (res.token) setToken(res.token);
    document.getElementById("account_current_password").value = "";
    document.getElementById("account_new_password").value = "";
    toast(res.message || "账号已更新");
  } catch (err) {
    toast(err.message);
  }
});

document.getElementById("avatar").addEventListener("input", syncMediaPreviews);
document.getElementById("cover").addEventListener("input", syncMediaPreviews);
document.getElementById("nickname").addEventListener("input", syncMediaPreviews);
document.getElementById("resend_api_key")?.addEventListener("focus", (e) => {
  const el = e.target;
  if (el && /^\*+$/.test((el.value || "").trim())) el.select();
});
document.getElementById("webdav_password")?.addEventListener("focus", (e) => {
  const el = e.target;
  if (el && /^\*+$/.test((el.value || "").trim())) el.select();
});

function updateImportFilesName() {
  const input = document.getElementById("importFiles");
  const nameEl = document.getElementById("importFilesName");
  if (!input || !nameEl) return;
  const files = [...(input.files || [])];
  if (!files.length) {
    nameEl.textContent = "未选择文件";
    nameEl.classList.remove("is-filled");
    return;
  }
  if (files.length === 1) nameEl.textContent = files[0].name;
  else nameEl.textContent = `已选择 ${files.length} 个文件`;
  nameEl.classList.add("is-filled");
}

document.getElementById("importFilesPick").addEventListener("click", () => {
  document.getElementById("importFiles").click();
});

document.getElementById("importFiles").addEventListener("change", updateImportFilesName);

document.getElementById("importBtn").addEventListener("click", async () => {
  const input = document.getElementById("importFiles");
  const files = [...(input.files || [])];
  if (!files.length) {
    toast("请先选择要导入的文件");
    return;
  }

  const mode = document.getElementById("importMode").value;
  if (mode === "replace" && !confirm("替换模式会清空现有全部动态，确定继续？")) return;

  try {
    importStatus.textContent = "正在读取文件…";
    const items = [];
    let postsFromJson = [];

    for (const file of files) {
      const text = await file.text();
      const lower = file.name.toLowerCase();
      if (lower.endsWith(".json")) {
        const data = JSON.parse(text);
        if (Array.isArray(data.posts)) {
          postsFromJson = postsFromJson.concat(data.posts);
        } else if (Array.isArray(data)) {
          postsFromJson = postsFromJson.concat(data);
        } else if (Array.isArray(data.files)) {
          for (const f of data.files) {
            items.push({
              filename: f.name || f.filename || "import.md",
              markdown: f.content || f.markdown || "",
            });
          }
        } else {
          throw new Error(`${file.name} 不是可识别的导出 JSON`);
        }
      } else {
        items.push({ filename: file.name, markdown: text });
      }
    }

    importStatus.textContent = "正在导入…";
    const res = await api("/api/posts/import", {
      method: "POST",
      body: JSON.stringify({
        mode,
        confirm_replace: mode === "replace",
        items,
        posts: postsFromJson,
      }),
    });

    importStatus.textContent = `导入完成：成功 ${res.imported} 条，跳过 ${res.skipped} 条`;
    toast(`已导入 ${res.imported} 条动态`);
    input.value = "";
    updateImportFilesName();
    loadPosts();
  } catch (err) {
    importStatus.textContent = err.message;
    toast(err.message);
  }
});

document.getElementById("exportBtn").addEventListener("click", async () => {
  try {
    const res = await api("/api/posts/export");
    if (!res.files?.length) {
      toast("没有可导出的动态");
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(`hugo-content-moments-${stamp}.zip`, buildZip(res.files), "application/zip");
    toast(`已导出 ${res.count} 条动态（解压到 Hugo 根目录即可）`);
  } catch (err) {
    toast(err.message);
  }
});

function syncThemeToggleLabel() {
  const el = document.getElementById("gateThemeBtn");
  if (el) el.textContent = getTheme() === "dark" ? "浅色模式" : "深色模式";
}

document.getElementById("gateThemeBtn")?.addEventListener("click", () => {
  toggleTheme();
  syncThemeToggleLabel();
});

initTheme();
syncThemeToggleLabel();
tryRestoreSession();
