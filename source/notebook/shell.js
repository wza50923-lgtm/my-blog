'use strict';
/**
 * 笔记本外壳脚本。
 *
 * 职责：
 *   1. 读取构建时生成的 books.json（由 scripts/notebook-books.js 扫描 source/notebook 得到）；
 *   2. 渲染侧边栏书目与「书架」视图 —— 页面默认停在书架，不直接翻开某一本；
 *   3. 只有带 ?book=<文件夹名> 时才把翻页相册挂载起来（相册打包脚本已改成
 *      只暴露 window.__nbMountAlbum()，不再自动挂载）。
 *
 * 新增笔记不需要改这里的任何代码，只在 source/notebook 下新建文件夹放编号图片即可。
 */
(function () {
  var BOOKS_URL = 'books.json';

  var dom = {
    shell: document.getElementById('nb-shell'),
    main: document.getElementById('nb-main'),
    list: document.getElementById('nb-book-list'),
    cards: document.getElementById('nb-cards'),
    count: document.getElementById('nb-side-count'),
    msg: document.getElementById('nb-library-msg'),
    sidebarBtn: document.getElementById('nb-sidebar-btn'),
    fullscreenBtn: document.getElementById('nb-fullscreen-btn'),
    mask: document.getElementById('nb-drawer-mask')
  };

  var SIDEBAR_KEY = 'nb.sidebar';
  var DESKTOP_MIN_WIDTH = 1000;

  var requestedId = (new URLSearchParams(window.location.search).get('book') || '').trim();

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function bookHref(id) {
    return '?book=' + encodeURIComponent(id);
  }

  function showMessage(html) {
    if (!dom.msg) return;
    dom.msg.innerHTML = html;
    dom.msg.hidden = false;
  }

  function renderSidebar(books, activeId) {
    if (!dom.list) return;
    dom.list.textContent = '';
    books.forEach(function (book) {
      var item = document.createElement('li');
      var link = document.createElement('a');
      link.className = 'nb-book-link' + (book.id === activeId ? ' is-active' : '');
      link.href = bookHref(book.id);
      if (book.id === activeId) link.setAttribute('aria-current', 'true');

      var title = document.createElement('span');
      title.className = 'nb-book-title';
      title.textContent = book.title;

      var meta = document.createElement('span');
      meta.className = 'nb-book-meta';
      meta.textContent =
        book.count + ' 页' + (book.title === book.id ? '' : ' · ' + book.id);

      link.appendChild(title);
      link.appendChild(meta);
      item.appendChild(link);
      dom.list.appendChild(item);
    });
    if (dom.count) {
      dom.count.textContent = books.length ? books.length + ' 本笔记' : '还没有笔记';
    }
  }

  function renderLibrary(books) {
    if (!dom.cards) return;
    dom.cards.textContent = '';
    books.forEach(function (book) {
      var card = document.createElement('a');
      card.className = 'nb-card';
      card.href = bookHref(book.id);

      var head = document.createElement('div');
      var title = document.createElement('span');
      title.className = 'nb-card-title';
      title.textContent = book.title;
      head.appendChild(title);
      // 文件夹名和书名不一致时才提示，避免和标题重复
      if (book.title !== book.id) {
        var sub = document.createElement('span');
        sub.className = 'nb-card-sub';
        sub.textContent = '文件夹：' + book.id;
        head.appendChild(sub);
      }

      var foot = document.createElement('span');
      foot.className = 'nb-card-foot';
      foot.textContent = book.count + ' 页';

      card.appendChild(head);
      card.appendChild(foot);
      dom.cards.appendChild(card);
    });
  }

  function mountAlbum(book) {
    // 相册打包脚本读取这三个全局变量决定读哪本、读哪些页
    window.__NOTEBOOK_DIR = book.dir;
    window.__NOTEBOOK_TITLE = book.title;
    if (Array.isArray(book.pages) && book.pages.length) {
      window.__NOTEBOOK_PAGES = book.pages;
    }
    document.title = book.title + ' · 翻页笔记本';
    dom.main.classList.add('is-reading');

    var start = function () {
      if (typeof window.__nbMountAlbum === 'function') {
        window.__nbMountAlbum();
      }
    };
    // 相册是 <script type="module">，要等它执行完（DOMContentLoaded 之后）才能调用
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }
  }

  function isWide() {
    return window.innerWidth > DESKTOP_MIN_WIDTH;
  }

  /** 当前侧边栏是否可见：宽屏看折叠类，窄屏看抽屉类 */
  function sidebarVisible() {
    return isWide()
      ? !dom.shell.classList.contains('is-sidebar-collapsed')
      : dom.shell.classList.contains('is-drawer-open');
  }

  function syncSidebarButton() {
    if (!dom.sidebarBtn) return;
    var visible = sidebarVisible();
    dom.sidebarBtn.setAttribute('aria-expanded', visible ? 'true' : 'false');
    dom.sidebarBtn.setAttribute('aria-label', visible ? '隐藏笔记书目' : '显示笔记书目');
  }

  function setCollapsed(collapsed) {
    dom.shell.classList.toggle('is-sidebar-collapsed', collapsed);
    try {
      // 换书是整页跳转，状态存起来才不会每次都被展开
      window.localStorage.setItem(SIDEBAR_KEY, collapsed ? 'hidden' : 'shown');
    } catch (err) {
      /* 隐私模式下 localStorage 不可用，忽略 */
    }
    syncSidebarButton();
  }

  function openDrawer() {
    dom.shell.classList.add('is-drawer-open');
    syncSidebarButton();
  }

  function closeDrawer() {
    dom.shell.classList.remove('is-drawer-open');
    syncSidebarButton();
  }

  function toggleSidebar() {
    if (isWide()) {
      setCollapsed(!dom.shell.classList.contains('is-sidebar-collapsed'));
    } else if (dom.shell.classList.contains('is-drawer-open')) {
      closeDrawer();
    } else {
      openDrawer();
    }
  }

  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function fullscreenSupported() {
    var el = document.documentElement;
    return !!(el.requestFullscreen || el.webkitRequestFullscreen);
  }

  function syncFullscreenButton() {
    if (!dom.fullscreenBtn) return;
    var on = !!fullscreenElement();
    dom.shell.classList.toggle('is-fullscreen', on);
    dom.fullscreenBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    dom.fullscreenBtn.setAttribute('aria-label', on ? '退出全屏' : '全屏显示');
  }

  function toggleFullscreen() {
    var el = document.documentElement;
    var exit = document.exitFullscreen || document.webkitExitFullscreen;
    var enter = el.requestFullscreen || el.webkitRequestFullscreen;
    if (fullscreenElement()) {
      if (exit) exit.call(document);
    } else if (enter) {
      var result = enter.call(el);
      if (result && typeof result.then === 'function') {
        result.then(syncFullscreenButton, syncFullscreenButton);
      }
    }
  }

  function bindControls() {
    if (dom.sidebarBtn) dom.sidebarBtn.addEventListener('click', toggleSidebar);
    if (dom.fullscreenBtn) {
      if (fullscreenSupported()) {
        dom.fullscreenBtn.addEventListener('click', toggleFullscreen);
      } else {
        // 浏览器不支持全屏（如部分 iOS 浏览器）就干脆不显示这个按钮
        dom.fullscreenBtn.hidden = true;
      }
    }
    if (dom.mask) dom.mask.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeDrawer();
    });
    document.addEventListener('fullscreenchange', syncFullscreenButton);
    document.addEventListener('webkitfullscreenchange', syncFullscreenButton);
    window.addEventListener('resize', function () {
      if (isWide()) closeDrawer();
      syncSidebarButton();
    });
    syncSidebarButton();
    syncFullscreenButton();
  }

  function afterBooksLoaded(books, error) {
    var active = null;
    for (var i = 0; i < books.length; i += 1) {
      if (books[i].id === requestedId) {
        active = books[i];
        break;
      }
    }

    renderSidebar(books, active ? active.id : requestedId);
    renderLibrary(books);

    if (!requestedId) {
      document.title = '我的笔记本 · 翻页笔记本';
      if (error) showMessage(booksUnavailableMessage());
      else if (!books.length) showMessage(emptyLibraryMessage());
      return;
    }

    if (active) {
      mountAlbum(active);
      return;
    }

    if (error) {
      // 清单读不到（例如直接双击 html 打开）：退化为按文件夹名探测，保持可用
      mountAlbum({ id: requestedId, title: requestedId, dir: requestedId, count: 0, pages: null });
      return;
    }

    showMessage(
      '没有找到名为 <code>' + escapeHtml(requestedId) + '</code> 的笔记。' +
        '请从左侧（窄屏为左上角按钮）的书目里重新选择，或确认该文件夹里已经放好从 01 开始编号的图片。'
    );
  }

  function emptyLibraryMessage() {
    return (
      '书架还是空的。在 <code>source/notebook/</code> 下新建一个文件夹（例如 <code>我的笔记</code>），' +
      '把图片按 <code>01.jpg</code>、<code>02.jpg</code>、<code>03.jpg</code>… 连续编号放进去，' +
      '然后执行 <code>hexo generate</code>（用本地调试则重启 <code>hexo server</code>），这里就会出现这本笔记。'
    );
  }

  function booksUnavailableMessage() {
    return (
      '读取书目清单 <code>books.json</code> 失败。请先执行 <code>hexo generate</code>，' +
      '并通过本地服务器或线上站点访问本页；直接双击打开 html 文件时浏览器不允许读取该清单。'
    );
  }

  function init() {
    bindControls();
    fetch(BOOKS_URL, { cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (data) {
        var books = data && Array.isArray(data.books) ? data.books : [];
        afterBooksLoaded(books, null);
      })
      .catch(function (err) {
        if (window.console && console.warn) {
          console.warn('[notebook] 读取 ' + BOOKS_URL + ' 失败：', err && err.message ? err.message : err);
        }
        afterBooksLoaded([], err || new Error('load failed'));
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
