'use strict';
// 翻页笔记本（/notebook）多笔记模式的守卫测试。
// 页面是自带 React 打包产物的纯静态 HTML（skip_render），jsdom 跑不了
// <script type="module">，所以这里守住三类真正会导致线上出问题的静态条件：
//   1. 站点接线（skip_render / 菜单图标 / 外壳文件）
//   2. 打包脚本被正确改造（按 ?book= 选书、按 books.json 给页、不自动挂载）
//   3. 书本扫描与图片编号契约（新增文件夹就能变成一本笔记）
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const NOTEBOOK = path.join(ROOT, 'source', 'notebook');
const PAGE = path.join(NOTEBOOK, 'index.html');
const scanner = require('../scripts/notebook-books.js');

const readPage = () => fs.readFileSync(PAGE, 'utf8');
const bundleOf = (html) => {
  const matched = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(matched, '缺少 type="module" 的打包脚本');
  return matched[1];
};

test('站点接线：skip_render 放行 + 菜单与 Gallery 同级 + SVG 图标样式存在', () => {
  const config = fs.readFileSync(path.join(ROOT, '_config.yml'), 'utf8');
  assert.match(config, /skip_render:[\s\S]*?'notebook\/\*\*'/, '未在 skip_render 放行 notebook/**');

  const themeConfig = fs.readFileSync(path.join(ROOT, '_config.keep.yml'), 'utf8');
  assert.match(
    themeConfig,
    /^[ \t]*笔记:[ \t]*\/notebook[ \t]*\|\|[ \t]*note-icon[ \t]*$/m,
    '菜单缺少「笔记: /notebook || note-icon」'
  );

  const css = fs.readFileSync(path.join(ROOT, 'source', 'css', 'custom.css'), 'utf8');
  assert.match(css, /\.menu-icon\.note-icon\s*\{[^}]*mask:[^}]*\}/, '缺少 .menu-icon.note-icon 的 mask 图标样式');
  assert.match(css, /\.menu-icon\.note-icon\s*\{[^}]*currentColor[^}]*\}/, '图标未使用 currentColor');
});

test('页面外壳：书架 / 侧边栏结构齐全并接好 shell.css、shell.js', () => {
  const html = readPage();
  for (const id of ['nb-shell', 'nb-sidebar', 'nb-book-list', 'nb-cards', 'nb-library-msg', 'nb-menu-btn', 'nb-drawer-mask', 'root']) {
    assert.ok(html.includes(`id="${id}"`), `缺少 #${id}`);
  }
  assert.ok(html.includes('href="shell.css"'), '未引入 shell.css');
  assert.ok(html.includes('src="shell.js"'), '未引入 shell.js');
  assert.match(html, /<title>[^<]*笔记本[^<]*<\/title>/, '页面标题异常');

  const css = fs.readFileSync(path.join(NOTEBOOK, 'shell.css'), 'utf8');
  assert.match(css, /#nb-main\s*\.book-rig\s*\{/, 'shell.css 缺少相册宽度适配（带侧边栏后书本会被挤出容器）');
  assert.match(css, /@media \(max-width: 1000px\)/, 'shell.css 缺少窄屏抽屉断点');

  const js = fs.readFileSync(path.join(NOTEBOOK, 'shell.js'), 'utf8');
  assert.ok(js.includes('books.json'), 'shell.js 未读取 books.json');
  assert.ok(js.includes('__nbMountAlbum'), 'shell.js 未调用相册挂载入口');
});

test('打包脚本：按书取图、按清单给页、只在选书后挂载', () => {
  const bundle = bundleOf(readPage());
  assert.doesNotThrow(() => new vm.Script(bundle), '打包脚本语法错误，页面会白屏');

  assert.ok(bundle.includes(',NB=()=>window.__NOTEBOOK_DIR||`photos`;'), '缺少取图目录的全局开关');
  assert.strictEqual(bundle.split('${NB()}').length - 1, 4, '取图路径必须全部走 NB()（4 处）');
  assert.strictEqual(bundle.split('photos/').length - 1, 0, '仍有硬编码的 photos/ 路径');

  assert.ok(
    bundle.includes('window.__NOTEBOOK_PAGES&&window.__NOTEBOOK_PAGES.length'),
    '缺少「按 books.json 页清单直接渲染」的快路径'
  );
  assert.ok(bundle.includes('window.__nbMountAlbum=function()'), '缺少挂载入口 window.__nbMountAlbum');

  // 关键：脚本尾部只能定义入口，不能自己挂载，否则 /notebook 会直接翻开某本笔记
  const tail = bundle.trim().slice(-160);
  assert.ok(!/^\}\)\(\);?$/.test(tail), '打包脚本仍在自动挂载，书架首页会直接进入笔记');
  assert.ok(/window\.__nbMountAlbum=function\(\)\{[\s\S]*\};$/.test(bundle.trim()), '打包脚本尾部结构异常');

  // 触摸翻页脚本靠这两个 aria-label 找按钮，改名会让移动端翻页失效
  assert.ok(bundle.includes('`Previous page`') && bundle.includes('`Next page`'), '翻页按钮 aria-label 被改动');

  // End 键必须落到「跨页」的合法起始页：页数为偶数时 flip(l-1) 会让相册卡在 is-turning
  assert.ok(
    bundle.includes('flip(l-1-(l-1)%2,`bottom`)'),
    'End 键跳末页未做奇偶对齐，页数为偶数时会把翻页按钮卡死'
  );
  assert.ok(!bundle.includes('flip(l-1,`bottom`)'), '仍存在未对齐的 End 键跳转');
});

