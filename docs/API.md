# AIOVTUE-memos API 使用教程

本文与当前代码对齐，说明如何调用 JSON API。默认本地：`http://127.0.0.1:8787`，生产换成你的 Worker 域名。

相关：[部署教程](./DEPLOY.md) · [项目说明](../README.md) · [文章点赞](./PAGE-LIKES.md) · [WebDAV](./WEBDAV.md) · [安全说明](./SECURITY.md)

---

## 基址

| 环境 | 根地址 | 接口 |
|------|--------|------|
| 本地 | `http://127.0.0.1:8787` | `http://127.0.0.1:8787/api/...` |
| 生产 | `https://aiovtue-memos.<子域>.workers.dev` 或自定义域名 | 同上拼 `/api/...` |

Hugo 等嵌入时填**站点根**（不要带 `/api`）。

### 请求限制

- 非 `GET` / `HEAD` / `OPTIONS` 必须带合法 `Content-Length`
- JSON 正文上限约 **5MB**（超限 `413`；缺长度 `411`）
- 允许的跨域头：`Content-Type`、`Authorization`、`X-Client-Id`

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

部分接口另有顶层字段：`meta`、`token`、`expires_in`、`liked`、`like_count`、`likers`、`message`、`setup_required` 等。

时间戳均为 **毫秒**。

### 鉴权

管理接口请求头：

```http
Authorization: Bearer <token>
```

Token 约 **24 小时**有效；修改管理员密码后全部旧 token 作废。

```http
POST /api/auth/login
Content-Type: application/json

{ "username": "admin", "password": "你的管理密码" }
```

```json
{
  "ok": true,
  "token": "....",
  "expires_in": 86400,
  "data": { "username": "admin" }
}
```

账号规则：2–32 位字母、数字、`.`、`_`、`-`。密码最长 128；初始化 / 改密至少 **6** 位。

首次部署（尚无管理员）只能调用一次 setup，**只写账号，不清空动态**：

```http
POST /api/auth/setup
Content-Type: application/json

{ "username": "admin", "password": "至少6位" }
```

| 接口 | 说明 |
|------|------|
| `GET /api/auth/status` | `{ "data": { "initialized": true } }` |
| `GET /api/auth/verify` | 校验 token；返回 `{ "data": { "username" } }` |
| `PUT /api/admin/account` | body：`username`、`current_password`、可选 `new_password`；改密时响应带新 `token` |

### 访客标识

动态点赞、文章点赞需要稳定客户端 ID：

```http
X-Client-Id: 550e8400-e29b-41d4-a716-446655440000
```

也可在 JSON 传 `client_id`（与 Header 二选一，优先 body）。格式：8–64 位 `[A-Za-z0-9._-]`。

### CORS

设置项 `cors_origins` 为空 → `Access-Control-Allow-Origin: *`。  
生产请填博客 Origin（逗号分隔、不要路径），见 [DEPLOY](./DEPLOY.md) / [SECURITY](./SECURITY.md)。

### URL 规则

图片、头像、封面仅允许 `http(s):` 或站内路径（如 `/img/toux.webp`）。  
评论主页链接仅 `http(s):`。`javascript:` / `data:` 等会拒绝或丢弃。每条动态最多 **9** 张图。

---

## 接口一览

