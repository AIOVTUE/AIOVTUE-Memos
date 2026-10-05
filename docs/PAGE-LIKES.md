# 静态博客文章点赞

给 Hugo 等站点的**文章页**加赞：计数在 AIOVTUE-memos 的 D1 里，本机是否已赞记在浏览器。  
**读计数公开；点赞/取消需要本站管理员 token 或密码。不要把管理员密码写进博客页面。**

动态上的赞（`/api/posts/:id/likes`）见 [API.md](./API.md)。

---

## 效果

- 同一路径（去掉域名、`?`、`#`、末尾 `/`）共用赞数。
- 再点一次取消。同一 `client_id` 不会重复 +1。

| 实际网址 | 记为 |
|----------|------|
| `https://blog.com/posts/hello/` | `/posts/hello` |
| `https://cdn.example.net/posts/hello?x=1` | `/posts/hello` |
| `http://127.0.0.1:1313/posts/hello/` | `/posts/hello` |

---

## 1. 在 Memos 上启用

1. 部署并完成管理员初始化。[部署教程](./DEPLOY.md)。
2. 迁移需包含 `page_likes`：`npm run db:migrate:local` / `remote`。
3. `/settings.html` → **跨域**填博客 Origin（不要路径）。生产不要留空。
4. 打开 **启用文章点赞** 并保存。

写接口校验：**Bearer 管理 token**（推荐），或 JSON `password`（管理员登录密码，勿放进公开页）。

本站演示：[http://127.0.0.1:8787/page-like-demo](http://127.0.0.1:8787/page-like-demo)（先登录管理员）。

---

## 2. Hugo 接入

博客页建议只配 `api` + `url`，用来 **显示赞数**。访客在博客上点赞会因没有 token 失败（「站点密码错误」），这是刻意的。

若要在博客上让访客点赞，只能把管理员密码写进前端——等于公开管理员密码，**不推荐**。

```toml
[params.memosLike]
enabled = true
api = "https://aiovtue-memos.xxx.workers.dev"
```

```html
{{ if .Site.Params.memosLike.enabled }}
<button type="button" id="pageLikeBtn" aria-pressed="false">
  ♡ <span id="pageLikeCount">0</span>
</button>
<p id="pageLikeMsg"></p>
<script>
  window.HUGO_MEMOS_LIKE = {
    enabled: true,
    api: {{ .Site.Params.memosLike.api | jsonify }},
    url: {{ .Permalink | jsonify }},
  };
</script>
<script src="https://aiovtue-memos.xxx.workers.dev/js/page-like.js"></script>
{{ end }}
```

`url` 用 `.Permalink` 或 `.RelPermalink`。  
示例：[`examples/page-like.html`](../examples/page-like.html)。脚本：[`/js/page-like.js`](../public/js/page-like.js)。

### 可选字段

| 字段 | 默认 | 说明 |
|------|------|------|
| `enabled` | 非 `false`/`0` 即开 | Hugo 侧是否加载 |
| `api` | 必填 | Memos 根地址，不要末尾 `/` |
| `password` | 空 | **不要**写进公开页 |
| `url` | `location.href` | 文章网址或路径 |
| `buttonId` | `pageLikeBtn` | |
| `countId` | `pageLikeCount` | |
| `messageId` | `pageLikeMsg` | |
| 已赞 class | `is-on` | |

本站已登录时，脚本会自动带 `hugo_memos_token`。

---

## 3. 自己发请求

```http
GET /api/page-likes?url=https://blog.example.com/posts/hello/
X-Client-Id: <建议 UUID>
```

```http
POST /api/page-likes
Authorization: Bearer <管理 token>
Content-Type: application/json
X-Client-Id: <必填>

{ "url": "https://blog.example.com/posts/hello/", "client_id": "<同上>" }
```

`DELETE` 字段相同。未启用 →「文章点赞未启用」。

---

## 4. 数据

| 位置 | 内容 |
|------|------|
| `page_likes` | 路径 → 赞数 |
| `page_like_clients` | 该 `client_id` 是否已赞 |
| `page_likes_enabled` | 开关 |
| `localStorage` `hugo_memos_page_likes` | 本机已赞路径 |
| `localStorage` `hugo_memos_client_id` | 访客 ID |

---

## 5. 排错

**未启用** → 设置页打开开关。  
**站点密码错误** → 博客不要配 `password`；到本站登录后再点，或只展示计数。  
**CORS** → 填 `http://localhost:1313` 或 `http://127.0.0.1:1313` 等完整 Origin。  
**赞数不合并** → 归一化路径必须相同。  
**缺表** → `npm run db:migrate:remote` 后重新部署。