test('书本扫描：文件夹即一本书，图片可直接放或放 photos 子目录', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-books-'));
  try {
    // 01-数学笔记：直接放图，带排序前缀
    const a = path.join(tmp, '01-数学笔记');
    fs.mkdirSync(a);
    for (const n of ['01', '02', '03']) fs.writeFileSync(path.join(a, `${n}.jpg`), 'x');
    // 英语笔记：放 photos 子目录
    const b = path.join(tmp, '英语笔记', 'photos');
    fs.mkdirSync(b, { recursive: true });
    for (const n of ['01', '02']) fs.writeFileSync(path.join(b, `${n}.jpg`), 'x');
    // 空文件夹：没有编号图片，不该成为一本书
    fs.mkdirSync(path.join(tmp, '草稿'));
    fs.writeFileSync(path.join(tmp, '草稿', '随手拍.jpg'), 'x');
    // 下划线/点开头：与 Hexo 一致，忽略
    fs.mkdirSync(path.join(tmp, '_模板'));
    fs.writeFileSync(path.join(tmp, '_模板', '01.jpg'), 'x');
    fs.writeFileSync(path.join(tmp, 'notebook.md'), 'x');

    const books = scanner.listBooks(tmp);
    assert.deepStrictEqual(
      books.map((bk) => bk.id),
      ['01-数学笔记', '英语笔记'],
      '书架清单与预期不符'
    );
    assert.strictEqual(books[0].title, '数学笔记', '排序前缀应从显示名里去掉');
    assert.strictEqual(books[0].count, 3);
    assert.deepStrictEqual(books[0].pages, [
      encodeURI('01-数学笔记/01.jpg'),
      encodeURI('01-数学笔记/02.jpg'),
      encodeURI('01-数学笔记/03.jpg')
    ]);
    assert.strictEqual(books[1].dir, '英语笔记/photos', 'photos 子目录写法要能识别');
    assert.strictEqual(books[1].count, 2);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('编号契约：从 01 开始、连续缺号达到 5 张就截断、扩展名有优先级', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-pages-'));
  try {
    for (const name of ['01.jpg', '02.jpeg', '03.png', '04.webp', '01.png', '06.jpg']) {
      fs.writeFileSync(path.join(tmp, name), 'x');
    }
    // 01 同时有 jpg/png → 取 jpg；缺 05 但未达 5 连缺 → 继续；07 之后连缺 5 张即停
    const pages = scanner.collectPages(tmp);
    assert.deepStrictEqual(pages, ['01.jpg', '02.jpeg', '03.png', '04.webp', '06.jpg']);

    const gap = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-gap-'));
    try {
      fs.writeFileSync(path.join(gap, '01.jpg'), 'x');
      fs.writeFileSync(path.join(gap, '07.jpg'), 'x'); // 缺 02-06 共 5 张
      assert.deepStrictEqual(scanner.collectPages(gap), ['01.jpg'], '连缺 5 张后必须停止扫描');
    } finally {
      fs.rmSync(gap, { recursive: true, force: true });
    }

    assert.strictEqual(scanner.displayTitle('02 线性代数'), '线性代数');
    assert.strictEqual(scanner.displayTitle('2024笔记'), '2024笔记', '没有分隔符时不应误删前缀');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('真实笔记目录：每本书都能被扫描到，且页序从 01 开始', () => {
  const books = scanner.listBooks(NOTEBOOK);
  assert.ok(books.length > 0, 'source/notebook 下没有识别到任何一本笔记');

  for (const book of books) {
    assert.strictEqual(book.pages.length, book.count, `${book.id}: 页数与清单不一致`);
    assert.ok(book.count > 0, `${book.id}: 没有可用页`);
    const first = decodeURI(book.pages[0]);
    assert.match(first, /\/01\.[a-z]+$/i, `${book.id}: 第一页必须是从 01 开始的编号图片`);
    for (const page of book.pages) {
      const abs = path.join(NOTEBOOK, decodeURIComponent(page));
      assert.ok(fs.existsSync(abs), `${book.id}: 清单里的 ${page} 在磁盘上不存在`);
    }
  }
});
