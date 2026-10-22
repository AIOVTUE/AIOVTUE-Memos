# AIOVTUE-memos

Cloudflare Workers + D1 上的朋友圈式动态：自带时间线和管理后台，也提供 JSON API，可挂到 Hugo 等静态博客。

Worker 名：`aiovtue-memos`。线上地址一般是 `https://aiovtue-memos.<你的子域>.workers.dev`（或自定义域名）。D1 实例在配置里仍叫 `hugo-memos`，与 Worker 名分开，换名不会换库。

## 功能

- 时间线：封面、头像、昵称、Markdown 图文、明暗主题
- 访客评论 / 点赞（`client_id` 标识，动态点赞无需登录）
- 设置页：站点资料、跨域、评论邮件（Resend）、文章点赞开关、导入导出、WebDAV 备份
- 博客文章点赞：按 URL **路径**计数，忽略域名
- 完整 REST API，可被 Hugo 或其他前端调用

## 仓库结构

| 路径 | 说明 |
|------|------|
| `src/` | Cloudflare Worker（Hono API、鉴权、邮件、WebDAV） |
| `public/` | 管理后台静态页与脚本 |
| `migrations/` | D1 迁移，部署时须全部执行 |
| `docs/` | 部署 / API / 安全等说明 |
| `examples/` | Hugo 嵌入与文章点赞示例（不进生产构建） |
| `scripts/` | **仅本地**：演示数据、接口自检；不要对远程 D1 执行 |

`wrangler.jsonc` 里的 `database_id` 是占位符。本地 `wrangler dev` 一般不依赖远程 ID；部署前换成你在 Dashboard 创建的 D1 ID。

## 文档

| 文档 | 说明 |
|------|------|
| [部署教程](docs/DEPLOY.md) | D1、迁移、Git 部署、上线检查 |
| [API 使用教程](docs/API.md) | 鉴权、动态 / 评论 / 点赞、导入导出、备份 |
| [文章点赞](docs/PAGE-LIKES.md) | 静态博客文章页点赞 |
| [WebDAV 备份](docs/WEBDAV.md) | 自动备份动态到网盘 |
| [安全说明](docs/SECURITY.md) | 初始化、跨域、密钥、不要公开管理员密码 |
| [嵌入示例](examples/hugo-embed.html) | 拉取动态列表 |
| [文章点赞示例](examples/page-like.html) | 文章页按钮 |

## 页面

| 路径 | 说明 |
|------|------|
| `/` | 动态时间线 |
| `/settings.html` | 管理设置（需初始化 / 登录） |
| `/page-like-demo` | 文章点赞演示（须先登录再点） |
| `/api/*` | JSON API |

## 快速开始

```bash
npm install
npm run db:migrate:local
# 可选：灌入本地演示动态（勿对 --remote 执行）
npx wrangler d1 execute hugo-memos --local --file=./scripts/seed-local-demo.sql
npm run dev
```

打开 [http://127.0.0.1:8787](http://127.0.0.1:8787)。没有管理员时会提示初始化。**只创建账号，不会清空已有动态。** 部署后请立刻完成初始化，避免别人抢先 `setup`。

生产部署见 **[部署教程](docs/DEPLOY.md)**。

## API 速览

基址：本地 `http://127.0.0.1:8787`，线上 `https://你的域名`。接口都在 `/api/...`。

```http
POST /api/auth/login
Content-Type: application/json

{ "username": "admin", "password": "你的管理密码" }
```

管理写操作：`Authorization: Bearer <token>`（约 24 小时；改密码后旧 token 失效）。  
动态点赞建议：`X-Client-Id: <稳定 UUID>`。

```http
GET /api/posts?limit=10&offset=0
GET /api/health
```

完整说明：[API 使用教程](docs/API.md)。

## 嵌入 Hugo

博客 Origin 填进设置页「跨域」。生产不要留空（留空 = 允许任意网站调 API）。

```html
<div id="memos-feed"></div>
<script type="module">
  const API = "https://aiovtue-memos.xxx.workers.dev";
  const escapeHtml = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const res = await fetch(`${API}/api/posts?limit=10`);
  const { data } = await res.json();
  document.getElementById("memos-feed").innerHTML = data
    .map(
      (p) =>
        `<article><p>${escapeHtml(p.content)}</p><small>${new Date(p.created_at).toLocaleString()}</small></article>`,
    )
    .join("");
</script>
```

更完整：[embed 示例](examples/hugo-embed.html)。文章点赞：[说明](docs/PAGE-LIKES.md) · [示例](examples/page-like.html)。**不要把管理员密码写进博客页面。**

## 开源前检查

详细清单见 [安全说明](docs/SECURITY.md)「开源 / 公开仓库前请核对」。摘要：

| 不要提交 | 仓库应保持 |
|----------|------------|
| `.dev.vars`、`.env`、`.wrangler/` | `wrangler.jsonc` 的 `database_id` 为 `<YOUR_D1_DATABASE_ID>` |
| 真实 D1 ID、Resend / WebDAV / 管理密码 | 示例域名用 `xxx.workers.dev` 等占位 |
| 导出的动态 JSON、含隐私的截图 | 默认昵称与 `public/img` 素材为你愿意公开的内容 |

Fork 后请立刻换成自己的 D1 ID 再部署；**不要把生产 ID 推回公开仓库。**

## 许可

[MIT](LICENSE)
