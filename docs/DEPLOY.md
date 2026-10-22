# AIOVTUE-memos 部署教程

以 Cloudflare 控制台为主，也可完全用命令行。相关：[API](./API.md) · [README](../README.md) · [安全说明](./SECURITY.md)

控制台：[https://dash.cloudflare.com](https://dash.cloudflare.com)

管理员账号、跨域、Resend Key、WebDAV 密码都写在 **D1**（设置页）。加密默认用库内 `admin_token_secret`；生产建议额外配置 Worker Secret `SECRET_ENCRYPTION_KEY`（密钥不进 D1，见 [SECURITY.md](./SECURITY.md)）：

```bash
npx wrangler secret put SECRET_ENCRYPTION_KEY
```

---

## 准备

| 项目 | 说明 |
|------|------|
| Cloudflare 账号 | [注册](https://dash.cloudflare.com/sign-up) |
| GitHub 账号 | 导入仓库自动构建 |
| 本仓库 | 推送到远程 |

Worker / D1 配置名：`aiovtue-memos`（须与 Dashboard、`wrangler.jsonc` 一致）。

---

## 总览

```text
① Fork / 克隆后：把 wrangler.jsonc 的 database_id 换成你自己的（仓库里必须是占位符，勿提交真实 ID）
② 创建 D1，执行全部迁移（0001–0017）
③ 导入仓库部署 Worker（会带上每天一次的 Cron）
④ 立刻打开网站完成管理员初始化
⑤ 生产填写 CORS；可选：SECRET_ENCRYPTION_KEY、邮件、文章点赞、WebDAV、自定义域名
```

---

## 第一步：代码放到 GitHub

```bash
git remote add origin https://github.com/你的用户名/AIOVTUE-memos.git
git push -u origin main
```

或网页新建仓库后上传。不要提交 `node_modules/`、`.wrangler/`、`.dev.vars`、真实 `database_id`。

---

## 第二步：创建 D1

1. Dashboard → **Storage & Databases** → **D1** → **Create**
2. 名称用 `aiovtue-memos`（须与 `wrangler.jsonc` 的 `database_name` 一致）
3. 复制 **Database ID**

```text
database_name = aiovtue-memos
database_id   = xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

---

## 第三步：迁移（建表）

必须跑完 `migrations/` 下 **全部** SQL（目前 `0001_init.sql` … `0017_mail_templates.sql`）。只跑 `0001` 会缺管理员字段、跨域、文章点赞、WebDAV、邮件记录等。

**推荐（命令行）：**

```bash
npx wrangler login
npm run db:migrate:remote
```

本地预览：

```bash
npm run db:migrate:local
```

**仅用网页 Console（不推荐）：** 按文件名顺序执行每一个 `.sql`（`0001` → `0017`）。某条提示「已存在」可跳过该文件。迁移文件已不含 `--` 注释，避免网页把换行收成一行后整段被注释掉。仍更推荐命令行 `npm run db:migrate:remote`。`0004`–`0006` 为占位（`SELECT 1`），可跳过。

---

## 第四步：写入 database_id

编辑 [`wrangler.jsonc`](../wrangler.jsonc)：

```jsonc
{
  "name": "aiovtue-memos",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "aiovtue-memos",
      "database_id": "这里粘贴你的 D1 UUID",
      "migrations_dir": "migrations"
    }
  ]
}
```

`name` 必须是 `aiovtue-memos`。Commit 后部署。

---

## 第五步：部署 Worker

1. Dashboard → **Workers & Pages** → 导入本仓库
2. **Project / Worker name**：`aiovtue-memos`
3. Build：`npm ci`；Deploy：`npx wrangler deploy`
4. Bindings 确认 **D1 → `DB`** 指向上述数据库
5. 部署成功后地址类似：

```text
https://aiovtue-memos.<你的子域>.workers.dev
```

配置里已有 Cron：每天 **18:00 UTC**（北京时间次日 02:00）检查 WebDAV 备份周期。未启用备份则空跑。改 Cron 后需重新部署。

---

## 第六步：立刻初始化管理员

打开 `/` 或 `/settings.html` 创建账号（密码至少 6 位）。**未初始化时任何人都可以调用 `POST /api/auth/setup`。**

然后按需在设置页填写：

| 项 | 说明 |
|----|------|
| 跨域 | 博客 Origin，逗号分隔，不要路径。留空 = 允许任意来源（仅调试） |
| 评论邮件 | Resend API Key、管理员邮箱、发件地址 |
| 文章点赞 | 开关；Hugo 接入见 [PAGE-LIKES.md](./PAGE-LIKES.md) |
| WebDAV | 见 [WEBDAV.md](./WEBDAV.md) |

不要把管理员密码写进公开的 Hugo 模板。

---

## 第七步：验收

| 地址 | 预期 |
|------|------|
| `/api/health` | `{"ok":true,"service":"AIOVTUE-memos","initialized":true}` |
| `/` | 动态页 |
| `/settings.html` | 设置页 |

试：改昵称 → 发一条动态 → 首页能看到。

---

## 自定义域名（可选）

Worker → **Domains** → 绑定已在 Cloudflare 的域名。Hugo 若不同源，把该 Origin 写入 CORS。

---

## 日常更新

Git 推送后 Cloudflare 自动构建。有新 SQL 时再执行 `npm run db:migrate:remote`（或 Console 跑新文件）。

改密码：设置页「管理员账号」。改密码后其它设备上的旧 token 立即失效。

---

## 上线检查清单

- [ ] 已执行全部 D1 迁移（含 `page_likes`、WebDAV 设置键）
- [ ] 部署用的 `wrangler.jsonc` 已填你自己的 `database_id`（勿把生产 ID 推上公开仓库），`name` 为 `aiovtue-memos`
- [ ] 绑定 `DB` 正确
- [ ] **已初始化管理员**
- [ ] 生产已限制 CORS Origin
- [ ] `/api/health`、`/`、`/settings.html` 正常
- [ ] 未提交 `.dev.vars`、明文密码、真实 `database_id`
- [ ]（可选）`SECRET_ENCRYPTION_KEY` / Resend / WebDAV / 文章点赞

---

## 常见问题

**Worker name 不匹配**  
Dashboard 名称必须等于 `aiovtue-memos`。

**提示尚未初始化**  
完成 setup。不会清空动态。

**500 / 缺表**  
Bindings 是否有 `DB`；迁移是否跑到 `0017`。

**CORS**  
设置页填完整 Origin，如 `https://blog.example.com`。

**文章点赞写失败**  
博客不要塞管理员密码。演示页先登录本站。见 [PAGE-LIKES.md](./PAGE-LIKES.md)。

---

## 附录：纯命令行

```bash
npm install
# 编辑 wrangler.jsonc 的 database_id
npx wrangler login
npm run db:migrate:remote
npm run deploy
```

本地：

```bash
npm run db:migrate:local
npm run dev
# http://127.0.0.1:8787
```

与 Hugo 联调：记下 Worker 地址 → CORS 填博客 → 见 [PAGE-LIKES.md](./PAGE-LIKES.md) 与 [hugo-embed.html](../examples/hugo-embed.html)。设置页「导出」可得到 `content/moments/`。
