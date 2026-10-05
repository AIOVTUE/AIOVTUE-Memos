# AIOVTUE-memos API 使用教程

本文说明如何调用 AIOVTUE-memos 的 JSON API。默认本地地址：`http://127.0.0.1:8787`，生产请换成你的 Worker 域名。

相关文档：[部署教程](./DEPLOY.md) · [项目说明](../README.md) · [文章点赞](./PAGE-LIKES.md) · [WebDAV](./WEBDAV.md) · [安全说明](./SECURITY.md)

---

## 基址

| 环境 | 根地址 | 接口 |
|------|--------|------|
| 本地 | `http://127.0.0.1:8787` | `http://127.0.0.1:8787/api/...` |
| 生产 | `https://aiovtue-memos.<子域>.workers.dev` 或自定义域名 | 同上拼 `/api/...` |

Hugo 配置里填**站点根**（不要带 `/api`）。

非 GET/HEAD/OPTIONS 必须带 `Content-Length`；JSON 正文上限约 **5MB**。

---

## 约定

### 响应格式

成功：

```json
{ "ok": true, "data": { } }
```

失败：

```json
{ "ok": false, "error": "错误说明" }
```

部分接口还会返回 `meta`、`token`、`liked` 等顶层字段。

### 鉴权

需要管理员权限的接口，请求头：

```http
Authorization: Bearer <token>
```

获取 token：

```http
POST /api/auth/login
Content-Type: application/json

{ "username": "admin", "password": "你的管理密码" }
```

首次部署（数据库尚无管理员）需先初始化，只能调用一次。**只写入管理员账号，不会删除动态、评论或点赞。**

```http
POST /api/auth/setup
Content-Type: application/json

{ "username": "admin", "password": "至少6位" }
```

查询是否已初始化：`GET /api/auth/status` → `{ "ok": true, "data": { "initialized": true } }`。

修改账号（需登录）：`PUT /api/admin/account`，body：`username`、`current_password`、可选 `new_password`。若改了密码，响应会带新 `token`（旧 token 全部作废）。

成功响应：

```json
{
  "ok": true,
  "token": "....",
  "expires_in": 86400
}
```

校验是否仍有效：

```http
GET /api/auth/verify
Authorization: Bearer <token>
```

### 访客标识（点赞必需）

点赞 / 取消赞需要稳定的客户端 ID（建议浏览器 `localStorage` 存 UUID）：

```http
X-Client-Id: 550e8400-e29b-41d4-a716-446655440000
```

也可在 JSON body 里传 `client_id`（与 Header 二选一，优先 body）。

### CORS

- 设置项 `cors_origins` 为空时允许任意 Origin（`*`），方便 Hugo 跨域嵌入
- 生产务必在设置页填写博客 Origin，见 [部署教程](./DEPLOY.md) 与 [安全说明](./SECURITY.md)

### URL 规则

图片、头像、封面、评论主页链接仅允许：

- `http://` / `https://`
- 站内相对路径，如 `/img/toux.webp`（评论主页不使用相对路径）

`javascript:`、`data:` 等会被拒绝或丢弃。每条动态最多 **9** 张图。

---

## 接口一览

