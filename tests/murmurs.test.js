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
