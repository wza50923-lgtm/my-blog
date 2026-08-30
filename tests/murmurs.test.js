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
