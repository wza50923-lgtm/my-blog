# 碎碎念页面 — 设计文档

- 日期：2026-08-30
- 项目：my-blog（Hexo + Keep 主题，部署 Netlify；数据走既有 Supabase）
- 状态：已确认（用户已拍板 4 项决策），待用户审阅本 spec 后进入实施计划
- 参考：`source/gallery/index.html`（复用其 Supabase 接入模式）、`2026-08-12-music-library-design.md`（文档格式与测试惯例）

## 背景与已确认决策

在右上角菜单新增"碎碎念"板块：子页面展示一张张小卡片（每张 = 一条碎碎念），所有人可读，发布需管理员登录。

已确认决策：
1. 视觉风格：**清爽浅色卡片风**（不沿用 gallery 复古暗色）
2. **支持配图**（每条 0/1 张，客户端压缩后上传）
3. **记住登录**（token 存 localStorage，7 天有效，过期自动续期/重登）
4. 菜单形态：**与 photos 平级**，直接显示在顶栏（移动端抽屉同步生效），用 SVG 图标

非目标（YAGNI，留作后续）：访客评论、多图、卡片编辑、接入 Twikoo。

## 页面与视觉

- 新文件 `source/murmurs/index.html`：单文件自包含（HTML+CSS+JS 内联，无框架、无外部库），与 gallery 同模式。
- 浅色风格：
  - 背景：柔和米白/浅灰渐变（如 `#f6f7f9` 系），可加极淡装饰性渐变光斑
  - 卡片：白底、圆角 12~16px、柔和阴影（`0 4px 16px rgba(0,0,0,.06)` 级别），大留白
  - 字体：系统无衬线栈（与 gallery 的 Georgia 衬线区分开）
  - 强调色：沿用站点主色 `#0066CC`（按钮、链接、悬停态）
- 布局：CSS columns 瀑布流卡片墙（PC 3 列 / 平板 2 列 / 手机 1 列）
- 卡片结构：配图（可选，圆角）→ 文字内容 → 底部时间（YYYY-MM-DD HH:mm）；登录态下卡片右上角出现删除按钮
- 头部：标题"碎碎念" + 条数统计；空态文案"还没有碎碎念"

## 数据模型（Supabase）

新表 `murmurs`（不建新桶、不建新项目）：

```sql
create table if not exists public.murmurs (
  id bigint generated always as identity primary key,
  content text not null check (char_length(content) between 1 and 1000),
  image_url text,
  created_at timestamptz not null default now()
);
alter table public.murmurs enable row level security;

create policy "murmurs_public_read"  on public.murmurs for select using (true);
create policy "murmurs_admin_insert" on public.murmurs for insert to authenticated with check (true);
create policy "murmurs_admin_update" on public.murmurs for update to authenticated using (true) with check (true);
create policy "murmurs_admin_delete" on public.murmurs for delete to authenticated using (true);
```

- 本项目 Supabase Auth 仅一个用户（管理员 `wza50923@gmail.com`），`to authenticated` 即仅管理员可写；后续若加人多，再把策略收紧到 `auth.uid() = '<管理员uid>'`。
- 配图复用 `photos` 存储桶，文件名 `murmur_<时间戳>_<随机串>.jpg`（沿用音乐 `audio_` 前缀的既有惯例），`image_url` 存 public URL。
- 删除卡片时同步删除桶内图片文件（从 URL 提取文件名，带登录 token 调 Storage remove；与音乐删除同款）。

## 权限与登录流程

- 阅读：页面加载用 anon key `GET /rest/v1/murmurs?select=...&order=created_at.desc&limit=100`；"加载更多"按 offset 翻页。
- 发布入口：右下角固定浮动"留言"按钮
  - 未登录 → 点击弹登录弹层（邮箱 + 密码，`POST /auth/v1/token?grant_type=password`）；密码错误显示抖动动画 + 错误文案
  - 已登录 → 点击弹出发布弹层（textarea + 选图/预览 + 发布按钮 + 字数计数，正文上限 1000 字与表约束一致）