| 权限 | 方法 | 路径 | 说明 |
|------|------|------|------|
| 公开 | GET | `/api/health` | `{ ok, service: "AIOVTUE-memos", initialized }` |
| 公开 | GET | `/api/auth/status` | 是否已初始化 |
| 公开 | POST | `/api/auth/setup` | 首次创建管理员（仅一次） |
| 公开 | POST | `/api/auth/login` | 登录拿 token |
| 管理 | GET | `/api/auth/verify` | token 是否有效 |
| 管理 | PUT | `/api/admin/account` | 改账号 / 密码 |
| 公开 | GET | `/api/settings` | 公开站点资料；带 Bearer 时返回管理视图 |
| 管理 | PUT | `/api/settings` | 更新设置 |
| 管理 | POST | `/api/admin/notify-test` | 发测试邮件 |
| 管理 | GET | `/api/admin/mail-log` | 已发送邮件列表 |
| 管理 | POST | `/api/admin/webdav-backup` | 立即 WebDAV 备份 |
| 公开 | GET | `/api/posts` | 动态列表（分页；每条最多附带 80 条评论） |
| 公开 | GET | `/api/posts/:id` | 单条（评论最多 200） |
| 管理 | POST | `/api/posts` | 发动态 |
| 管理 | PUT | `/api/posts/:id` | 编辑动态 |
| 管理 | DELETE | `/api/posts/:id` | 删动态 |
| 管理 | GET | `/api/posts/export` | 导出 Hugo Markdown |
| 管理 | POST | `/api/posts/import` | 导入动态 |
| 公开 | POST | `/api/posts/:id/likes` | 点赞 |
| 公开 | DELETE | `/api/posts/:id/likes` | 取消赞 |
| 公开 | GET | `/api/posts/:id/comments` | 评论列表（最多 200） |
| 公开 | POST | `/api/posts/:id/comments` | 发评论 / 回复 |
| 管理 | DELETE | `/api/comments/:id` | 删评论（含直接子回复） |
| 管理 | GET | `/api/admin/comment-posts` | 有评论的动态 |
| 管理 | GET | `/api/admin/like-posts` | 有点赞的动态 |
| 管理 | GET | `/api/admin/page-likes` | 文章点赞汇总 |
| 管理 | GET | `/api/admin/comments` | 评论明细（含 `author_email`） |
| 管理 | GET | `/api/admin/likes` | 点赞明细（含 `client_id`） |
| 管理 | DELETE | `/api/likes/:id` | 按记录删点赞 |
| 公开 | GET | `/api/page-likes` | 博客文章点赞计数 |
| 管理* | POST | `/api/page-likes` | 文章点赞（须启用） |
| 管理* | DELETE | `/api/page-likes` | 取消文章点赞 |

`*` 须打开「启用文章点赞」。写操作：Bearer **或** JSON `password`。不要把密码写进公开博客。详见 [PAGE-LIKES.md](./PAGE-LIKES.md)。

分页通用：`limit`（多数接口默认 20、最大 50；管理端若干接口默认 50、最大 200；`mail-log` 默认 50、最大 100）、`offset`（从 0 起）。

---

## 动态

### 列表

```http
GET /api/posts?limit=10&offset=0
X-Client-Id: <可选，用于返回 liked>
```

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

- 公开 `likers` **不含** `client_id`
- 公开评论 **不含** `author_email`
- 列表每条最多附带 **80** 条评论（`comment_count` 仍为总数）

```js
async function loadPage(offset = 0, limit = 10) {
  const res = await fetch(
    `https://aiovtue-memos.xxx.workers.dev/api/posts?limit=${limit}&offset=${offset}`,
    { headers: { "X-Client-Id": localStorage.clientId } },
  );
  return res.json();
}
```

### 单条 / 发布 / 编辑 / 删除

```http
GET /api/posts/:id
X-Client-Id: <可选>
```

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
- `created_at` 可选（毫秒）

```http
PUT /api/posts/:id
Authorization: Bearer <token>
Content-Type: application/json

{ "content": "修改后的正文", "images": [], "created_at": 1712319000000 }
```

```http
DELETE /api/posts/:id
Authorization: Bearer <token>
```

删除会连带该动态下的评论与点赞。

---

## 动态点赞

```http
POST /api/posts/:id/likes
X-Client-Id: <必填>
Content-Type: application/json

{ "author_name": "小明" }
```

同一 `client_id` 重复点赞会更新昵称（upsert），不重复计数。

```http
DELETE /api/posts/:id/likes
X-Client-Id: <必填>
Content-Type: application/json

