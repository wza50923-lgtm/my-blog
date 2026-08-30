# 碎碎念页面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `/murmurs/` 碎碎念页（浅色卡片墙、可配图、动画），所有人可读，右下角"留言"按钮登录管理员后可发布/删除，并接入右上角菜单（SVG 图标）。

**Architecture:** 单文件自包含静态页（HTML+CSS+JS 内联、无框架），与 `source/gallery/index.html` 同模式；数据存 Supabase 新表 `murmurs`（RLS：匿名只读、登录可写删）；配图复用 `photos` 存储桶（`murmur_` 前缀）；菜单图标通过 `custom.css` 的 `mask + currentColor` 注入 SVG，不改主题文件。

**Tech Stack:** Hexo 7 + Keep 主题、Supabase（Auth/REST/Storage）、原生 JS + CSS 动画、jsdom + `node --test` 冒烟测试。

**Spec:** `docs/superpowers/specs/2026-08-30-murmurs-page-design.md`

## Global Constraints

- 单文件自包含：无外部 JS/CSS 库、无框架（与 gallery 一致）
- Supabase 常量与 gallery 完全一致：URL `https://dxfxkflqcjifrjqvgzeh.supabase.co`，anon key 见 Task 2 代码
- 正文 1~1000 字；配图每条 0/1 张，客户端压缩 JPEG（≤1920px、目标 ≤2MB），文件名 `murmur_<时间戳>_<随机串>.jpg`
- 登录态存 localStorage 键 `murmur_auth`（7 天），密码不落盘；任何 401 → 清会话并弹登录
- 渲染一律经 `he()` 转义；`image_url` 只接受 `/object/public/photos/<安全文件名>` 格式
- 浅色卡片风：白卡圆角 14px、柔和阴影、强调色 `#0066CC`、系统无衬线字体
- 菜单项 key 为 `碎碎念`（PC 顶栏 + 移动抽屉共用），图标类名 `zzn-icon`，不改 Keep 主题文件
- 不推送 GitHub，全部本地 commit；提交 `_config.keep.yml` 时会带上用户已存在的注释行改动（已知悉）

---

### Task 1: Supabase 建表 + RLS（用户在控制台操作）+ 连通性验证

**Files:** 无仓库改动（Supabase 控制台 SQL Editor）

**Interfaces:**
- Produces: 表 `murmurs(id bigint identity, content text 1..1000, image_url text, created_at timestamptz)`，Task 3/5 的 REST 调用依赖它

- [ ] **Step 1: 把 SQL 交给用户，在 Supabase Dashboard → SQL Editor 粘贴执行**

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

- [ ] **Step 2: 验证匿名可读（建表前此请求为 404，建表后 200）**

```bash
URL='https://dxfxkflqcjifrjqvgzeh.supabase.co'
KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4ZnhrZmxxY2ppZnJqcXZnemVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4NzM4MzcsImV4cCI6MjA5NzQ0OTgzN30.yjWjRdLT_qO3NlxqrKHJAxWFfhClDeolH1_CXRXnHRk'
curl -s -o /dev/null -w '%{http_code}\n' "$URL/rest/v1/murmurs?select=id&limit=1" -H "apikey: $KEY"
```
Expected: `200`（响应体 `[]`）

- [ ] **Step 3: 验证匿名写入被 RLS 拒绝**

```bash
curl -s -w '\nHTTP %{http_code}\n' -X POST "$URL/rest/v1/murmurs" \
  -H "apikey: $KEY" -H 'Content-Type: application/json' \
  -d '{"content":"anon-rls-test"}'
```
Expected: `401` 或 `403`（42501 RLS violation）。若返回 201，**停止**：RLS 策略未生效，回 Step 1 检查。

（表未建好不阻塞后续任务：页面有空态/错误态兜底；本 Task 只需在 Task 7 收尾前完成。）

---

### Task 2: 测试脚手架 + 页面骨架与浅色样式

**Files:**
- Create: `source/murmurs/index.html`
- Create: `tests/murmurs.test.js`

**Interfaces:**
- Produces: 元素 id 体系（`mz` 前缀，见下方 ids 数组）、`window.__MZ` 测试钩子、`he/fmtTime/xhr/jsonHeaders/state`（Task 3~5 直接使用）

- [ ] **Step 1: 写失败测试**（文件不存在 → 加载即失败）

创建 `tests/murmurs.test.js`：

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const HTML_PATH = path.join(__dirname, '..', 'source', 'murmurs', 'index.html');
const html = () => fs.readFileSync(HTML_PATH, 'utf8');

// XHR 桩：routes(method,url,body) => {status, body}；seed(w) 在页面脚本执行前预置 localStorage 等
function setup(routes, seed) {
  const calls = [];
  function Stub() { this._h = {}; }
  Stub.prototype.open = function (m, u) { this._m = m; this._u = u; };
  Stub.prototype.setRequestHeader = function (k, v) { this._h[k] = v; };
  Stub.prototype.send = function (b) {
    calls.push({ method: this._m, url: this._u, headers: this._h, body: b });
    const r = routes(this._m, this._u, b) || { status: 200, body: '[]' };
    this.status = r.status;
    this.responseText = r.body == null ? '' : String(r.body);
    if (this.onload) this.onload();
  };
  const dom = new JSDOM(html(), {
    runScripts: 'dangerously',
    url: 'https://example.com/murmurs/',
    beforeParse(w) { w.XMLHttpRequest = Stub; if (seed) seed(w); }
  });
  return { dom, calls, w: dom.window, doc: () => dom.window.document, MZ: () => dom.window.__MZ };
}

