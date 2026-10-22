# WebDAV 备份

把动态 JSON 备份到坚果云、Nextcloud 等 WebDAV 网盘。设置写在 D1，密码加密存储。远端只保留最近 **3** 个 `AIOVTUE-memos-*.json`（也会清理旧前缀 `hugo-memos-*.json`）。

## 设置页

在 `/settings.html`「动态导入 / 导出」下方 **WebDAV 备份**：

| 项 | 说明 |
|----|------|
| 服务器地址 | `https://` 或 `http://` 的 WebDAV 根，不要带账号密码 |
| 用户名 / 密码 | 网盘账号；密码加密入库，界面只显示已保存 |
| 目录 | 默认 `AIOVTUE-memos` |
| 周期 | 每天 / 每周 / 每月 |
| 启用自动备份 | 打开后由 Cron 按周期上传 |
| 立即备份 | 马上传一份（本地预览也可用） |

保存后再点「立即备份」，或等定时任务。

## 定时任务

`wrangler.jsonc` 中 Cron 为每天 **18:00 UTC**（北京时间次日 02:00）检查一次。不到周期会跳过。必须 **部署到 Cloudflare** 后 Cron 才生效；`wrangler dev` 不会按点备份。

## 接口

```http
POST /api/admin/webdav-backup
Authorization: Bearer <token>
Content-Type: application/json

{
  "url": "https://dav.example.com/dav",
  "username": "可选，覆盖已保存",
  "password": "可选；全 * 表示沿用已保存",
  "folder": "AIOVTUE-memos"
}
```

也可不传 body 字段，完全用库里已保存的配置。

备份文件格式：`aiovtue-memos-posts` JSON，含 `posts[]`（`id`、`content`、`images`、`created_at`、`updated_at`），可用设置页「导入」的 `posts` 数组恢复。

## 注意

- 不要填内网 / `127.0.0.1`：Worker 访问不到，也会被拒绝。
- 地址不要带 `user:pass@`。
- 备份会把动态明文传到你填的主机；填错成他人服务器等于泄露内容。