| 权限 | 方法 | 路径 | 说明 |
|------|------|------|------|
| 公开 | GET | `/api/health` | `{ ok, service: "AIOVTUE-memos", initialized }` |
| 公开 | GET | `/api/auth/status` | 是否已初始化 |
| 公开 | POST | `/api/auth/setup` | 首次创建管理员（只能一次） |
| 公开 | POST | `/api/auth/login` | 登录拿 token |
| 管理 | GET | `/api/auth/verify` | token 是否有效 |
| 管理 | PUT | `/api/admin/account` | 改账号 / 密码 |
| 公开 | GET | `/api/settings` | 公开站点资料 |
| 管理 | PUT | `/api/settings` | 更新设置 |
| 管理 | POST | `/api/admin/notify-test` | 发测试邮件 |
| 管理 | POST | `/api/admin/webdav-backup` | 立即 WebDAV 备份 |
| 公开 | GET | `/api/posts` | 动态列表（分页；每条最多 80 条评论） |
| 公开 | GET | `/api/posts/:id` | 单条动态（评论最多 200） |
| 管理 | POST | `/api/posts` | 发动态 |
| 管理 | PUT | `/api/posts/:id` | 编辑动态 |
| 管理 | DELETE | `/api/posts/:id` | 删动态 |
| 管理 | GET | `/api/posts/export` | 导出 Hugo Markdown |
| 管理 | POST | `/api/posts/import` | 导入动态 |
| 公开 | POST | `/api/posts/:id/likes` | 点赞 |
| 公开 | DELETE | `/api/posts/:id/likes` | 取消赞 |
| 公开 | GET | `/api/posts/:id/comments` | 评论列表（最多 200） |
| 公开 | POST | `/api/posts/:id/comments` | 发评论 / 回复 |
| 管理 | DELETE | `/api/comments/:id` | 删评论（含子回复） |
| 管理 | GET | `/api/admin/comment-posts` | 有评论的动态 |
| 管理 | GET | `/api/admin/like-posts` | 有点赞的动态 |
| 管理 | GET | `/api/admin/page-likes` | 文章点赞汇总 |
| 管理 | GET | `/api/admin/comments` | 评论明细 |
| 管理 | GET | `/api/admin/likes` | 点赞明细 |
| 管理 | DELETE | `/api/likes/:id` | 按记录删点赞 |
| 公开 | GET | `/api/page-likes` | 博客文章点赞计数 |
| 管理* | POST | `/api/page-likes` | 文章点赞（须启用） |
| 管理* | DELETE | `/api/page-likes` | 取消文章点赞 |

`*` 须打开「启用文章点赞」。写操作：Bearer **或** JSON `password`。不要把密码写进公开博客。详细步骤见 [PAGE-LIKES.md](./PAGE-LIKES.md)。

---

## 动态

### 分页列表（推荐分批加载）

```http
GET /api/posts?limit=10&offset=0
X-Client-Id: <可选，用于返回 liked>
```

| 参数 | 说明 |
|------|------|
| `limit` | 每页条数，默认 20，最大 50 |
| `offset` | 跳过条数，从 0 开始 |

响应示例：

```json
{
  "ok": true,
  "data": [
    {
      "id": "…",
      "content": "今天天气不错",
      "images": ["https://example.com/a.jpg"],
      "created_at": 1712319000000,
      "updated_at": 1712319000000,
      "like_count": 2,
      "comment_count": 1,
      "liked": false,
      "likers": [{ "name": "小明" }],
      "comments": [
        {
          "id": "…",
          "post_id": "…",
          "parent_id": "",
          "author_name": "路人",
          "author_url": "https://example.com",
          "content": "好看！",
          "created_at": 1712319100000
        }
      ]
    }
  ],
  "meta": { "total": 42, "limit": 10, "offset": 0 }
}
```

说明：

- 公开接口的 `likers` **不含** `client_id`（防他人冒用取消赞）
- 公开评论 **不含** `author_email`
- 列表里每条动态最多附带 **80** 条评论（`comment_count` 仍是总数）
- 前端按 `offset` 递增即可「加载更多」

JavaScript 示例：

```js
async function loadPage(offset = 0, limit = 10) {
  const res = await fetch(
    `https://aiovtue-memos.xxx.workers.dev/api/posts?limit=${limit}&offset=${offset}`,
    { headers: { "X-Client-Id": localStorage.clientId } },
  );
  return res.json();
}
```

### 获取单条

```http
GET /api/posts/:id
X-Client-Id: <可选>
```

### 发布

```http
POST /api/posts
Authorization: Bearer <token>
Content-Type: application/json