{}
```

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

### 列表 / 发表

```http
GET /api/posts/:id/comments
```

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

- 公开响应不含 `author_email`
- `parent_id` 必须属于同一动态
- 单帖公开列表最多 **200** 条
### 邮件通知

评论成功后异步经 **Resend** 发送（失败不影响评论接口）：

| 场景 | 通知谁 |
|------|--------|
| 评论者邮箱 ≠ 管理员邮箱（含未填邮箱） | 管理员邮箱 |
| 评论者邮箱 = 管理员邮箱 | **不**通知管理员 |
| 回复他人（对方有有效邮箱） | 被回复者 |
| 自己回复自己 | **不**给自己发 |
| 收件人邮箱相同 | 只发一封（去重） |

是否跳过管理员通知，以评论里的 **`author_email` 是否等于设置中的 `admin_email`**（忽略大小写）为准。被回复通知发往对方评论时留下的邮箱。

条件：`notify_enabled` ≠ `"0"`，且配置了 `mail_from`、Resend API Key；管理员通知还需 `admin_email`。

#### 可自定义模板

| 设置键 | 用途 |
|--------|------|
| `mail_tpl_comment_subject` / `mail_tpl_comment_body` | 发给管理员（评论模板） |
| `mail_tpl_reply_subject` / `mail_tpl_reply_body` | 发给被回复者（回复模板） |

变量：`{{site_title}}`、`{{nickname}}`、`{{author}}`、`{{content}}`、`{{post}}`、`{{link}}`、`{{parent_author}}`、`{{event}}`（`新评论` 或 `回复 @昵称`）。留空则用内置默认。主题不可含换行；正文最长约 4000 字。

默认主题示例：

- 评论：`【{{site_title}}】{{event}}：{{author}}`
- 回复：`【{{site_title}}】{{author}} 回复了你`

成功发出的邮件会写入 `mail_log`（见下方管理接口）。

### 删除（管理）

```http
DELETE /api/comments/:id
Authorization: Bearer <token>
```

删除该评论及其**直接回复**。

---

## 博客文章点赞

步骤与 Hugo 接入见 **[PAGE-LIKES.md](./PAGE-LIKES.md)**。身份只用 **URL 路径**（忽略域名、查询串、hash）。

```http
GET /api/page-likes?url=https://blog.example.com/posts/hello/
X-Client-Id: <可选>
```

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

也可 JSON 传 `password`（管理员登录密码），勿放进公开 HTML。`DELETE` 字段相同。未启用 → `403`「文章点赞未启用」。

脚本：[`/js/page-like.js`](../public/js/page-like.js)，示例 [`examples/page-like.html`](../examples/page-like.html)。

---

## 站点设置

### 读取

```http
GET /api/settings
```

| 视图 | 字段 |
|------|------|
| 公开（无 Token） | `nickname`、`avatar`、`cover`、`site_title`、`site_description` |
| 管理（Bearer） | 另含邮件、CORS、文章点赞开关、WebDAV 非密码字段、邮件模板、`webdav_last_*` 等；`meta.resend_configured`、`meta.webdav_password_configured` |

永不回传：`resend_api_key`、`webdav_password`、密码哈希、token secret 等明文。

默认头像 `/img/toux.webp`，默认封面 `/hero/hero-1.mp4`。

### 更新

```http
PUT /api/settings
Authorization: Bearer <token>
Content-Type: application/json

{
  "nickname": "AIOVTUE-雪",
  "avatar": "/img/toux.webp",
  "cover": "/hero/hero-1.mp4",
  "site_title": "动态",
  "notify_enabled": "1",
  "admin_email": "you@example.com",
  "mail_from": "onboarding@resend.dev",
  "mail_from_name": "动态通知",
  "site_url": "https://aiovtue-memos.xxx.workers.dev",
  "cors_origins": "https://blog.example.com",
  "page_likes_enabled": "0",
  "mail_tpl_comment_subject": "【{{site_title}}】{{event}}：{{author}}",
  "mail_tpl_comment_body": "…",
  "mail_tpl_reply_subject": "【{{site_title}}】{{author}} 回复了你",
  "mail_tpl_reply_body": "…",
  "webdav_enabled": "0",
  "webdav_url": "https://dav.example.com/dav",
  "webdav_username": "",
  "webdav_folder": "AIOVTUE-memos",
  "webdav_interval": "daily"
}
```

可写字段还包括：`site_description`、`resend_api_key` / `clear_resend_api_key: true`、`webdav_password` / `clear_webdav_password: true`。密钥留空表示保持原值；全 `*` 占位不覆盖。

`webdav_interval`：`daily` | `weekly` | `monthly`。

---

## 邮件管理接口

### 测试邮件

```http
POST /api/admin/notify-test
Authorization: Bearer <token>
Content-Type: application/json

