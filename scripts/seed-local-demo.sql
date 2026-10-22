-- 仅本地演示数据。禁止 wrangler d1 execute ... --remote
-- npx wrangler d1 execute aiovtue-memos --local --file=./scripts/seed-local-demo.sql

DELETE FROM likes WHERE post_id LIKE 'demo_%';
DELETE FROM comments WHERE post_id LIKE 'demo_%';
DELETE FROM posts WHERE id LIKE 'demo_%';

-- ~2026-10-05 local seed times (ms)
INSERT INTO posts (id, content, images, created_at, updated_at) VALUES
(
  'demo_001',
  '早上好。窗边有一点薄雾，咖啡刚好温热。

今天想把页面再打磨一点细节——**滚动阻尼**、*邮件通知*，都慢慢补齐。

- 支持基本 Markdown
- 本地预览可直接试用

> 缓慢本身，就是一种勇气。

代码示例：`npm run dev`',
  '[]',
  1759624800000,
  1759624800000
),
(
  'demo_002',
  '路过一条小巷，墙上的爬山虎已经开始变色。

随手记下：秋天适合散步，也适合发一条短动态。',
  '["https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=960&q=80"]',
  1759538400000,
  1759538400000
),
(
  'demo_003',
  '试了一下多图排版。

第一张偏冷，第二张偏暖——像两段不同的午后。',
  '["https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=960&q=80","https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=960&q=80"]',
  1759452000000,
  1759452000000
),
(
  'demo_004',
  '读到一句喜欢的话：

> 缓慢本身，就是一种勇气。

先记在这里，晚点再展开写。',
  '[]',
  1759365600000,
  1759365600000
),
(
  'demo_005',
  '本地预览用的演示动态。

可以用管理密码登录后编辑 / 删除它们；不影响线上数据。',
  '["https://images.unsplash.com/photo-1472214103451-9374bd1c798e?w=960&q=80","https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=960&q=80","https://images.unsplash.com/photo-1465146633011-14f8e0781093?w=960&q=80"]',
  1759279200000,
  1759279200000
);

INSERT INTO comments (id, post_id, parent_id, author_name, author_email, author_url, content, created_at) VALUES
(
  'demo_c_001',
  'demo_002',
  '',
  '路人甲',
  '',
  '',
  '这光看起来好舒服。',
  1759542000000
),
(
  'demo_c_002',
  'demo_002',
  'demo_c_001',
  'AIOVTUE-雪',
  '',
  '',
  '是呀，那天风也刚好。',
  1759545600000
),
(
  'demo_c_003',
  'demo_004',
  '',
  '阿茶',
  '',
  '',
  '收藏了，慢慢读。',
  1759370000000
);

INSERT INTO likes (id, post_id, client_id, author_name, created_at) VALUES
('demo_l_001', 'demo_001', 'demo_client_a', '访客A', 1759628000000),
('demo_l_002', 'demo_001', 'demo_client_b', '访客B', 1759630000000),
('demo_l_003', 'demo_002', 'demo_client_a', '访客A', 1759540000000),
('demo_l_004', 'demo_003', 'demo_client_c', '访客C', 1759455000000),
('demo_l_005', 'demo_005', 'demo_client_a', '访客A', 1759282000000);