- 登录态管理：
  - `access_token / refresh_token / expires_at` 存 localStorage（键如 `murmur_auth`）；**密码本身不落盘**
  - 页面加载时若已过期，用 refresh_token 静默续期；续期失败则清除并回到未登录态
  - 任何写操作收到 401 → 清除本地会话并重新弹登录
  - 退出登录：清除 localStorage（可选调 revoke）
- 安全：RLS 是真正的闸门（匿名 INSERT/UPDATE/DELETE 一律拒绝）；前端隐藏 UI 仅为体验，不承担安全职责。

## 交互与动画（纯 CSS + 原生 JS）

- 首屏：头部淡入；卡片按序 stagger（透明度 + translateY(16px)→0，每张延迟 ~60ms，封顶防卡顿）
- 滚动：IntersectionObserver 给进入视口的卡片补 `.in` 类触发显入
- 悬停：卡片上浮 4px + 阴影加深；配图轻微放大
- 发布成功：新卡片从顶部弹入（scale .9→1 + fade）
- 删除：确认弹窗 → 卡片淡出收起后移除
- 弹层（登录/发布/确认）：背景模糊 + 淡入，面板 translateY+scale 过渡（复用 gallery pwd-overlay 的动效骨架，换浅色皮肤）
- XSS：渲染内容一律转义（gallery 的 `he()` 同款），配图 URL 仅接受本桶 `https://` 地址

## 菜单接入（SVG 图标）

- `_config.yml`：`skip_render` 增加 `'murmurs/**'`
- `_config.keep.yml`：`menu` 在 photos 后追加一行 `碎碎念: /murmurs || zzn-icon`（key 即显示名；PC 顶栏与移动抽屉共用此配置）
- `source/css/custom.css`（已经由主题 inject 全站生效）新增：

```css
.menu-icon.zzn-icon{display:inline-block;width:1em;height:1em;background-color:currentColor;
  -webkit-mask:url("data:image/svg+xml,<svg>…</svg>") no-repeat center/contain;
  mask:url("data:image/svg+xml,<svg>…</svg>") no-repeat center/contain}
```

（`<svg>…</svg>` 为示意，实现时从 lucide.dev 拷贝 `message-circle` 的当前 path 原样内联，无需引外部文件。）

- 用 `mask + currentColor` 让图标自动继承菜单文字色（浅色/深色模式、悬停、active 全部自适应）；图标选 Lucide `message-circle` 风格气泡（MIT 许可）。不改主题任何文件。

## 文件清单

| 文件 | 改动 |
|---|---|
| `source/murmurs/index.html` | 新增（主体工作） |
| `_config.yml` | +1 行 skip_render |
| `_config.keep.yml` | +1 行菜单项 |
| `source/css/custom.css` | +图标类 |
| `docs/superpowers/specs/2026-08-30-murmurs-page-design.md` | 本文档 |
| Supabase 控制台 | 执行上面的建表 + RLS SQL |

## 测试计划

- SQL/RLS 实测：匿名 GET 200；匿名 POST 401/403；登录 POST 201；登录 DELETE 成功且图片文件同步删除
- 页面：`node --check` 校验内联 JS；jsdom 冒烟（DOM 构建、用 fixture 数据渲染卡片、弹层开合、转义生效）
- 路由与菜单：`hexo clean && hexo s` 本地验证菜单项出现（PC 顶栏 + 移动抽屉）、SVG 图标渲染、跳转 `/murmurs/` 正常
- 交互手测：登录（错密码抖动、记住 7 天、401 自动重登）、发布带图（压缩、上传、弹入）、删除（卡片淡出 + 桶内文件消失）、加载更多、空态/网络失败重试
- 响应式：3/2/1 列瀑布流、浮动按钮与弹层的手机端尺寸

## 约束

- 不推送 GitHub（本地 commit），与仓库现行惯例一致
- 不改 Keep 主题文件、不新建 Supabase 桶/项目