{
  "admin_email": "可选，覆盖已保存收件人",
  "mail_from": "可选",
  "mail_from_name": "可选",
  "site_title": "可选",
  "site_url": "可选",
  "resend_api_key": "可选一次性 Key"
}
```

成功：`{ "ok": true, "message": "测试邮件已发送至 …" }`（会记入 `mail_log`）。  
测试信使用固定文案，不走评论/回复模板。

### 已发送列表

```http
GET /api/admin/mail-log?limit=50&offset=0
Authorization: Bearer <token>
```

```json
{
  "ok": true,
  "data": [
    { "id": "…", "to_email": "you@example.com", "sent_at": 1712319000000 }
  ],
  "meta": { "total": 12, "limit": 50, "offset": 0 }
}
```

仅含收件人与发件时间。库内约保留最近 **500** 条。设置页侧边栏「邮件记录」使用此接口。

---

## 导入 / 导出

### 导出 Hugo Markdown

```http
GET /api/posts/export
Authorization: Bearer <token>
```

返回 JSON，含 `files[]`（路径 + 文本），前端可打 zip：

```
content/moments/_index.md
content/moments/26-9-6.md
…
```

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

### WebDAV 立即备份

详见 **[WEBDAV.md](./WEBDAV.md)**。

```http
POST /api/admin/webdav-backup
Authorization: Bearer <token>
Content-Type: application/json

{
  "url": "https://dav.example.com/dav",
  "username": "可选",
  "password": "可选；全 * 沿用已保存",
  "folder": "AIOVTUE-memos"
}
```

不传字段则用库中已保存配置。备份 JSON 格式名 `aiovtue-memos-posts`，可用导入的 `posts` 恢复。远端最多保留 **3** 个备份文件。

---

## 管理端明细

均需 Bearer。多数 `limit` 默认 50、最大 200。

```http
GET /api/admin/comment-posts?limit=100&offset=0
GET /api/admin/like-posts?limit=100&offset=0
GET /api/admin/page-likes?limit=50&offset=0
GET /api/admin/comments?post_id=<id>&limit=200
GET /api/admin/likes?post_id=<id>&limit=200
GET /api/admin/mail-log?limit=50&offset=0
DELETE /api/likes/:id
```

| 接口 | 主要字段 |
|------|----------|
| `comment-posts` | `id`、`content`、`comment_count`、`last_at` |
| `like-posts` | `id`、`content`、`like_count`、`last_at` |
| `page-likes` | `path`、`like_count`、`updated_at` |
| `comments` | 含 `author_email`、`post_excerpt` 等 |
| `likes` | 含 `client_id`、`author_name`、`post_excerpt` 等 |
| `mail-log` | `id`、`to_email`、`sent_at` |

---

## 嵌入 Hugo 注意点

1. 用户内容插入 DOM 前做 HTML 转义
2. 动态点赞带 `X-Client-Id` 与 `author_name`；文章点赞见 [PAGE-LIKES.md](./PAGE-LIKES.md)，勿写管理员密码
3. 列表用 `limit` + `offset` 分页
4. 示例：[`examples/hugo-embed.html`](../examples/hugo-embed.html)、[`examples/page-like.html`](../examples/page-like.html)

---

## 错误码参考

| HTTP | 常见原因 |
|------|----------|
| 400 | 参数非法、空内容、非法 URL、导入缺 confirm、邮件/WebDAV 配置错误等 |
| 401 | 账号或密码错误、未登录 / token 过期、尚未初始化、文章点赞密码错误 |
| 403 | 文章点赞未启用 |
| 404 | 动态、评论、点赞或接口不存在 |
| 409 | 站点已初始化（重复 setup） |
| 411 | 写接口缺少 `Content-Length` |
| 413 | 请求体过大 |
| 500 | 服务器异常 |
| 503 | 本地 D1 尚未建表（提示执行 `npm run db:migrate:local`） |