test('页面加载：语法可执行 + 关键结构存在', () => {
  const { doc } = setup(() => ({ status: 200, body: '[]' }));
  for (const id of ['mzWall', 'mzCount', 'mzFab', 'mzLoginOverlay', 'mzComposerOverlay',
    'mzConfirmOverlay', 'mzEmpty', 'mzErrBox', 'mzLoadMore', 'mzUserChip']) {
    assert.ok(doc().getElementById(id), '缺少 #' + id);
  }
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd "C:\Users\56660\my-blog" && node --test tests/murmurs.test.js`
Expected: FAIL（ENOENT 读不到 index.html）

- [ ] **Step 3: 创建 `source/murmurs/index.html`（骨架 + 全部 CSS + 基础 JS）**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="robots" content="index,follow">
<title>碎碎念</title>
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
html,body{min-height:100%}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;background:linear-gradient(180deg,#f7f8fa 0%,#eef1f5 100%);color:#2b3440;min-height:100vh}
.hidden{display:none!important}
.wrap{max-width:1080px;margin:0 auto;padding:48px 20px 120px}
.mz-header{display:flex;align-items:center;gap:12px;margin-bottom:28px}
.mz-header h1{font-size:28px;font-weight:700;color:#1d2733;letter-spacing:1px}
.mz-count{font-size:13px;color:#8a94a3}
.user-chip{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:13px;color:#5b6b7b;background:#fff;border:1px solid #e3e8ef;border-radius:16px;padding:4px 6px 4px 12px;box-shadow:0 2px 8px rgba(31,45,61,.05)}
.user-chip button{border:none;background:#eef4ff;color:#0066cc;font-size:12px;padding:4px 10px;border-radius:12px;cursor:pointer;transition:all .25s;font-family:inherit}
.user-chip button:hover{background:#dfeaff}
.wall{columns:3;column-gap:16px}
.card{break-inside:avoid;margin:0 0 16px;background:#fff;border:1px solid #e9edf3;border-radius:14px;padding:16px 18px;box-shadow:0 2px 10px rgba(31,45,61,.05);opacity:0;transform:translateY(16px);transition:opacity .5s ease,transform .5s cubic-bezier(.22,.61,.36,1),box-shadow .25s ease}
.card.in{opacity:1;transform:none}
.card.in:hover{box-shadow:0 10px 28px rgba(31,45,61,.1);transform:translateY(-4px)}
.card img.mz-img{width:100%;border-radius:10px;margin:0 0 10px;display:block;transition:transform .3s ease}
.card.in:hover img.mz-img{transform:scale(1.015)}
.mz-content{font-size:15px;line-height:1.75;white-space:pre-wrap;word-break:break-word;color:#2b3440}
.mz-meta{display:flex;align-items:center;justify-content:space-between;margin-top:12px}
.mz-time{font-size:12px;color:#9aa4b2}
.mz-del{border:none;background:transparent;color:#c3ccd8;cursor:pointer;font-size:15px;line-height:1;padding:2px 6px;border-radius:6px;transition:all .25s;visibility:hidden}
.card.in:hover .mz-del{visibility:visible}
.mz-del:hover{color:#e5484d;background:#fdecec}
.empty{text-align:center;color:#9aa4b2;font-size:14px;padding:60px 0}
.err{text-align:center;color:#e5484d;font-size:14px;padding:40px 0}
.err button{margin-left:8px;border:1px solid #f1c1c3;background:#fff;color:#e5484d;border-radius:8px;padding:4px 14px;cursor:pointer;font-size:13px;font-family:inherit}
.load-more{display:block;margin:8px auto 0;border:1px solid #dfe5ec;background:#fff;color:#5b6b7b;border-radius:20px;padding:8px 28px;font-size:13px;cursor:pointer;transition:all .25s;font-family:inherit}
.load-more:hover{color:#0066cc;border-color:#bcd7f7;background:#f5faff}
.fab{position:fixed;right:28px;bottom:28px;z-index:60;height:52px;padding:0 24px;border:none;border-radius:26px;background:linear-gradient(135deg,#0066cc,#3d8bff);color:#fff;font-size:15px;letter-spacing:2px;cursor:pointer;box-shadow:0 8px 24px rgba(0,102,204,.35);transition:transform .25s,box-shadow .25s;font-family:inherit}
.fab:hover{transform:translateY(-3px);box-shadow:0 12px 30px rgba(0,102,204,.42)}
.overlay{position:fixed;inset:0;z-index:100;background:rgba(23,32,43,.45);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;opacity:0;visibility:hidden;transition:opacity .3s ease,visibility .3s}
.overlay.open{opacity:1;visibility:visible}
.panel{width:min(420px,92vw);background:#fff;border-radius:16px;padding:26px 26px 22px;box-shadow:0 18px 50px rgba(15,25,35,.25);transform:translateY(18px) scale(.96);transition:transform .35s cubic-bezier(.22,.61,.36,1)}
.overlay.open .panel{transform:none}
.panel h2{font-size:17px;font-weight:600;color:#1d2733;margin-bottom:18px}
.panel input,.panel textarea{width:100%;border:1px solid #e3e8ef;border-radius:10px;padding:10px 14px;font-size:14px;color:#2b3440;outline:none;font-family:inherit;transition:border-color .25s;background:#fbfcfe}
.panel input:focus,.panel textarea:focus{border-color:#7db4f5;background:#fff}
.panel input+input{margin-top:10px}
.panel textarea{min-height:110px;resize:vertical;margin-bottom:10px;line-height:1.7}
.form-err{color:#e5484d;font-size:12px;min-height:16px;margin-bottom:8px}
.panel-actions{display:flex;gap:10px;justify-content:flex-end}
.panel-actions button{padding:9px 22px;border-radius:10px;font-size:14px;cursor:pointer;transition:all .25s;border:1px solid transparent;font-family:inherit}
.btn-ghost{background:#f2f5f8;color:#5b6b7b}
.btn-ghost:hover{background:#e8edf3}
.btn-primary{background:#0066cc;color:#fff}
.btn-primary:hover{background:#0055ad}
.btn-primary:disabled{opacity:.55;cursor:default}
@keyframes shake{0%,100%{transform:none}20%{transform:translateX(-7px)}40%{transform:translateX(6px)}60%{transform:translateX(-4px)}80%{transform:translateX(3px)}}
.panel.shake{animation:shake .4s ease}
.img-preview{position:relative;margin-bottom:10px}
.img-preview img{width:120px;height:90px;object-fit:cover;border-radius:10px;border:1px solid #e3e8ef;display:block}
.img-preview button{position:absolute;top:-8px;right:-8px;width:22px;height:22px;border-radius:50%;border:none;background:rgba(23,32,43,.75);color:#fff;cursor:pointer;font-size:13px;line-height:1}
.comp-foot{display:flex;align-items:center;gap:10px}
.comp-foot .char{font-size:12px;color:#9aa4b2}
.comp-foot .form-err{flex:1;margin:0}
.mini-btn{border:1px solid #e3e8ef;background:#fff;color:#5b6b7b;border-radius:10px;padding:8px 14px;font-size:13px;cursor:pointer;transition:all .25s;font-family:inherit}
.mini-btn:hover{color:#0066cc;border-color:#bcd7f7;background:#f5faff}
@keyframes popIn{0%{opacity:0;transform:scale(.9) translateY(-8px)}100%{opacity:1;transform:none}}
.pop-in{animation:popIn .45s cubic-bezier(.22,.61,.36,1)}
.fade-out{opacity:0!important;transform:scale(.92)!important;transition:opacity .3s ease,transform .3s ease}
@media(max-width:900px){.wall{columns:2}}
@media(max-width:600px){.wall{columns:1}.wrap{padding:32px 14px 110px}.mz-header h1{font-size:24px}.fab{right:18px;bottom:18px;height:48px;padding:0 20px}}
</style>
</head>
<body>
<div class="wrap">
  <header class="mz-header">
    <h1>碎碎念</h1>
    <span class="mz-count" id="mzCount"></span>
    <div class="user-chip hidden" id="mzUserChip">已登录 <button id="mzLogoutBtn">退出</button></div>
  </header>
  <main class="wall" id="mzWall"></main>
  <div class="empty hidden" id="mzEmpty">还没有碎碎念</div>
  <div class="err hidden" id="mzErrBox">加载失败 <button id="mzRetryBtn">重试</button></div>
  <button class="load-more hidden" id="mzLoadMore">加载更多</button>
</div>
<button class="fab" id="mzFab">留言</button>

<div class="overlay" id="mzLoginOverlay">
  <div class="panel">
    <h2>管理员登录</h2>
    <input type="email" id="mzEmail" placeholder="账号（邮箱）" autocomplete="username">
    <input type="password" id="mzPwd" placeholder="密码" autocomplete="current-password">
    <div class="form-err" id="mzLoginErr"></div>
    <div class="panel-actions">
      <button class="btn-ghost" id="mzLoginCancel">取消</button>
      <button class="btn-primary" id="mzLoginOk">登录</button>
    </div>
  </div>
</div>

<div class="overlay" id="mzComposerOverlay">
  <div class="panel">
    <h2>写碎碎念</h2>
    <textarea id="mzContent" maxlength="1000" placeholder="写点什么…"></textarea>
    <div class="img-preview hidden" id="mzImgPreview"><img id="mzImgPrev" alt=""><button id="mzImgDel" title="移除配图">&times;</button></div>
    <div class="comp-foot">
      <span class="char" id="mzCharCount">0/1000</span>
      <span class="form-err" id="mzCompErr"></span>
      <button class="mini-btn" id="mzPickBtn">配图</button>
      <button class="btn-primary" id="mzPublishBtn">发布</button>
    </div>
    <input type="file" id="mzFileInput" accept="image/*" style="display:none">
  </div>
</div>

<div class="overlay" id="mzConfirmOverlay">
  <div class="panel" style="width:min(340px,90vw)">
    <h2>删除这条碎碎念？</h2>
    <div class="panel-actions">
      <button class="btn-ghost" id="mzConfirmCancel">取消</button>
      <button class="btn-primary" id="mzConfirmOk" style="background:#e5484d">删除</button>
    </div>
  </div>
</div>

<script>
(function(){
"use strict";
var SUPABASE_URL='https://dxfxkflqcjifrjqvgzeh.supabase.co';
var SUPABASE_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4ZnhrZmxxY2ppZnJqcXZnemVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4NzM4MzcsImV4cCI6MjA5NzQ0OTgzN30.yjWjRdLT_qO3NlxqrKHJAxWFfhClDeolH1_CXRXnHRk';
var DB_URL=SUPABASE_URL+'/rest/v1';
var AUTH_URL=SUPABASE_URL+'/auth/v1';
var STORAGE_URL=SUPABASE_URL+'/storage/v1';
var BUCKET_NAME='photos';
var PUBLIC_PREFIX=STORAGE_URL+'/object/public/'+BUCKET_NAME+'/';
var LS_KEY='murmur_auth';
var PAGE_SIZE=100;
var IMG_RE=/^https:\/\/[^\s]+\/object\/public\/photos\/[A-Za-z0-9._-]+$/;

var state={list:[],offset:0,done:false,loading:false,token:null,refreshTok:null,expiresAt:0,pendingImg:null,pendingPreview:null,deleteTarget:null};

var ids=['wall','count','userChip','logoutBtn','empty','errBox','retryBtn','loadMore','fab','loginOverlay','email','pwd','loginErr','loginCancel','loginOk','composerOverlay','content','charCount','compErr','imgPreview','imgPrev','imgDel','pickBtn','fileInput','publishBtn','confirmOverlay','confirmCancel','confirmOk'];
var el={};ids.forEach(function(id){el[id]=document.getElementById('mz'+id.charAt(0).toUpperCase()+id.slice(1));});

function he(s){return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function fmtTime(iso){var d=new Date(iso);if(isNaN(d))return'';function p(n){return n<10?'0'+n:''+n;}return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes());}
function xhr(method,url,headers,body,cb){
  var x=new XMLHttpRequest();
  x.open(method,url,true);
  if(headers)Object.keys(headers).forEach(function(k){x.setRequestHeader(k,headers[k]);});
  x.onload=function(){var data=null;try{data=x.responseText?JSON.parse(x.responseText):null;}catch(e){}
    if(x.status>=200&&x.status<300)cb(null,x.status,data);
    else cb({status:x.status,data:data},x.status,data);};
  x.onerror=function(){cb({status:0,network:true},0,null);};
  x.send(body||null);
}
function jsonHeaders(extra){var h={'apikey':SUPABASE_KEY,'Content-Type':'application/json'};if(extra)Object.keys(extra).forEach(function(k){h[k]=extra[k];});return h;}

function bindEvents(){
  el.loginCancel.addEventListener('click',closeOverlay.bind(null,el.loginOverlay));
  el.confirmCancel.addEventListener('click',closeOverlay.bind(null,el.confirmOverlay));
  [el.loginOverlay,el.composerOverlay,el.confirmOverlay].forEach(function(ov){
    ov.addEventListener('click',function(e){if(e.target===ov)closeOverlay(ov);});
  });
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'){closeOverlay(el.loginOverlay);closeOverlay(el.composerOverlay);closeOverlay(el.confirmOverlay);}
  });
}
function closeOverlay(ov){ov.classList.remove('open');}

function init(){bindEvents();}

window.__MZ={state:state,he:he,fmtTime:fmtTime,xhr:xhr,jsonHeaders:jsonHeaders,init:init};
init();
})();
</script>
</body>
</html>
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/murmurs.test.js`
Expected: PASS（结构齐全；JSDOM 构造不抛错 = 内联脚本语法可执行）

- [ ] **Step 5: Commit**

```bash
git add source/murmurs/index.html tests/murmurs.test.js
git commit -m "feat(murmurs): 碎碎念页面骨架与浅色卡片样式（含 jsdom 测试基线）"
```

---

### Task 3: 数据加载、卡片渲染与进场动画

**Files:**
- Modify: `source/murmurs/index.html`（`<script>` 内追加函数、扩展 `init`）
- Modify: `tests/murmurs.test.js`（追加测试）

**Interfaces:**
- Consumes: Task 2 的 `xhr/jsonHeaders/he/state/el/__MZ`
- Produces: `loadMurmurs(reset)`、`cardHtml(m,fresh)`、`renderBatch(rows,mode)`、`renderOne(m)`、`renderAll()`、`isAuthed()`、`showEmpty(v)`、`showErr()`、`revealCards()`；卡片 DOM：`article.card`（`.in` 显入，`.mz-del` 携带 `data-id`/`data-img`）

- [ ] **Step 1: 追加失败测试**（`tests/murmurs.test.js` 末尾）

```js
function rows(n, startId) {
  return Array.from({ length: n }, (_, i) => ({
    id: (startId || 0) + i + 1, content: '碎碎念 #' + i,
    image_url: null, created_at: '2026-08-30T10:00:00Z'
  }));
}

test('渲染：3 条数据 → 3 张卡片 + 转义 + 配图守卫 + 计数', () => {
  const { doc, MZ } = setup(() => ({ status: 200, body: JSON.stringify([
    { id: 1, content: '<img src=x onerror=alert(1)>注入', image_url: null, created_at: '2026-08-30T10:00:00Z' },
    { id: 2, content: '有图', image_url: 'https://dxfxkflqcjifrjqvgzeh.supabase.co/storage/v1/object/public/photos/murmur_1_a.jpg', created_at: '2026-08-30T09:00:00Z' },
    { id: 3, content: '坏图', image_url: 'javascript:alert(1)', created_at: '2026-08-30T08:00:00Z' }
  ]) }));
  assert.strictEqual(doc().querySelectorAll('#mzWall .card').length, 3);
  const c1 = doc().querySelectorAll('#mzWall .card')[0];
  assert.ok(c1.querySelector('.mz-content').innerHTML.includes('&lt;img'), '内容必须被转义');
  assert.strictEqual(c1.querySelector('img.mz-img'), null);
  assert.ok(doc().querySelectorAll('#mzWall .card')[1].querySelector('img.mz-img'), '合法桶地址才渲染 <img>');
  assert.strictEqual(doc().querySelectorAll('#mzWall .card')[2].querySelector('img.mz-img'), null, '非法 URL 不渲染');
  assert.ok(doc().getElementById('mzCount').textContent.includes('3'));
  assert.ok(MZ().fmtTime('2026-08-30T10:00:00Z').length >= 16, '时间格式化非空');
});

test('空态与错误态', () => {
  const { doc } = setup(() => ({ status: 200, body: '[]' }));
  assert.ok(!doc().getElementById('mzEmpty').classList.contains('hidden'), '空数组显示空态');
});
test('错误态 + 重试', () => {
  let bad = true;
  const { doc } = setup(() => bad ? { status: 500, body: '{"error":"x"}' } : { status: 200, body: JSON.stringify(rows(1)) });
  assert.ok(!doc().getElementById('mzErrBox').classList.contains('hidden'), '失败显示错误态');
  bad = false;
  doc().getElementById('mzRetryBtn').click();
  assert.strictEqual(doc().querySelectorAll('#mzWall .card').length, 1);
  assert.ok(doc().getElementById('mzErrBox').classList.contains('hidden'));
});

test('加载更多：offset 翻页 + 完成后隐藏', () => {
  const { doc, calls } = setup((m, u) => {
    if (m === 'GET' && u.includes('/rest/v1/murmurs')) {
      const off = Number(new URL(u).searchParams.get('offset') || 0);
      const rowsPage = off === 0 ? rows(100) : rows(2, 100);
      return { status: 200, body: JSON.stringify(rowsPage) };
    }
    return { status: 200, body: '[]' };
  });
  assert.strictEqual(doc().querySelectorAll('#mzWall .card').length, 100);
  assert.ok(!doc().getElementById('mzLoadMore').classList.contains('hidden'));
  doc().getElementById('mzLoadMore').click();
  assert.strictEqual(doc().querySelectorAll('#mzWall .card').length, 102);
  assert.ok(doc().getElementById('mzLoadMore').classList.contains('hidden'), '不足一页隐藏加载更多');
  const urls = calls.filter(c => c.method === 'GET').map(c => c.url);
  assert.ok(urls.some(u => u.includes('offset=100')), '第二次请求 offset=100');
});
```

- [ ] **Step 2: 运行确认失败**（`__MZ.loadMurmurs is not a function` / 断言失败）

- [ ] **Step 3: 实现**——在 `<script>` 内（`bindEvents` 之前）追加：

```js
function isAuthed(){return !!state.token;}
function showEmpty(v){el.empty.classList.toggle('hidden',!v);}
function showErr(){el.errBox.classList.remove('hidden');}

var io=null;
function makeObserver(){
  if(!('IntersectionObserver' in window))return null;
  return new IntersectionObserver(function(es){
    es.forEach(function(en){
      if(!en.isIntersecting)return;
      var t=en.target;
      t.style.transitionDelay=Math.min((parseInt(t.dataset.i||'0',10))*60,480)+'ms';
      t.classList.add('in');
      setTimeout(function(){t.style.transitionDelay='';},700);
      io.unobserve(t);
    });
  },{rootMargin:'0px 0px -8% 0px',threshold:.05});
}
function revealCards(){
  var cards=el.wall.querySelectorAll('.card.pre');
  Array.prototype.forEach.call(cards,function(c,i){
    c.dataset.i=String(i);
    if(io)io.observe(c);
    else{setTimeout(function(){c.classList.add('in');},Math.min(i*60,480));}
  });
}
function cardHtml(m,fresh){
  var img='';
  if(m.image_url&&IMG_RE.test(m.image_url))img='<img class="mz-img" src="'+he(m.image_url)+'" alt="" loading="lazy">';
  var del=isAuthed()?'<button class="mz-del" data-id="'+he(String(m.id))+'" data-img="'+he(m.image_url||'')+'" title="删除">&#10005;</button>':'';
  var cls='card'+(fresh?' in pop-in':' pre');
  return '<article class="'+cls+'">'+img+'<div class="mz-content">'+he(m.content)+'</div>'+
    '<div class="mz-meta"><span class="mz-time">'+fmtTime(m.created_at)+'</span>'+del+'</div></article>';
}
function renderBatch(rows,mode){
  var htmlStr=rows.map(function(m){return cardHtml(m,false);}).join('');
  if(mode==='reset'){el.wall.innerHTML=htmlStr;if(rows.length)revealCards();}
  else{el.wall.insertAdjacentHTML('beforeend',htmlStr);if(rows.length)revealCards();}
  el.count.textContent=state.list.length?('共 '+state.list.length+' 条'):'';
  showEmpty(state.list.length===0);
}
function renderOne(m){
  el.wall.insertAdjacentHTML('afterbegin',cardHtml(m,true));
  el.count.textContent='共 '+state.list.length+' 条';
  showEmpty(false);
}
function renderAll(){renderBatch(state.list,'reset');}
function loadMurmurs(reset){
  if(state.loading)return;
  state.loading=true;
  if(reset){state.offset=0;state.done=false;}
  el.errBox.classList.add('hidden');
  var url=DB_URL+'/murmurs?select=id,content,image_url,created_at&order=created_at.desc&limit='+PAGE_SIZE+'&offset='+state.offset;
  xhr('GET',url,jsonHeaders(),null,function(err,st,data){
    state.loading=false;
    if(err){showErr();if(reset){el.wall.innerHTML='';showEmpty(false);el.loadMore.classList.add('hidden');}return;}
    var fresh=Array.isArray(data)?data:[];
    if(reset)state.list=fresh.slice();
    else state.list=state.list.concat(fresh);
    state.offset+=fresh.length;
    state.done=fresh.length<PAGE_SIZE;
    renderBatch(fresh,reset?'reset':'append');
    el.loadMore.classList.toggle('hidden',state.done);
  });
}
```

并把 `init` 改为：

```js
function init(){io=makeObserver();bindEvents();loadMurmurs(true);}
```

`window.__MZ` 追加字段：`loadMurmurs, renderBatch, renderOne, renderAll, cardHtml, isAuthed, showEmpty, showErr`。

同时在 `bindEvents` 内追加两行接线：

```js
el.loadMore.addEventListener('click',function(){loadMurmurs(false);});
el.retryBtn.addEventListener('click',function(){loadMurmurs(true);});
```

注意：`loadMurmurs` 定义需位于 `init()` 调用之前（函数声明提升可用，保持现状即可）。

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/murmurs.test.js`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add source/murmurs/index.html tests/murmurs.test.js
git commit -m "feat(murmurs): 数据加载、转义渲染、瀑布流卡片与进场动画"
```

---

### Task 4: 管理员登录与会话（记住 7 天）

**Files:**
- Modify: `source/murmurs/index.html`
- Modify: `tests/murmurs.test.js`

**Interfaces:**
- Consumes: `xhr/jsonHeaders/AUTH_URL/LS_KEY/state`
- Produces: `login(email,pwd,cb)`、`logout()`、`restoreSession()`、`refreshSession(cb)`、`saveSession(d)`、`clearSession()`、`authHeaders()`、`on401()`、`updateAuthUi()`、`openOverlay(ov)`；localStorage 键 `murmur_auth`（`{a,r,e}`）；Task 5 依赖 `authHeaders()` 与 `on401()`

- [ ] **Step 1: 追加失败测试**

```js
const AUTH_OK={status:200,body:JSON.stringify({access_token:'AT1',refresh_token:'RT1',expires_in:604800,user:{email:'wza50923@gmail.com'}})};

test('登录：成功保存会话（7 天）+ UI 切换；失败提示且不保存', () => {
  const ctx = setup((m,u,b) => {
    if(m==='POST'&&u.includes('grant_type=password')){
      const p=JSON.parse(b);
      return p.password==='right'?AUTH_OK:{status:400,body:'{"error":"invalid_grant"}'};
    }
    return {status:200,body:'[]'};
  });
  const d=ctx.doc();
  d.getElementById('mzFab').click();                       // 未登录 → 打开登录层
  assert.ok(d.getElementById('mzLoginOverlay').classList.contains('open'));
  d.getElementById('mzEmail').value='wza50923@gmail.com';
  d.getElementById('mzPwd').value='wrong';
  d.getElementById('mzLoginOk').click();
  assert.ok(d.getElementById('mzLoginErr').textContent.length>0,'错误提示');
  assert.strictEqual(ctx.MZ().state.token,null);
  d.getElementById('mzPwd').value='right';
  d.getElementById('mzLoginOk').click();
  assert.strictEqual(ctx.MZ().state.token,'AT1');
  const s=JSON.parse(ctx.w.localStorage.getItem('murmur_auth'));
  assert.strictEqual(s.a,'AT1');assert.ok(s.e-Date.now()>6*24*3600*1000,'过期时间≥6天');
  assert.ok(!d.getElementById('mzUserChip').classList.contains('hidden'),'显示已登录');
});

test('restoreSession：过期会话自动走 refresh 续期', () => {
  let refreshed=false;
  const ctx = setup((m,u)=>{
    if(m==='POST'&&u.includes('grant_type=refresh_token')){refreshed=true;return AUTH_OK;}
    return {status:200,body:'[]'};
  },(w)=>w.localStorage.setItem('murmur_auth',JSON.stringify({a:'OLD',r:'RTO',e:Date.now()-1000})));
  assert.ok(refreshed,'触发 refresh');
  assert.strictEqual(ctx.MZ().state.token,'AT1');
});

test('restoreSession：refresh 失败 → 清会话', () => {
  const ctx = setup((m,u)=>{
    if(m==='POST'&&u.includes('grant_type=refresh_token'))return {status:400,body:'{"error":"invalid_grant"}'};
    return {status:200,body:'[]'};
  },(w)=>w.localStorage.setItem('murmur_auth',JSON.stringify({a:'OLD',r:'RTO',e:Date.now()-1000})));
  assert.strictEqual(ctx.MZ().state.token,null);
  assert.strictEqual(ctx.w.localStorage.getItem('murmur_auth'),null);
});

test('写操作 401 → 清会话并弹登录', () => {
  const ctx = setup(()=>({status:200,body:'[]'}));
  ctx.MZ().state.token='X';
  ctx.MZ().on401();
  assert.strictEqual(ctx.MZ().state.token,null);
  assert.ok(ctx.doc().getElementById('mzLoginOverlay').classList.contains('open'));
});
```

- [ ] **Step 2: 运行确认失败**

- [ ] **Step 3: 实现**——追加：

```js
function saveSession(d){
  state.token=d.access_token;state.refreshTok=d.refresh_token;
  state.expiresAt=(d.expires_at?d.expires_at*1000:Date.now()+(d.expires_in||3600)*1000)-60000;
  try{localStorage.setItem(LS_KEY,JSON.stringify({a:state.token,r:state.refreshTok,e:state.expiresAt}));}catch(e){}
}
function clearSession(){state.token=null;state.refreshTok=null;state.expiresAt=0;try{localStorage.removeItem(LS_KEY);}catch(e){}}
function openOverlay(ov){ov.classList.add('open');}
function openLogin(){openOverlay(el.loginOverlay);}
function on401(){clearSession();updateAuthUi();renderAll();openLogin();}
function authHeaders(){return isAuthed()?{Authorization:'Bearer '+state.token}:null;}
function refreshSession(cb){
  if(!state.refreshTok){cb(false);return;}
  xhr('POST',AUTH_URL+'/token?grant_type=refresh_token',jsonHeaders(),JSON.stringify({refresh_token:state.refreshTok}),function(err,st,data){
    if(err){cb(false);return;}
    saveSession(data);cb(true);
  });
}
```

```js
function login(email,pwd,cb){
  if(!email||!pwd){cb(false);el.loginErr.textContent='请输入账号和密码';return;}
  xhr('POST',AUTH_URL+'/token?grant_type=password',jsonHeaders(),JSON.stringify({email:email,password:pwd}),function(err,st,data){
    if(err){cb(false);el.loginErr.textContent='账号或密码错误';var p=el.loginOverlay.querySelector('.panel');
      p.classList.remove('shake');void p.offsetWidth;p.classList.add('shake');return;}
    el.loginErr.textContent='';
    saveSession(data);updateAuthUi();closeOverlay(el.loginOverlay);renderAll();cb(true);
  });
}
function logout(){
  if(state.token)xhr('POST',AUTH_URL+'/logout',jsonHeaders({Authorization:'Bearer '+state.token}),null,function(){});
  clearSession();updateAuthUi();renderAll();
}
function restoreSession(){
  var raw=null;try{raw=localStorage.getItem(LS_KEY);}catch(e){}
  if(!raw){updateAuthUi();return;}
  try{var s=JSON.parse(raw);state.token=s.a||null;state.refreshTok=s.r||null;state.expiresAt=s.e||0;}
  catch(e){clearSession();updateAuthUi();return;}
  if(state.token&&Date.now()<state.expiresAt){updateAuthUi();return;}
  if(state.refreshTok){refreshSession(function(ok){if(!ok)clearSession();updateAuthUi();});}
  else clearSession();
}
function updateAuthUi(){
  el.userChip.classList.toggle('hidden',!isAuthed());
  if(!isAuthed())closeOverlay(el.composerOverlay);
}
```

`bindEvents` 追加接线：

```js
el.fab.addEventListener('click',function(){isAuthed()?openOverlay(el.composerOverlay):openLogin();});
el.loginOk.addEventListener('click',function(){login(el.email.value.trim(),el.pwd.value,function(){});});
el.pwd.addEventListener('keydown',function(e){if(e.key==='Enter')el.loginOk.click();});
el.logoutBtn.addEventListener('click',logout);
```

`init` 改为：`function init(){io=makeObserver();restoreSession();bindEvents();loadMurmurs(true);}`

`__MZ` 追加：`login,logout,restoreSession,refreshSession,saveSession,clearSession,authHeaders,on401,updateAuthUi,openLogin,openOverlay`。

- [ ] **Step 4: 运行确认通过**（`node --test tests/murmurs.test.js`）

- [ ] **Step 5: Commit**

```bash
git add source/murmurs/index.html tests/murmurs.test.js
git commit -m "feat(murmurs): 管理员登录、7 天会话与 401 自动重登"
```

---

### Task 5: 发布碎碎念（配图上传）与删除

**Files:**
- Modify: `source/murmurs/index.html`
- Modify: `tests/murmurs.test.js`

**Interfaces:**
- Consumes: Task 4 的 `authHeaders/on401/isAuthed`、Task 3 的 `renderOne/renderAll`
- Produces: `publish(content,imageUrl,cb)`（cb(err,data)，data 为插入行）、`deleteMurmur(id,imageUrl,cb)`、`compressImage(file,cb)`、`uploadImage(file,cb)`、`resetComposer()`

- [ ] **Step 1: 追加失败测试**

```js
function loginFor(ctx){ // 通过 UI 登录，返回 ctx
  const d=ctx.doc(); d.getElementById('mzFab').click();
  d.getElementById('mzEmail').value='wza50923@gmail.com';
  d.getElementById('mzPwd').value='right';
  d.getElementById('mzLoginOk').click();
  return ctx;
}
test('发布：POST 带登录头 → 新卡片置顶弹入 + 列表更新', () => {
  const ctx=loginFor(setup((m,u,b)=>{
    if(m==='POST'&&u.includes('grant_type=password'))return AUTH_OK;
    if(m==='POST'&&u.endsWith('/rest/v1/murmurs')){
      const cur=ctx.calls[ctx.calls.length-1];
      assert.ok(cur.headers.Authorization,'POST 带登录头');
      assert.strictEqual(JSON.parse(b).content,'第一条','POST body 正确');
      return {status:201,body:JSON.stringify([{id:9,content:'第一条',image_url:null,created_at:'2026-08-30T12:00:00Z'}])};
    }
    return {status:200,body:'[]'};
  }));
  const d=ctx.doc();
  d.getElementById('mzFab').click();                       // 已登录 → 打开发布层
  assert.ok(d.getElementById('mzComposerOverlay').classList.contains('open'));
  d.getElementById('mzContent').value='第一条';
  d.getElementById('mzPublishBtn').click();
  assert.strictEqual(d.querySelector('#mzWall .card .mz-content').textContent,'第一条');
  assert.strictEqual(ctx.MZ().state.list[0].id,9);
});

test('发布校验：空内容不发请求', () => {
  const ctx=loginFor(setup((m,u)=>{ 
    if(m==='POST'&&u.includes('grant_type=password'))return AUTH_OK;
    return {status:200,body:'[]'};
  }));
  const n=ctx.calls.length;
  ctx.doc().getElementById('mzContent').value='   ';
  ctx.doc().getElementById('mzPublishBtn').click();
  assert.strictEqual(ctx.calls.length,n,'没有新增请求');
  assert.ok(ctx.doc().getElementById('mzCompErr').textContent.length>0);
});

test('删除：确认后 DELETE + 桶内图片同步删除', () => {
  const img='https://dxfxkflqcjifrjqvgzeh.supabase.co/storage/v1/object/public/photos/murmur_9_x.jpg';
  const ctx=loginFor(setup((m,u)=>{
    if(m==='POST'&&u.includes('grant_type=password'))return AUTH_OK;
    if(m==='GET'&&u.includes('/rest/v1/murmurs'))return {status:200,body:JSON.stringify([{id:9,content:'待删',image_url:img,created_at:'2026-08-30T12:00:00Z'}])};
    if(m==='DELETE'&&u.includes('/rest/v1/murmurs?id=eq.9'))return {status:204,body:''};
    if(m==='DELETE'&&u.includes('/storage/v1/object/photos/murmur_9_x.jpg'))return {status:200,body:''};
    return {status:200,body:'[]'};
  }));
  const d=ctx.doc();
  d.querySelector('.mz-del').click();
  assert.ok(d.getElementById('mzConfirmOverlay').classList.contains('open'));
  d.getElementById('mzConfirmOk').click();
  assert.strictEqual(ctx.MZ().state.list.length,0);
  const dels=ctx.calls.filter(c=>c.method==='DELETE').map(c=>c.url);
  assert.ok(dels.some(u=>u.includes('murmurs?id=eq.9')));
  assert.ok(dels.some(u=>u.includes('object/photos/murmur_9_x.jpg')),'配图文件同步删除');
});
```

- [ ] **Step 2: 运行确认失败**

- [ ] **Step 3: 实现**——追加：

```js
function compressImage(file,cb){
  var MAX_DIM=1920,QUALITY=0.85;
  var reader=new FileReader();
  reader.onload=function(e){
    var img=new Image();
    img.onload=function(){
      var w=img.width,h=img.height;
      if(w>MAX_DIM||h>MAX_DIM){var r=Math.min(MAX_DIM/w,MAX_DIM/h);w*=r;h*=r;}
      var c=document.createElement('canvas');c.width=Math.round(w);c.height=Math.round(h);
      var ctx=c.getContext('2d');ctx.drawImage(img,0,0,c.width,c.height);
      (function tryQ(q){
        c.toBlob(function(blob){
          if(!blob){cb('图片压缩失败');return;}
          if(blob.size>2*1024*1024&&q>0.4){tryQ(q-0.1);return;}
          var name=(file.name||'murmur').replace(/\.[^.]+$/,'')+'.jpg';
          cb(null,new File([blob],name,{type:'image/jpeg'}));
        },'image/jpeg',q);
      })(QUALITY);
    };
    img.onerror=function(){cb('图片读取失败');};
    img.src=e.target.result;
  };
  reader.onerror=function(){cb('图片读取失败');};
  reader.readAsDataURL(file);
}
function uploadImage(file,cb){
  if(!isAuthed()){cb('请先登录');return;}
  var fn='murmur_'+Date.now()+'_'+Math.random().toString(36).slice(2,8)+'.jpg';
  xhr('POST',STORAGE_URL+'/object/'+BUCKET_NAME+'/'+fn,
    {Authorization:'Bearer '+state.token,'Content-Type':'image/jpeg','x-upsert':'true'},
    file,function(err){
      if(err){cb('图片上传失败('+(err.status||'网络错误')+')');return;}
      cb(null,PUBLIC_PREFIX+fn);
    });
}
function publish(content,imageUrl,cb){
  content=String(content||'').trim();
  if(!content){cb('写点什么再发布吧');return;}
  if(content.length>1000){cb('最多 1000 字');return;}
  if(!isAuthed()){cb('请先登录');return;}
  var body={content:content};if(imageUrl)body.image_url=imageUrl;
  xhr('POST',DB_URL+'/murmurs',jsonHeaders({Authorization:'Bearer '+state.token,Prefer:'return=representation'}),JSON.stringify(body),
    function(err,st,data){
      if(err){if(err.status===401)on401();cb('发布失败('+(err.status||'网络错误')+')');return;}
      var row=Array.isArray(data)?data[0]:data;
      cb(null,row);
    });
}
function deleteMurmur(id,imageUrl,cb){
  if(!isAuthed()){cb('请先登录');return;}
  xhr('DELETE',DB_URL+'/murmurs?id=eq.'+encodeURIComponent(id),jsonHeaders({Authorization:'Bearer '+state.token}),null,function(err){
    if(err){if(err.status===401)on401();cb('删除失败('+(err.status||'网络错误')+')');return;}
    if(imageUrl&&imageUrl.indexOf(PUBLIC_PREFIX)===0){
      var fn=imageUrl.substring(PUBLIC_PREFIX.length).split('?')[0];
      if(fn)xhr('DELETE',STORAGE_URL+'/object/'+BUCKET_NAME+'/'+fn,{Authorization:'Bearer '+state.token},null,function(){});
    }
    cb(null);
  });
}
function resetComposer(){
  el.content.value='';el.charCount.textContent='0/1000';el.compErr.textContent='';
  state.pendingImg=null;state.pendingPreview=null;el.imgPreview.classList.add('hidden');
  el.publishBtn.disabled=false;
}
```

`bindEvents` 追加接线：

```js
el.publishBtn.addEventListener('click',function(){
  el.compErr.textContent='';
  var text=el.content.value;
  if(!text.trim()){el.compErr.textContent='写点什么再发布吧';return;}
  el.publishBtn.disabled=true;
  var done=function(err){el.publishBtn.disabled=false;if(err){el.compErr.textContent=err;return;}resetComposer();closeOverlay(el.composerOverlay);};
  if(state.pendingImg){
    uploadImage(state.pendingImg,function(err,url){if(err){done(err);return;}publish(text,url,function(err2,row){if(err2){done(err2);return;}state.list.unshift(row);renderOne(row);done(null);});});
  }else{
    publish(text,null,function(err2,row){if(err2){done(err2);return;}state.list.unshift(row);renderOne(row);done(null);});
  }
});
el.content.addEventListener('input',function(){el.charCount.textContent=el.content.value.length+'/1000';});
el.pickBtn.addEventListener('click',function(){el.fileInput.click();});
el.fileInput.addEventListener('change',function(){
  var f=el.fileInput.files&&el.fileInput.files[0];
  el.fileInput.value='';
  if(!f)return;
  compressImage(f,function(err,nf){
    if(err){el.compErr.textContent=err;return;}
    state.pendingImg=nf;
    var rd=new FileReader();
    rd.onload=function(e){state.pendingPreview=e.target.result;el.imgPrev.src=state.pendingPreview;el.imgPreview.classList.remove('hidden');};
    rd.readAsDataURL(nf);
  });
});
el.imgDel.addEventListener('click',function(){state.pendingImg=null;el.imgPreview.classList.add('hidden');});
el.wall.addEventListener('click',function(e){
  var b=e.target.closest('.mz-del');if(!b)return;
  state.deleteTarget={id:b.dataset.id,img:b.dataset.img};
  openOverlay(el.confirmOverlay);
});
el.confirmOk.addEventListener('click',function(){
  var t=state.deleteTarget;if(!t)return;
  el.confirmOk.disabled=true;
  deleteMurmur(t.id,t.img,function(err){
    el.confirmOk.disabled=false;closeOverlay(el.confirmOverlay);
    if(err)return;
    var idx=-1;
    for(var i=0;i<state.list.length;i++){if(String(state.list[i].id)===String(t.id)){idx=i;break;}}
    if(idx>=0)state.list.splice(idx,1);
    var cards=el.wall.querySelectorAll('.card');
    Array.prototype.forEach.call(cards,function(c){
      var btn=c.querySelector('.mz-del');
      if(btn&&btn.dataset.id===String(t.id)){c.classList.add('fade-out');setTimeout(function(){c.remove();el.count.textContent=state.list.length?('共 '+state.list.length+' 条'):'';showEmpty(state.list.length===0);},320);}
    });
    state.deleteTarget=null;
  });
});
```

`__MZ` 追加：`publish,deleteMurmur,compressImage,uploadImage,resetComposer`。

- [ ] **Step 4: 运行确认通过**（`node --test tests/murmurs.test.js`）

- [ ] **Step 5: Commit**

```bash
git add source/murmurs/index.html tests/murmurs.test.js
git commit -m "feat(murmurs): 发布碎碎念（配图压缩上传）与删除（含云端文件清理）"
```

---

### Task 6: 站点接入（skip_render / 菜单 / SVG 图标）+ 构建验证

**Files:**
- Modify: `_config.yml`（`skip_render` 块）
- Modify: `_config.keep.yml`（`menu` 块；注意工作区已有用户的注释行改动，提交时一并包含——已知悉）
- Modify: `source/css/custom.css`（追加图标类）

**Interfaces:**
- Consumes: Task 2 的页面文件
- Produces: 生成的 `public/murmurs/index.html`；菜单项"碎碎念"（PC 顶栏 + 移动抽屉）

- [ ] **Step 1: `_config.yml` 的 `skip_render` 追加一行**

```yaml
skip_render:
  - 'gallery/**'
  - 'murmurs/**'
```

- [ ] **Step 2: `_config.keep.yml` 的 `menu` 追加一行（photos 之后）**

```yaml
menu:
  home: / || fa-solid fa-home
  archives: /archives || fa-solid fa-box-archive
  photos: /gallery || fa-solid fa-image
  碎碎念: /murmurs || zzn-icon
```

- [ ] **Step 3: `source/css/custom.css` 追加**

```css
/* 菜单"碎碎念"SVG 图标：mask + currentColor，自动适配明暗/悬停色 */
.menu-icon.zzn-icon{display:inline-block;width:1em;height:1em;background-color:currentColor;-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M7.9 20A9 9 0 1 0 4 16.1L2 22Z'/%3E%3C/svg%3E") no-repeat center/contain;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M7.9 20A9 9 0 1 0 4 16.1L2 22Z'/%3E%3C/svg%3E") no-repeat center/contain}
```

- [ ] **Step 4: 构建验证**

```bash
cd "C:\Users\56660\my-blog" && npx hexo clean && npx hexo generate
ls public/murmurs/index.html
grep -o "碎碎念" public/index.html | head -1
grep -o "zzn-icon" public/index.html | head -1
```
Expected: `public/murmurs/index.html` 存在且与源文件一致（Hexo 仅复制）；首页 header 含"碎碎念"与 `zzn-icon`。

- [ ] **Step 5: Commit**

```bash
git add _config.yml _config.keep.yml source/css/custom.css
git commit -m "feat(murmurs): 菜单接入碎碎念（SVG 图标）并跳过渲染"
```

---

### Task 7: 端到端验证与收尾

**Files:** 无新改动（发现问题则修后补提交）

- [ ] **Step 1: 全量测试**

Run: `node --test tests/murmurs.test.js` → 全部 PASS

- [ ] **Step 2: RLS 复验（需 Task 1 已完成）**

Task 1 Step 2/3 的两条 curl：匿名读 `200 []`；匿名写 `401/403`。若 Task 1 未完成，向用户重发 SQL 并等待。

- [ ] **Step 3: 本地手测清单**（`npx hexo server`，浏览器 + 手机宽度 DevTools）

- 顶栏出现"碎碎念"，SVG 图标渲染、颜色随主题/悬停变化；移动端抽屉同样出现
- `/murmurs/` 打开：卡片进场 stagger、滚动显入、hover 上浮；空态/失败重试
- 右下角"留言"→ 登录层；错误密码抖动提示；正确密码后用户芯片出现，卡片 hover 出现删除按钮
- 发布：纯文字 → 顶部弹入；带图 → 压缩上传成功显示；字数计数
- 删除：确认 → 卡片淡出；Supabase Storage 中对应 `murmur_*` 文件消失
- 刷新页面：会话仍在（≤7 天）；"退出"后回到未登录态
- 真实匿名 POST（curl）被拒（RLS）

- [ ] **Step 4: 收尾提交（如有修复）并汇报**

```bash
git status --short && git log --oneline -6
```
Expected: 工作区仅剩用户自己的无关改动；6 个 feature/docs commit 在本地（不推送）。
