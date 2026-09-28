/* =========================================================================
 * utils.js —— 全局工具函数库
 * 提供：ID 生成、日期处理、安全转义、内容清洗、提示、图标等
 * 无任何外部依赖，直接挂载到 window.Utils
 * ========================================================================= */
(function (global) {
  'use strict';

  /* ---------------------------------------------------------------- 常量 */
  var ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

  /* 富文本允许保留的标签白名单（防 XSS） */
  var ALLOWED_TAGS = {
    B: 1, STRONG: 1, I: 1, EM: 1, U: 1, S: 1, STRIKE: 1, DEL: 1,
    UL: 1, OL: 1, LI: 1, P: 1, BR: 1, DIV: 1, SPAN: 1,
    H3: 1, H4: 1, BLOCKQUOTE: 1, CODE: 1, PRE: 1
  };

  var WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];

  /* ------------------------------------------------------------- ID 生成 */
  /** 生成形如 p_8f3k2a1b 的唯一 ID */
  function uid(prefix) {
    var out = '';
    for (var i = 0; i < 8; i++) {
      out += ID_ALPHABET.charAt(Math.floor(Math.random() * ID_ALPHABET.length));
    }
    return (prefix || 'id') + '_' + Date.now().toString(36) + out;
  }

  /* ------------------------------------------------------------- 日期处理 */
  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  /** Date -> 'YYYY-MM-DD'（本地时区） */
  function formatDate(date) {
    var d = toDate(date);
    if (!d) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /** ISO/日期字符串 -> 'YYYY-MM-DD HH:mm' */
  function formatDateTime(value) {
    var d = toDate(value);
    if (!d) return '';
    return formatDate(d) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  /** ISO/日期字符串 -> 'YYYY-MM-DD HH:mm:ss' */
  function formatFull(value) {
    var d = toDate(value);
    if (!d) return '';
    return formatDateTime(d) + ':' + pad2(d.getSeconds());
  }

  /** 任意输入 -> Date（失败返回 null） */
  function toDate(value) {
    if (!value && value !== 0) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number') { var dn = new Date(value); return isNaN(dn.getTime()) ? null : dn; }
    var str = String(value).trim();
    // 'YYYY-MM-DD' 按本地时区解析，避免被当成 UTC 而差一天
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    var d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }

  /** 今天的 'YYYY-MM-DD' */
  function today() { return formatDate(new Date()); }

  /** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 / YYYY-MM-DD */
  function relativeTime(value) {
    var d = toDate(value);
    if (!d) return '—';
    var diff = Date.now() - d.getTime();
    if (diff < 0) diff = 0;
    var min = Math.floor(diff / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return min + ' 分钟前';
    var hour = Math.floor(min / 60);
    if (hour < 24) return hour + ' 小时前';
    var day = Math.floor(hour / 24);
    if (day < 30) return day + ' 天前';
    return formatDate(d);
  }

  /** 中文星期，如 '周一' */
  function weekdayCN(value) {
    var d = toDate(value);
    return d ? '周' + WEEK_CN[d.getDay()] : '';
  }

  /** 判断两个日期是否为同一天 */
  function isSameDay(a, b) {
    var da = toDate(a), db = toDate(b);
    if (!da || !db) return false;
    return formatDate(da) === formatDate(db);
  }

  /** 求两个 'YYYY-MM-DD' 之间相差的天数 */
  function daysBetween(a, b) {
    var da = toDate(a), db = toDate(b);
    if (!da || !db) return 0;
    return Math.round((db.getTime() - da.getTime()) / 86400000);
  }

  /* --------------------------------------------------------------- 字符串 */
  /** HTML 转义，防止注入 */
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** 清洗富文本：仅保留白名单标签，剥离所有属性与脚本 */
  function sanitizeHtml(html) {
    var raw = String(html === null || html === undefined ? '' : html);
    if (/<[a-z!/]/i.test(raw) === false) return escapeHtml(raw).replace(/\r?\n/g, '<br>');

    var doc;
    try {
      doc = new DOMParser().parseFromString('<div id="__sanitize_root__">' + raw + '</div>', 'text/html');
    } catch (e) { return escapeHtml(raw); }

    var root = doc.getElementById('__sanitize_root__');
    if (!root) return escapeHtml(raw);

    var out = doc.createElement('div');
    copySafe(root, out, doc);
    return out.innerHTML;
  }

  function copySafe(node, target, doc) {
    var children = node.childNodes;
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (child.nodeType === 3) {                       // 文本节点
        target.appendChild(doc.createTextNode(child.nodeValue));
        continue;
      }
      if (child.nodeType !== 1) continue;               // 忽略注释等

      var tag = child.tagName.toUpperCase();
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'IFRAME' ||
          tag === 'OBJECT' || tag === 'EMBED' || tag === 'LINK' ||
          tag === 'META' || tag === 'FORM' || tag === 'INPUT') continue;

      if (!ALLOWED_TAGS[tag]) {                         // 不在白名单：拆掉外壳保留文字
        copySafe(child, target, doc);
        continue;
      }
      var el = doc.createElement(tag.toLowerCase());
      target.appendChild(el);
      copySafe(child, el, doc);
    }
  }

  /** 富文本 -> 纯文本（用于全文搜索与摘要） */
  function htmlToText(html) {
    var safe = sanitizeHtml(html)
      .replace(/<\/(p|div|li|h3|h4|blockquote|pre)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n');
    var tmp = document.createElement('div');
    tmp.innerHTML = safe;
    var text = tmp.textContent || '';
    return text
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /** 截断文本，超出补省略号 */
  function clampText(text, max) {
    var str = String(text === null || text === undefined ? '' : text).replace(/\s+/g, ' ').trim();
    if (str.length <= max) return str;
    return str.slice(0, max) + '…';
  }

  /** 关键字高亮（返回已转义的 HTML 片段） */
  function highlight(text, keyword) {
    var safe = escapeHtml(text);
    if (!keyword) return safe;
    var kw = escapeHtml(keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      return safe.replace(new RegExp('(' + kw + ')', 'gi'), '<mark>$1</mark>');
    } catch (e) { return safe; }
  }

  /* ------------------------------------------------------------- 函数工具 */
  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments, ctx = this;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { timer = null; fn.apply(ctx, args); }, wait || 260);
    };
  }

  function deepClone(obj) {
    try { return JSON.parse(JSON.stringify(obj)); } catch (e) { return obj; }
  }

  /** 按 key 分组 */
  function groupBy(list, keyFn) {
    var map = {};
    (list || []).forEach(function (item) {
      var key = keyFn(item);
      (map[key] = map[key] || []).push(item);
    });
    return map;
  }

  /* --------------------------------------------------------------- DOM 助手 */
  function $(selector, root) { return (root || document).querySelector(selector); }
  function $$(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }

  /** 创建元素：el('div', {class:'x', html:'...'}, [childNodes]) */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class' || k === 'className') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k.indexOf('on') === 0 && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset' && typeof v === 'object') Object.assign(node.dataset, v);
      else node.setAttribute(k, v);
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  /* ----------------------------------------------------------------- 提示 */
  var TOAST_ICON = { ok: 'check-circle', error: 'alert-circle', warn: 'alert-triangle', info: 'info' };

  /** 轻提示：toast('已保存', 'ok') */
  function toast(message, type, duration) {
    var kind = type || 'info';
    var wrap = document.getElementById('toastWrap');
    if (!wrap) {
      wrap = el('div', { id: 'toastWrap', class: 'toast-wrap' });
      document.body.appendChild(wrap);
    }
    var item = el('div', { class: 'toast toast--' + kind, role: 'status' }, [
      el('span', { class: 'toast__ico', html: icon(TOAST_ICON[kind] || 'info') }),
      el('span', { class: 'toast__msg', text: String(message == null ? '' : message) })
    ]);
    wrap.appendChild(item);
    void item.offsetWidth;                // 强制重排以播放入场过渡（后台标签页 rAF 会被暂停）
    item.classList.add('is-in');
    var ttl = duration || 2600;
    setTimeout(function () {
      item.classList.remove('is-in');
      item.classList.add('is-out');
      setTimeout(function () { if (item.parentNode) item.parentNode.removeChild(item); }, 240);
    }, ttl);
  }

  /* ----------------------------------------------------------------- 图标 */
  /* 精简的 stroke 图标集（24x24 viewBox，currentColor 描边） */
  var ICONS = {
    'dashboard': '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    'list': '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1.3"/><circle cx="3.5" cy="12" r="1.3"/><circle cx="3.5" cy="18" r="1.3"/>',
    'folder': '<path d="M3 7.5A2 2 0 0 1 5 5.5h3.4a2 2 0 0 1 1.6.8l.9 1.2H19a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    'plus': '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    'search': '<circle cx="11" cy="11" r="6.5"/><line x1="16" y1="16" x2="21" y2="21"/>',
    'edit': '<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z"/><line x1="14.5" y1="6" x2="18" y2="9.5"/>',
    'trash': '<path d="M4 7h16"/><path d="M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
    'calendar': '<rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/>',
    'archive': '<rect x="3" y="4" width="18" height="4.5" rx="1.2"/><path d="M5 8.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V8.5"/><line x1="10" y1="13" x2="14" y2="13"/>',
    'archive-restore': '<rect x="3" y="4" width="18" height="4.5" rx="1.2"/><path d="M5 8.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V8.5"/><polyline points="9.5,15.5 12,13 14.5,15.5"/><line x1="12" y1="13" x2="12" y2="18"/>',
    'close': '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
    'clock': '<circle cx="12" cy="12" r="8.5"/><polyline points="12,7.5 12,12 15.5,14"/>',
    'tag': '<path d="M20 12.5 12.5 20a2 2 0 0 1-2.8 0L4 14.3V4h10.3l5.7 5.7a2 2 0 0 1 0 2.8z"/><circle cx="8.5" cy="8.5" r="1.4"/>',
    'filter': '<path d="M3 5h18l-7 8v6l-4-2v-4z"/>',
    'link': '<path d="M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.54 3.54 0 0 0-5-5l-1.2 1.2"/><path d="M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.54 3.54 0 0 0 5 5l1.2-1.2"/>',
    'chart': '<line x1="4" y1="20" x2="20" y2="20"/><rect x="6" y="11" width="3" height="9" rx="1"/><rect x="10.5" y="7" width="3" height="13" rx="1"/><rect x="15" y="14" width="3" height="6" rx="1"/>',
    'pie': '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5V12l7.5 4.2"/>',
    'check': '<polyline points="5,12.5 10,17.5 19,7"/>',
    'check-circle': '<circle cx="12" cy="12" r="8.5"/><polyline points="8.2,12.3 11,15 16,9.5"/>',
    'alert-circle': '<circle cx="12" cy="12" r="8.5"/><line x1="12" y1="8" x2="12" y2="13"/><circle cx="12" cy="16.3" r="0.9" fill="currentColor" stroke="none"/>',
    'alert-triangle': '<path d="M12 4.2 21 19.5H3z"/><line x1="12" y1="9.5" x2="12" y2="14"/><circle cx="12" cy="16.8" r="0.9" fill="currentColor" stroke="none"/>',
    'info': '<circle cx="12" cy="12" r="8.5"/><line x1="12" y1="11" x2="12" y2="16.5"/><circle cx="12" cy="7.8" r="0.9" fill="currentColor" stroke="none"/>',
    'chevron-left': '<polyline points="15,5 8,12 15,19"/>',
    'chevron-right': '<polyline points="9,5 16,12 9,19"/>',
    'chevron-down': '<polyline points="5,9 12,16 19,9"/>',
    'save': '<path d="M5 4h10l4 4v12a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20z"/><polyline points="8,4 8,10 15,10"/><rect x="8.5" y="14" width="7" height="4.5" rx="1"/>',
    'history': '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><polyline points="3.5,4 3.5,9 8.5,9"/><polyline points="12,8 12,12.5 15.5,14.5"/>',
    'database': '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v12c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3V6"/><path d="M4.5 12c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3"/>',
    'refresh': '<polyline points="20,5 20,10 15,10"/><polyline points="4,19 4,14 9,14"/><path d="M19.2 10A7.5 7.5 0 0 0 6.1 7.4L4 10"/><path d="M4.8 14a7.5 7.5 0 0 0 13.1 2.6L20 14"/>',
    'external': '<path d="M14 4h6v6"/><polyline points="20,4 11.5,12.5"/><path d="M18 14v5a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 19V7.5A1.5 1.5 0 0 1 5.5 6H10"/>',
    'smile': '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14a4 4 0 0 0 7 0"/><circle cx="9.3" cy="10" r="0.9" fill="currentColor" stroke="none"/><circle cx="14.7" cy="10" r="0.9" fill="currentColor" stroke="none"/>',
    'meh': '<circle cx="12" cy="12" r="8.5"/><line x1="8.7" y1="15" x2="15.3" y2="15"/><circle cx="9.3" cy="10" r="0.9" fill="currentColor" stroke="none"/><circle cx="14.7" cy="10" r="0.9" fill="currentColor" stroke="none"/>',
    'frown': '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 16a4 4 0 0 1 7 0"/><circle cx="9.3" cy="10" r="0.9" fill="currentColor" stroke="none"/><circle cx="14.7" cy="10" r="0.9" fill="currentColor" stroke="none"/>',
    'bold': '<path d="M7 4.5h6a3.75 3.75 0 0 1 0 7.5H7z"/><path d="M7 12h6.8a3.75 3.75 0 0 1 0 7.5H7z"/>',
    'italic': '<line x1="15.5" y1="4.5" x2="9.5" y2="19.5"/><line x1="10" y1="4.5" x2="17" y2="4.5"/><line x1="7" y1="19.5" x2="14" y2="19.5"/>',
    'underline': '<path d="M7 4v7a5 5 0 0 0 10 0V4"/><line x1="5.5" y1="20" x2="18.5" y2="20"/>',
    'ul': '<line x1="9" y1="6.5" x2="20" y2="6.5"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="17.5" x2="20" y2="17.5"/><circle cx="4.6" cy="6.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="4.6" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="4.6" cy="17.5" r="1.3" fill="currentColor" stroke="none"/>',
    'ol': '<line x1="9.5" y1="6.5" x2="20" y2="6.5"/><line x1="9.5" y1="12" x2="20" y2="12"/><line x1="9.5" y1="17.5" x2="20" y2="17.5"/><path d="M4 4.6h1.2v3.4M3.6 8h3"/><path d="M3.5 11.2h2.2l-2.2 2.6h2.3"/><path d="M3.6 16.4h2.1a1 1 0 0 1 0 2H5.2a1 1 0 0 1 0 2h-1.6"/>',
    'quote': '<path d="M9 6.5C6.5 7.6 5 9.9 5 12.6V17.5h5.3V12H7.6c0-1.6.7-2.9 2.2-3.6z"/><path d="M18 6.5c-2.5 1.1-4 3.4-4 6.1v4.9h5.3V12h-2.7c0-1.6.7-2.9 2.2-3.6z"/>',
    'sparkles': '<path d="M12 3.5l1.7 4.3L18 9.5l-4.3 1.7L12 15.5l-1.7-4.3L6 9.5l4.3-1.7z"/><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
    'clock-fast': '<circle cx="12" cy="12" r="8.5"/><polyline points="12,7.5 12,12 16,13.5"/>',
    'moon': '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>'
  };

  /** 返回内联 SVG 字符串：icon('plus', 18) */
  function icon(name, size) {
    var body = ICONS[name] || ICONS['info'];
    var s = size || 18;
    return '<svg class="ico" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true">' + body + '</svg>';
  }

  /* ----------------------------------------------------------------- 导出 */
  global.Utils = {
    uid: uid,
    pad2: pad2,
    formatDate: formatDate,
    formatDateTime: formatDateTime,
    formatFull: formatFull,
    toDate: toDate,
    today: today,
    relativeTime: relativeTime,
    weekdayCN: weekdayCN,
    isSameDay: isSameDay,
    daysBetween: daysBetween,
    escapeHtml: escapeHtml,
    sanitizeHtml: sanitizeHtml,
    htmlToText: htmlToText,
    clampText: clampText,
    highlight: highlight,
    debounce: debounce,
    deepClone: deepClone,
    groupBy: groupBy,
    el: el,
    $: $,
    $$: $$,
    toast: toast,
    icon: icon,
    MOODS: [
      { value: 'smooth',     label: '顺利', icon: 'smile' },
      { value: 'normal',     label: '一般', icon: 'meh' },
      { value: 'frustrated', label: '受挫', icon: 'frown' }
    ],
    PROJECT_STATUS: [
      { value: 'active',    label: '进行中' },
      { value: 'completed', label: '已完成' },
      { value: 'paused',    label: '已搁置' }
    ],
    PROJECT_STATUS_LABEL: { active: '进行中', completed: '已完成', paused: '已搁置' },
    MOOD_LABEL: { smooth: '顺利', normal: '一般', frustrated: '受挫' }
  };
})(window);
