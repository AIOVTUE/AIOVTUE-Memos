# 安全说明

面向自己部署的运维注意点，不是渗透报告。

## 必须立刻做

1. **部署后马上初始化管理员。** `GET /api/health`、`GET /api/auth/status` 会显示是否已初始化。未初始化时 `POST /api/auth/setup` 公开可调用，先到者成为管理员。
2. **生产填写 CORS Origin。** 留空表示 `Access-Control-Allow-Origin: *`，任意网站可跨域发评论、给动态点赞。
3. **不要把管理员密码写进 Hugo / 公开 HTML。** 文章点赞写接口可用 **本站登录后的 Bearer token**；读计数是公开的。详见 [PAGE-LIKES.md](./PAGE-LIKES.md)。

## 账号与会话

- Token 存在浏览器 `sessionStorage`，请求头 `Authorization: Bearer`，有效约 24 小时。
- 修改管理员密码会作废全部旧 token；当前设置页会自动换新 token。
- 登录失败会走完整密码校验（防用户名枚举时的时间差），没有验证码或锁定。

## 数据与密钥

- Resend API Key、WebDAV 密码在 D1 中 AES-GCM 加密（`enc:v1:`）。优先用 Worker Secret `SECRET_ENCRYPTION_KEY`（不进 D1）；未配置时回退到 `admin_token_secret`，**此时 D1 备份泄露 ≈ 可解密**。改管理员密码会轮换 token secret，并自动重加密上述密钥。
- 管理员登录密码只存 PBKDF2 哈希；动态正文、评论、邮箱等业务数据为明文（便于列表查询），靠 Cloudflare 账户与 D1 权限保护。
- 公开 `GET /api/settings` 不含邮箱、CORS、WebDAV、密钥。
- 公开评论不含 `author_email`；公开点赞名单不含 `client_id`。

## 接口限制

- 非 GET 的 `/api/*` 需要合法 `Content-Length`，正文上限约 5MB。
- 图片 / 链接仅 `http(s)` 或站内路径，拒绝 `javascript:` 等。
- 页面 HTML 带 CSP（`script-src 'self'`）。Hugo 引用 `/js/page-like.js` 不受本站 CSP 约束，由博客自己的策略决定。

## 产品取舍（不会当漏洞修）

- 动态点赞、发评论默认公开可写（靠 CORS 收紧来源）。
- 评论通知：评论者邮箱不是管理员邮箱时通知管理员；回复会通知被回复者留下的邮箱。评论者填的是管理员邮箱时不给管理员重复发。同一邮箱只发一封。
- WebDAV 会向你配置的地址发送 Basic 认证和动态备份，请只填自己的网盘。

## 开源 / 公开仓库前请核对

**不要提交：**

| 项 | 说明 |
|----|------|
| `.dev.vars`、`.env*` | 已在 `.gitignore`；勿强制 `git add -f` |
| `.wrangler/` | 含本地 D1 sqlite，可能有你的管理员哈希与动态 |
| 真实 `database_id` | `wrangler.jsonc` 仓库中必须保持 `<YOUR_D1_DATABASE_ID>`；部署时在本地或 CI 私密配置里替换 |
| Resend Key、WebDAV 密码、管理员密码 | 只写在你自己的 D1 / 设置页 / Worker Secrets |
| 设置页导出的 JSON、邮件日志 | 可能含私人动态与邮箱 |

**可以公开（本仓库现状）：**

- 源码、迁移、示例 HTML、`scripts/seed-local-demo.sql`（虚构演示文案 + Unsplash 图）
- 默认昵称 `AIOVTUE-雪`、站内头像 / 封面 / favicon（品牌素材；若含不愿公开的真人肖像请先替换再推送）
- 文档中的占位域名 `aiovtue-memos.xxx.workers.dev`、`you@example.com` 等

`scripts/` 仅用于本地；**禁止**对远程 D1 执行 seed。
