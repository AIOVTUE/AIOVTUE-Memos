(function () {
  const cfg = window.HUGO_MEMOS_LIKE || {};
  if (cfg.enabled === false || cfg.enabled === 0 || cfg.enabled === "false" || cfg.enabled === "0") return;

  const api = String(cfg.api || "").replace(/\/$/, "");
  const pageUrl = String(cfg.url || location.href || location.pathname || "/");
  const btn = document.getElementById(cfg.buttonId || "pageLikeBtn");
  const countEl = document.getElementById(cfg.countId || "pageLikeCount");
  const msgEl = document.getElementById(cfg.messageId || "pageLikeMsg");
  if (!api || !btn) return;

  const storeKey = "hugo_memos_page_likes";
  const clientKey = "hugo_memos_client_id";

  function getClientId() {
    let id = localStorage.getItem(clientKey);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(clientKey, id);
    }
    return id;
  }

  function loadLiked() {
    try {
      return JSON.parse(localStorage.getItem(storeKey) || "{}") || {};
    } catch {
      return {};
    }
  }

  function setLocalLiked(path, liked) {
    const map = loadLiked();
    if (liked) map[path] = true;
    else delete map[path];
    localStorage.setItem(storeKey, JSON.stringify(map));
  }

  function showMsg(text) {
    if (msgEl) msgEl.textContent = text || "";
  }

  function paint(path, likeCount, liked) {
    if (countEl) countEl.textContent = String(likeCount);
    btn.classList.toggle("is-on", liked);
    btn.setAttribute("aria-pressed", liked ? "true" : "false");
    btn.disabled = false;
    setLocalLiked(path, liked);
  }

  async function req(method) {
    const headers = {
      "Content-Type": "application/json",
      "X-Client-Id": getClientId(),
    };
    const token = sessionStorage.getItem("hugo_memos_token") || "";
    if (token) headers.Authorization = `Bearer ${token}`;
    const password = String((window.HUGO_MEMOS_LIKE || {}).password || "");
    const res = await fetch(`${api}/api/page-likes${method === "GET" ? `?url=${encodeURIComponent(pageUrl)}` : ""}`, {
      method,
      headers,
      body:
        method === "GET"
          ? undefined
          : JSON.stringify({ url: pageUrl, client_id: getClientId(), password }),
    });
    const data = await res.json().catch(() => ({ ok: false, error: "解析失败" }));
    if (!res.ok || data.ok === false) throw new Error(data.error || `请求失败 (${res.status})`);
    return data.data || {};
  }

  async function refresh() {
    try {
      const data = await req("GET");
      paint(data.path, data.like_count, Boolean(data.liked || loadLiked()[data.path]));
      showMsg("");
    } catch (err) {
      showMsg(err.message || "无法读取点赞数");
    }
  }

  btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    const liked = btn.getAttribute("aria-pressed") === "true";
    btn.disabled = true;
    try {
      const data = await req(liked ? "DELETE" : "POST");
      paint(data.path, data.like_count, Boolean(data.liked));
      showMsg("");
    } catch (err) {
      btn.disabled = false;
      showMsg(err.message || (liked ? "取消失败" : "点赞失败"));
    }
  });

  refresh();
})();