{
  "content": "今天天气不错",
  "images": ["https://example.com/a.jpg"],
  "created_at": 1712319000000
}
```

- `content` 与 `images` 不能同时为空
- `created_at` 可选，毫秒时间戳

### 编辑

```http
PUT /api/posts/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "content": "修改后的正文",
  "images": [],
  "created_at": 1712319000000
}
```

### 删除

```http
DELETE /api/posts/:id
Authorization: Bearer <token>
```

会同时删除该动态下的评论与点赞。

---

## 博客文章点赞

给静态博客（Hugo 等）文章页点赞。**使用步骤、Hugo 模板与排错**见 **[文章点赞使用说明](./PAGE-LIKES.md)**。

下面是接口摘要。页面身份只用 **URL 路径**：忽略域名、查询串和 hash。

`https://a.com/posts/foo/`、`https://b.net/posts/foo?x=1` 都记为 `/posts/foo`。

1. 在设置页打开「启用文章点赞」，并把博客 Origin 写入 CORS。
2. 博客只配 Worker 地址用于 **读计数**。点赞请用本站登录后的 Bearer，不要把管理员密码写进页面。
3. 计数在 D1；浏览器用 `localStorage` 记本机已赞。再点一次取消。

查询：

```http
GET /api/page-likes?url=https://blog.example.com/posts/hello/
X-Client-Id: <可选，用于返回 liked>
```

点赞 / 取消（推荐 Bearer，不要把密码写进博客）：

```http
POST /api/page-likes
Authorization: Bearer <管理 token>
Content-Type: application/json
X-Client-Id: <必填>

{
  "url": "https://blog.example.com/posts/hello/",
  "client_id": "<与请求头相同即可>"
}
```

也可在 JSON 里传 `password`（管理员登录密码），仅适合自己的私有脚本，不要出现在公开 HTML。`DELETE` 字段相同。未启用时返回「文章点赞未启用」。

可嵌入脚本：[`/js/page-like.js`](../public/js/page-like.js)，示例见 [`examples/page-like.html`](../examples/page-like.html)。Hugo 模板示例：

```html
<button type="button" id="pageLikeBtn">♡ <span id="pageLikeCount">0</span></button>
<p id="pageLikeMsg"></p>
<script>
  window.HUGO_MEMOS_LIKE = {
    enabled: true,
    api: "{{ .Site.Params.memosLike.api }}",
    url: "{{ .Permalink }}",
  };
</script>
<script src="https://aiovtue-memos.xxx.workers.dev/js/page-like.js"></script>
```

`config.toml`：

```toml
[params.memosLike]
enabled = true
api = "https://aiovtue-memos.xxx.workers.dev"
```

---

## 点赞

### 点赞

```http
POST /api/posts/:id/likes
X-Client-Id: <必填>
Content-Type: application/json

{ "author_name": "小明" }
```

同一 `client_id` 重复点赞会更新昵称（upsert），不会重复计数。

### 取消赞

```http
DELETE /api/posts/:id/likes
X-Client-Id: <必填>
Content-Type: application/json

{}
```

成功响应示例：

```json
{
  "ok": true,
  "liked": true,
  "like_count": 3,
  "likers": [{ "name": "小明" }, { "name": "小红" }]
}
```

---

## 评论

### 列表

```http
GET /api/posts/:id/comments
```

### 发表 / 回复

```http
POST /api/posts/:id/comments
Content-Type: application/json

{
  "author_name": "路人",
  "author_email": "可选，仅服务端保存，公开接口不返回",
  "author_url": "https://example.com",
  "content": "好看！",
  "parent_id": "要回复的评论 id，可选"
}
```

公开响应不含 `author_email`。`parent_id` 必须属于同一动态。单帖公开列表最多 **200** 条。

### 邮件通知

评论成功后异步经 **Resend** 通知 **管理员邮箱**（失败不影响评论接口）。不会把邮件发到访客填写的任意地址。

条件：`notify_enabled` 非 `"0"`，且配置了 `admin_email`、`mail_from`、Resend API Key。

设置项：`notify_enabled`、`admin_email`、`mail_from`、`mail_from_name`、`site_url`、`resend_api_key`（加密存储，读取不回传明文）。  
`POST /api/admin/notify-test` 可发测试信。

### 删除（管理）

```http
DELETE /api/comments/:id
Authorization: Bearer <token>
```

会删除该评论及其**直接回复**。

---

## 站点设置

