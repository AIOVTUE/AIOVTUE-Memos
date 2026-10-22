<p align="center">
  <a href="https://aiovtue.yybb.us/memos/overview">
    <img src="https://aiovtue.yybb.us/logo.webp" width="92" alt="AIOVTUE-Memos logo" />
  </a>
</p>

<h1 align="center">AIOVTUE-Memos</h1>

<p align="center">
  <strong>AIOVTUE-Memos 是一个朋友圈动态项目，支持网页和api调用，轻松接入你的博客站点</strong>
</p>
<p align="center">
  这是一个动态的朋友圈项目，支持api调用动态数据，接入博客网站后可以再不重新部署的情况下实时更新自己的动态数据文件，同时能够给文章增加点赞的功能
</p>
<p align="center">
  <a href="https://daily.yybb.us/moments/">前往预览</a> ·
  <a href="https://aiovtue.yybb.us/memos/overview">文档</a> ·
  <a href="###快速开始">快速开始</a> ·
  <a href="###使用教程">使用教程</a> 
</p>
<p align="center">⭐ 如果 AIOVTUE-Memos 对你有帮助，欢迎<a href="https://github.com/AIOVTUE/AIOVTUE-CMS-gen">点个 Star</a>。</p>
---
### 简介
*AIOVTUE-Memos*  是一个动态的朋友圈项目，支持api调用动态数据，接入博客网站后可以再不重新部署的情况下实时更新自己的动态数据文件，AIOVTUE-Memos  提供动态页面数据与文章点赞相关 API，也可单独访问动态站点，整个项目完全托管于cloudflare，使用D1作为数据库，线上预览：[https://dongtai.yybb.us/](https://dongtai.yybb.us/)
### 界面预览
![](https://aiovtue.yybb.us/memos/2.webp)
![](https://aiovtue.yybb.us/memos/3.webp)
### 部署
接下来带大家进行部署，首先需要准备cloudflare账号和github仓库，前往开源地址fork仓库，[点我跳转开源地址](https://github.com/AIOVTUE/AIOVTUE-Memos)
### 总览
```text
① Fork / 克隆后：把 wrangler.jsonc 的 database_id 换成你自己的
② 创建 D1，执行全部迁移（0001–0017）
③ 导入仓库部署 Worker
④ 立刻打开网站完成管理员初始化
⑤ 生产填写 CORS；可选：SECRET_ENCRYPTION_KEY、邮件、文章点赞、WebDAV、自定义域名
```
#### 第一步：代码放到 GitHub
前往开源地址fork仓库，[点我跳转开源地址](https://github.com/AIOVTUE/AIOVTUE-Memos)
![](https://aiovtue.yybb.us//memos/5.webp)

#### 第二步：创建 D1
登陆cloudflare后，点击侧边栏的D1数据库部分，新建一个数据库，名称`aiovtue-memos`
![](https://aiovtue.yybb.us//memos/6.webp)

创建完成后会展示数据库id，就是图片中这个，先复制出来，后面会用到
![](https://aiovtue.yybb.us//memos/7.webp)

接着将之前fork的仓库下载到本地，或者直接在github编辑也可以，编辑`wrangler.jsonc`文件中的数据库id，修改为刚才复制的id即可，即编辑下面这部分
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
![](https://aiovtue.yybb.us//memos/8.webp)

#### 第三步：迁移（建表）
在cloudflare的数据库控制台中运行迁移命令建表，必须跑完 `migrations/`目录下 **全部** SQL，具体方式就是，使用文本软件按顺序依次打开sql文件并复制里面的内容，在控制台处粘贴后运行即可，按顺序全部粘贴运行一遍即可，例如打开`0001_init.sql`后，复制内容如下：
```
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('nickname', 'AIOVTUE-雪'),
  ('avatar', '/img/toux.mp4'),
  ('cover', '/hero/hero-1.mp4'),
  ('site_title', '动态'),
  ('site_description', '记录生活的点滴'),
  ('bio', '');

-- 动态
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL DEFAULT '',
  images TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);

-- 评论
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  parent_id TEXT NOT NULL DEFAULT '',
  author_name TEXT NOT NULL,
  author_email TEXT NOT NULL DEFAULT '',
  author_url TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_created_at ON comments(created_at);
CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_id);

-- 点赞（client_id 标识访客，无需登录）
CREATE TABLE IF NOT EXISTS likes (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  author_name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  UNIQUE(post_id, client_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_likes_post_id ON likes(post_id);

```
然后打开cloudflare，找到数据库控制台，粘贴后运行即可
![](https://aiovtue.yybb.us//memos/9.webp)

或者，你也可以使用命令行迁移，这个会比较方便，但是可能会需要一些网络环境，大家看着来吧，打开终端后输入如下命令登陆和迁移即可
```bash
npx wrangler login
npm run db:migrate:remote
```

#### 第五步：部署 Worker
大家修改完之后先将仓库保存到github，当然你直接选择本地文件也行其实，但是为了方便管理还是建议上传，然后来到cloudflare中新建worker，记住是`worker`不是`pages`，然后选择自己的对应仓库文件即可，直接点击部署即可，不需要其他配置
![](https://aiovtue.yybb.us//memos/10.webp)
![](https://aiovtue.yybb.us//memos/11.webp)

#### 自定义域名
Worker → **Domains** → 绑定已在 Cloudflare 的域名, 这里不赘述

#### 初始化
到这里其实已经部署完成了，配置一个域名即可访问了，打开域名，进入网站会提示需要初始化，就是设置账号密码之类的，按需填写即可
![](https://aiovtue.yybb.us//memos/12.webp)

然后按需在设置页填写：

| 项 | 说明 |
|----|------|
| 跨域 | 博客 Origin，逗号分隔，不要路径，留空 = 允许任意来源（仅调试） |
| 评论邮件 | Resend API Key、管理员邮箱、发件地址 |
| 文章点赞 | 开关 |


