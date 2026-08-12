# 音乐库管理与锁定播放 — 设计文档

- 日期：2026-08-12
- 项目：时光回忆录（source/gallery/index.html，Hexo + Supabase）
- 状态：已确认，进入实施
- 约束：不推送 GitHub、不主动写云端（用户明确指令）；仅本地提交

## 背景与决策
现有配乐为"照片身上的 music/musicName 字段"，无法统一管理。本次升级为独立音乐库，并新增前台"锁定播放"。

已确认决策：
1. 音乐管理入口：设置面板"留言管理"下方，点击打开**单文件内全屏视图**（非独立 URL）
2. 音乐库存储：**manifest.json 新增 musicLibrary 数组**（与照片清单一体保存/备份）
3. 锁定位置：**右下角悬浮卡片**
4. 锁定行为：**切换照片不换歌不停歌**
5. 选歌方式：播放条"锁定"按钮 + 悬浮条内**曲目下拉**

## 数据模型
musicLibrary 条目：{ id, name, url, photoId, createdAt }
- 照片对象：music/musicName 字段废弃，改为 musicId 引用音乐库
- 迁移：加载时自动执行 migrateMusicLibrary()，按 photoId+url 判重（幂等）；清除旧字段，随下次"保存"落盘
- 前台取歌：photoMusic(m) = 按 m.musicId 查音乐库
- saveManifest / localStorage 缓存 / loadMemories 均携带 musicLibrary

## 音乐管理视图
- 入口：管理面板新增"音乐管理"区块 → 打开全屏视图（z-index 高于管理面板，返回后仍停留在管理面板）
- 新增：选照片（现有照片下拉）→ 曲名（默认取文件名）→ 上传 mp3（复用 uploadAudioToSupabase）/ 填外链（http/https 校验，≤20MB）
- 列表：绑定照片缩略图 + 曲名 + 所属照片标题 + 修改/删除按钮
- 修改：行内编辑——曲名、更换绑定照片、替换音频/外链
- 删除：确认后 解绑照片(musicId) + 立即删除云端音频文件(removeAudioFromSupabase) + 移除条目
- 保存：视图底部"保存更改"→ saveManifest（与现有管理面板一致）；未保存的改动刷新即还原
- 原照片卡片音乐区改为只读：曲名 + 试听 + "去音乐管理"（不再提供卡片内上传/外链，避免双入口）

## 前台锁定播放
- 播放条新增"锁定"按钮；锁定当前照片音乐（musicLocked=true, lockedSongId=musicId）
- 锁定后：musicBar 隐藏，右下角悬浮卡片常驻（曲名/播放暂停/进度/时间/曲目下拉/解锁）
- 锁定期间 updateDisplay 不再重置音频（切照片、切分类、时间轴跳转均不换歌）
- 曲目下拉：列出 musicLibrary 全部曲目，选中即播放并保持锁定
- 解锁：恢复现有行为（切照片自动停止/换歌）；锁定状态仅本次会话，刷新还原；不自动播放

## 安全
- 上传/删除/保存继续要求 AUTH_TOKEN；外链仅 http/https；文件名 audio_时间戳_随机串
- 不新建桶、不加数据库表；改动仅 source/gallery/index.html

## 测试计划
- 迁移：旧配乐自动入库、photo.musicId 正确、重复加载不重复
- 音乐管理：新增（照片绑定）、修改（名/照片/音频）、删除（解绑+删云端文件）、保存 payload 含 musicLibrary
- 锁定：锁定→切照片歌不断、悬浮条常驻、下拉换歌、解锁还原、刷新还原
- 回归：留言、按图播放、上传压缩、分类、管理面板（jsdom + node --check + 本地手测）