### 读取（公开）

```http
GET /api/settings
```

公开字段：`nickname`、`avatar`、`cover`、`site_title`、`site_description`。  
带管理 Token 时另含邮件、CORS、文章点赞开关、WebDAV 非密码字段、上次备份时间等；`meta.resend_configured`、`meta.webdav_password_configured`。不含任何密钥明文。

`PUT` 可更新：`nickname`、`avatar`、`cover`、`site_title`、`site_description`、`notify_enabled`、`admin_email`、`mail_from`、`mail_from_name`、`site_url`、`cors_origins`、`page_likes_enabled`、`webdav_*`（不含密码明文回读）。  
`resend_api_key` / `clear_resend_api_key`；`webdav_password` / `clear_webdav_password`。留空的密钥字段表示保持原值。

默认头像 `/img/toux.webp`，默认封面 `/hero/hero-1.mp4`。

### 更新（管理）

```http
PUT /api/settings
Authorization: Bearer <token>
Content-Type: application/json

{
  "nickname": "AIOVTUE-雪",
  "avatar": "/img/toux.webp",
  "cover": "/hero/hero-1.mp4",
  "site_title": "动态"
}
```

---

## 导入 / 导出

### 导出（Hugo Markdown）

```http
GET /api/posts/export
Authorization: Bearer <token>
```

返回 JSON，内含 `files[]`（路径 + 文本内容），前端可打包成 zip。结构为：

```
content/moments/_index.md
content/moments/26-9-6.md
…
```

解压到 Hugo 站点根目录即可。

### 导入

```http
POST /api/posts/import
Authorization: Bearer <token>
Content-Type: application/json

{
  "mode": "append",
  "confirm_replace": false,
  "items": [
    {
      "filename": "24-4-5.md",
      "markdown": "---\ndate: 2024-04-05 19:50:00\n---\n正文\n![](https://example.com/a.jpg)\n"
    }
  ],
  "posts": [
    {
      "content": "JSON 动态",
      "images": ["https://example.com/b.jpg"],
      "created_at": 1712319000000
    }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `mode` | `append`（默认）或 `replace` |
| `confirm_replace` | `replace` 时必须为 `true` |
| `items` / `files` | Markdown 文件列表 |
| `posts` | JSON 动态列表 |
| 上限 | 单次最多 **500** 条 |

`append` 下相同「内容 + 时间」会跳过。

WebDAV 自动备份见 **[WEBDAV.md](./WEBDAV.md)**：`POST /api/admin/webdav-backup`。

---

## 管理端明细

均需 Bearer。

```http
GET /api/admin/comment-posts?limit=100&offset=0
GET /api/admin/like-posts?limit=100&offset=0
GET /api/admin/page-likes?limit=50&offset=0
GET /api/admin/comments?post_id=<id>&limit=200
GET /api/admin/likes?post_id=<id>&limit=200
DELETE /api/likes/:id
```

管理端点赞明细仍包含 `client_id`、`author_email`（评论）等完整字段，仅供后台使用。

---

## 嵌入 Hugo 注意点

1. 对用户内容做 HTML 转义后再插入 DOM（防 XSS）
2. 动态点赞务必带 `X-Client-Id` 与 `author_name`；文章点赞见 [PAGE-LIKES.md](./PAGE-LIKES.md)，不要把管理员密码写进模板
3. 列表请使用 `limit` + `offset` 分页，避免一次拉全站
4. 完整交互示例见 [`examples/hugo-embed.html`](../examples/hugo-embed.html) 与 [`examples/page-like.html`](../examples/page-like.html)

---

## 错误码参考

| HTTP | 常见原因 |
|------|----------|
| 400 | 参数非法、空内容、非法 URL、导入缺少 confirm 等 |
| 401 | 账号或密码错误、未登录 / token 过期、尚未初始化 |
| 403 | 文章点赞未启用 |
| 404 | 动态或记录不存在 |
| 409 | 站点已初始化（重复 setup） |
| 411 | 写接口缺少 `Content-Length` |
| 413 | 请求体过大 |
| 500 | 服务器异常 |
