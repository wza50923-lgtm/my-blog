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

function rows(n, startId) {
  return Array.from({ length: n }, (_, i) => ({
    id: (startId || 0) + i + 1, content: '碎碎念 #' + i,
    image_url: null, created_at: '2026-08-30T10:00:00Z'
  }));
}

test('渲染：4 条数据 → 4 张卡片 + 转义 + 配图守卫 + 计数', () => {
  const { doc, MZ } = setup(() => ({ status: 200, body: JSON.stringify([
    { id: 1, content: '<img src=x onerror=alert(1)>注入', image_url: null, created_at: '2026-08-30T10:00:00Z' },
    { id: 2, content: '有图', image_url: 'https://dxfxkflqcjifrjqvgzeh.supabase.co/storage/v1/object/public/photos/murmur_1_a.jpg', created_at: '2026-08-30T09:00:00Z' },
    { id: 3, content: '坏图', image_url: 'javascript:alert(1)', created_at: '2026-08-30T08:00:00Z' },
    { id: 4, content: '外域图', image_url: 'https://evil.com/object/public/photos/x.jpg', created_at: '2026-08-30T07:00:00Z' }
  ]) }));
  assert.strictEqual(doc().querySelectorAll('#mzWall .card').length, 4);
  const c1 = doc().querySelectorAll('#mzWall .card')[0];
  assert.ok(c1.querySelector('.mz-content').innerHTML.includes('&lt;img'), '内容必须被转义');
  assert.strictEqual(c1.querySelector('img.mz-img'), null);
  assert.ok(doc().querySelectorAll('#mzWall .card')[1].querySelector('img.mz-img'), '合法桶地址才渲染 <img>');
  assert.strictEqual(doc().querySelectorAll('#mzWall .card')[2].querySelector('img.mz-img'), null, '非法 URL 不渲染');
  assert.strictEqual(doc().querySelectorAll('#mzWall .card')[3].querySelector('img.mz-img'), null, '非本桶域名不渲染');
  assert.ok(doc().getElementById('mzCount').textContent.includes('4'));
  assert.ok(MZ().fmtTime('2026-08-30T10:00:00Z').length >= 16, '时间格式化非空');
});

test('空态：空数组显示空态', () => {
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

function loginFor(ctx){ // 通过 UI 登录（密码=right），返回 ctx
  const d=ctx.doc();
  d.getElementById('mzFab').click();
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
