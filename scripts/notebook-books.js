'use strict';
/**
 * 扫描 source/notebook 下的「一本书一个文件夹」，生成 /notebook/books.json。
 *
 * 目录约定（新增笔记只需要建文件夹，不用改任何代码）：
 *   source/notebook/<笔记名>/01.jpg、02.jpg、03.jpg …
 *   source/notebook/<笔记名>/photos/01.jpg …（兼容把图片放在 photos 子目录的写法）
 *
 * 编号规则与页面一致：从 01 开始，连续缺号达到 MISS_LIMIT 张后停止扫描，
 * 超过上限的页不再计入。没有编号图片的文件夹不会出现在书架里。
 */

const fs = require('fs');
const path = require('path');

/** 扩展名优先级，必须与页面里探测图片的顺序一致 */
const EXT_ORDER = ['jpg', 'jpeg', 'png', 'webp'];
const IMAGE_RE = /^(\d+)\.([A-Za-z0-9]+)$/;
const MAX_PAGES = 500;
const MISS_LIMIT = 5;
const BOOKS_ROUTE = 'notebook/books.json';

function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch (err) {
    return false;
  }
}

/**
 * 读出一个文件夹里按 01、02…编号的图片，按页序返回文件名。
 * @param {string} dir 图片所在目录（绝对路径）
 * @returns {string[]} 从第 1 页开始、连续可用的文件名
 */
function collectPages(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    return [];
  }

  // number -> { name, rank }，同一编号命中多个文件时按扩展名优先级、补零写法取优
  const byNumber = new Map();
  for (const name of names) {
    const matched = IMAGE_RE.exec(name);
    if (!matched) continue;
    const rank = EXT_ORDER.indexOf(matched[2].toLowerCase());
    if (rank === -1) continue;
    const number = Number.parseInt(matched[1], 10);
    if (!Number.isInteger(number) || number < 1) continue;

    const previous = byNumber.get(number);
    const better =
      !previous ||
      rank < previous.rank ||
      (rank === previous.rank && name.length > previous.name.length);
    if (better) byNumber.set(number, { name, rank });
  }

  const pages = [];
  let missRun = 0;
  for (let number = 1; number <= MAX_PAGES && missRun < MISS_LIMIT; number += 1) {
    const hit = byNumber.get(number);
    if (hit) {
      pages.push(hit.name);
      missRun = 0;
    } else {
      missRun += 1;
    }
  }
  return pages;
}

/** 去掉文件夹名里的排序前缀（如 01-数学笔记、02 线性代数 → 数学笔记 / 线性代数），没有前缀则原样返回 */
function displayTitle(folderName) {
  const matched = /^\d+[\s\-_.、)）]+(.+)$/.exec(folderName);
  const title = matched ? matched[1].trim() : '';
  return title || folderName;
}

/**
 * 列出一本书以上的笔记清单。
 * @param {string} notebookDir source/notebook 的绝对路径
 * @returns {{id:string,title:string,dir:string,count:number,pages:string[]}[]}
 */
function listBooks(notebookDir) {
  let entries;
  try {
    entries = fs.readdirSync(notebookDir, { withFileTypes: true });
  } catch (err) {
    return [];
  }

  const books = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // 与 Hexo 一致：以 . 或 _ 开头的目录不作为笔记
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;

    const bookDir = path.join(notebookDir, entry.name);
    let dir = entry.name;
    let pages = collectPages(bookDir);

    if (!pages.length) {
      const photosDir = path.join(bookDir, 'photos');
      if (isDirectory(photosDir)) {
        const nested = collectPages(photosDir);
        if (nested.length) {
          pages = nested;
          dir = `${entry.name}/photos`;
        }
      }
    }
    if (!pages.length) continue;

    books.push({
      id: entry.name,
      title: displayTitle(entry.name),
      dir,
      count: pages.length,
      pages: pages.map((page) => encodeURI(`${dir}/${page}`))
    });
  }

  books.sort((a, b) => a.id.localeCompare(b.id, 'zh-Hans-CN', { numeric: true }));
  return books;
}

// 由 Hexo 加载时（scripts/*.js 会拿到 hexo 参数）注册生成器；被单元测试 require 时跳过
if (typeof hexo !== 'undefined' && hexo && hexo.extend) {
  hexo.extend.generator.register('notebook_books', function () {
    const books = listBooks(path.join(hexo.source_dir, 'notebook'));
    return [
      {
        path: BOOKS_ROUTE,
        data: JSON.stringify({ generatedAt: new Date().toISOString(), books }, null, 2)
      }
    ];
  });
}

module.exports = { listBooks, collectPages, displayTitle, BOOKS_ROUTE, MAX_PAGES, MISS_LIMIT };
