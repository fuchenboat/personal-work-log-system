/* =========================================================================
 * app.js —— 应用主框架
 * 负责：哈希路由、导航栏、模态框系统、确认框、全局启动流程
 *
 * 各业务视图通过注册到 window.App.views 接入：
 *     App.views.logs = { render: function (container, params) { ... } }
 * ========================================================================= */
(function (global) {
  'use strict';

  var U = global.Utils;

  var NAV = [
    { key: 'dashboard', label: '数据看板', icon: 'dashboard' },
    { key: 'logs',      label: '工作日志', icon: 'list' },
    { key: 'projects',  label: '项目管理', icon: 'folder' }
  ];

  var app = {
    NAV: NAV,
    views: {},
    currentView: 'dashboard',
    currentParams: {},
    _modalStack: []
  };

  /* ================================================================ 路由 */
  function parseHash() {
    var raw = String(global.location.hash || '').replace(/^#\/?/, '');
    if (!raw) return { view: 'dashboard', params: {} };

    var qIndex = raw.indexOf('?');
    var path = qIndex === -1 ? raw : raw.slice(0, qIndex);
    var query = qIndex === -1 ? '' : raw.slice(qIndex + 1);

    var params = {};
    query.split('&').forEach(function (pair) {
      if (!pair) return;
      var eq = pair.indexOf('=');
      var k = eq === -1 ? pair : pair.slice(0, eq);
      var v = eq === -1 ? '' : pair.slice(eq + 1);
      try { params[decodeURIComponent(k)] = decodeURIComponent(v); }
      catch (e) { params[k] = v; }
    });

    var view = app.views[path] ? path : 'dashboard';
    return { view: view, params: params };
  }

  function buildHash(view, params) {
    var query = Object.keys(params || {})
      .filter(function (k) { return params[k] !== undefined && params[k] !== null && params[k] !== ''; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
      .join('&');
    return '#/' + view + (query ? '?' + query : '');
  }

  /**
   * 切换视图
   * @param {string} view   'dashboard' | 'logs' | 'projects'
   * @param {object} params 视图参数，如 { date:'2026-09-28', keyword:'x' }
   */
  app.navigate = function (view, params) {
    var target = app.views[view] ? view : 'dashboard';
    var hash = buildHash(target, params || {});
    if (global.location.hash === hash) {
      applyRoute();                       // 相同路由：直接重绘
    } else {
      global.location.hash = hash;        // 触发 hashchange -> applyRoute
    }
  };

  /** 用当前视图参数强制重绘 */
  app.render = function () {
    applyRoute();
  };

  function applyRoute() {
    var route = parseHash();
    app.currentView = route.view;
    app.currentParams = route.params;

    /* 更新导航高亮 */
    U.$$('.nav__item').forEach(function (node) {
      node.classList.toggle('is-active', node.dataset.view === route.view);
    });

    var container = document.getElementById('view');
    if (!container) return;

    var view = app.views[route.view];
    container.classList.remove('fade-in');
    container.innerHTML = '';
    void container.offsetWidth;           // 强制重排以重播动画
    container.classList.add('fade-in');

    try {
      view.render(container, route.params || {});
    } catch (err) {
      container.innerHTML =
        '<div class="empty"><div class="empty__icon">' + U.icon('alert-triangle', 34) + '</div>' +
        '<div class="empty__text">页面渲染出错：' + U.escapeHtml(err && err.message ? err.message : String(err)) + '</div></div>';
      if (global.console) global.console.error(err);
    }

    /* 回到顶部 & 更新标题 */
    var main = document.getElementById('main');
    if (main) main.scrollTop = 0;
    document.title = '个人工作日志管理系统 · ' + (NAV.filter(function (n) { return n.key === route.view; })[0] || {}).label;
  }

  /* ============================================================== 模态框 */
  /**
   * 打开模态框
   * @param {object} opts
   *   title      标题（字符串）
   *   body       内容，HTMLElement 或 HTML 字符串
   *   footer     底部，HTMLElement 或 HTML 字符串
   *   size       'sm' | 'md' | 'lg'
   *   closeOnMask 点击遮罩是否关闭，默认 true
   *   icon       标题左侧图标名
   *   onMount    function(bodyEl, api) 挂载后回调
   * @returns {{close:Function, body:HTMLElement, foot:HTMLElement, root:HTMLElement}}
   */
  app.showModal = function (opts) {
    var options = opts || {};
    var mask = U.el('div', { class: 'modal-mask' });

    var closeBtn = U.el('button', {
      class: 'btn btn--icon btn--ghost modal__close',
      type: 'button',
      html: U.icon('close', 18),
      title: '关闭',
      'aria-label': '关闭'
    });

    var head = U.el('header', { class: 'modal__head' }, [
      U.el('h3', { class: 'modal__title' }, [
        options.icon ? U.el('span', { class: 'modal__title-ico', html: U.icon(options.icon, 18) }) : null,
        U.el('span', { text: options.title || '' })
      ]),
      closeBtn
    ]);

    var body = U.el('div', { class: 'modal__body' });
    if (options.body instanceof Node) body.appendChild(options.body);
    else body.innerHTML = options.body || '';

    var foot = null;
    if (options.footer !== undefined && options.footer !== null) {
      foot = U.el('footer', { class: 'modal__foot' });
      if (options.footer instanceof Node) foot.appendChild(options.footer);
      else foot.innerHTML = options.footer;
    }

    var dialog = U.el('div', { class: 'modal modal--' + (options.size || 'md'), role: 'dialog', 'aria-modal': 'true' }, [head, body, foot]);
    mask.appendChild(dialog);

    var entry = { mask: mask, dialog: dialog, close: close };

    function close() {
      var idx = app._modalStack.indexOf(entry);
      if (idx === -1) return;
      app._modalStack.splice(idx, 1);
      mask.classList.remove('is-in');
      dialog.classList.remove('is-in');
      setTimeout(function () { if (mask.parentNode) mask.parentNode.removeChild(mask); }, 220);
      if (!app._modalStack.length) document.body.classList.remove('is-modal-open');
      if (typeof options.onClose === 'function') options.onClose();
    }

    closeBtn.addEventListener('click', close);
    mask.addEventListener('mousedown', function (e) {
      if (e.target === mask && options.closeOnMask !== false) close();
    });

    document.body.appendChild(mask);
    document.body.classList.add('is-modal-open');
    app._modalStack.push(entry);

    /* 用强制重排代替 requestAnimationFrame 播放入场过渡：
       rAF 在后台标签页会被浏览器暂停，会导致模态框停留在 opacity:0
       却仍然拦截点击。offsetWidth 读取可强制样式计算，同步且稳定。 */
    void mask.offsetWidth;
    mask.classList.add('is-in');
    dialog.classList.add('is-in');

    /* 自动聚焦第一个可输入元素（非移动端更友好） */
    setTimeout(function () {
      var focusTarget = dialog.querySelector('[data-autofocus]') || dialog.querySelector('input:not([type=hidden]), textarea, select');
      if (focusTarget && typeof focusTarget.focus === 'function') focusTarget.focus();
    }, 60);

    var api = { close: close, body: body, foot: foot, root: dialog };
    if (typeof options.onMount === 'function') options.onMount(body, api, dialog);
    return api;
  };

  /** 关闭最上层模态框 */
  app.closeModal = function () {
    var top = app._modalStack[app._modalStack.length - 1];
    if (top) top.close();
  };

  app.hasModal = function () { return app._modalStack.length > 0; };

  /* ============================================================== 确认框 */
  /**
   * 二次确认
   * @returns Promise<boolean>
   */
  app.confirm = function (opts) {
    var o = opts || {};
    return new Promise(function (resolve) {
      var settled = false;
      function settle(value) {
        if (settled) return;
        settled = true;
        api.close();
        resolve(value);
      }

      var body = U.el('div', { class: 'confirm' }, [
        U.el('div', { class: 'confirm__icon confirm__icon--' + (o.danger ? 'danger' : 'info'), html: U.icon(o.danger ? 'alert-triangle' : 'info', 22) }),
        U.el('div', { class: 'confirm__main' }, [
          U.el('p', { class: 'confirm__msg', text: o.message || '确定要执行该操作吗？' }),
          o.detail ? U.el('p', { class: 'confirm__detail', text: o.detail }) : null
        ])
      ]);

      var cancel = U.el('button', { class: 'btn btn--ghost', type: 'button', text: o.cancelText || '取消' });
      var ok = U.el('button', { class: 'btn ' + (o.danger ? 'btn--danger' : 'btn--primary'), type: 'button', text: o.confirmText || '确定' });
      cancel.addEventListener('click', function () { settle(false); });
      ok.addEventListener('click', function () { settle(true); });

      var foot = U.el('div', { class: 'row row--end row--gap' }, [cancel, ok]);

      var api = app.showModal({
        title: o.title || '操作确认',
        body: body,
        footer: foot,
        size: 'sm',
        closeOnMask: true,
        onClose: function () { settle(false); }
      });
      setTimeout(function () { ok.focus(); }, 60);
    });
  };

  /* ============================================================ 顶部栏渲染 */
  function renderTopbar() {
    var nav = document.getElementById('nav');
    if (nav) {
      nav.innerHTML = '';
      NAV.forEach(function (item) {
        var btn = U.el('button', {
          class: 'nav__item',
          type: 'button',
          dataset: { view: item.key },
          html: U.icon(item.icon, 17) + '<span>' + item.label + '</span>'
        });
        btn.addEventListener('click', function () { app.navigate(item.key, {}); });
        nav.appendChild(btn);
      });
    }

    var actions = document.getElementById('topbarActions');
    if (actions) {
      actions.innerHTML = '';

      var modeBadge = U.el('div', { class: 'storage-badge', id: 'storageBadge', title: '数据存储状态' });
      actions.appendChild(modeBadge);

      var newBtn = U.el('button', {
        class: 'btn btn--primary',
        type: 'button',
        html: U.icon('plus', 17) + '<span>新建日志</span>'
      });
      newBtn.addEventListener('click', function () {
        if (typeof app.openLogForm === 'function') app.openLogForm({});
        else U.toast('日志模块尚未就绪', 'warn');
      });
      actions.appendChild(newBtn);
    }
    updateStorageBadge();
  }

  function updateStorageBadge() {
    var badge = document.getElementById('storageBadge');
    if (!badge) return;
    var isServer = global.DB && global.DB.isServer;
    badge.className = 'storage-badge storage-badge--' + (isServer ? 'server' : 'local');
    badge.innerHTML =
      '<span class="status-dot"></span>' +
      U.icon(isServer ? 'database' : 'moon', 14) +
      '<span>' + (isServer ? 'JSON 文件模式' : '本地存储模式') + '</span>';
    badge.title = isServer
      ? '已连接后端服务，数据实时写入 data/logs.json 与 data/projects.json'
      : '未检测到后端服务，数据保存在浏览器本地存储中。启动 server.js / server.py 可切换为 JSON 文件模式。';
  }

  /* ============================================================== 启动流程 */
  function boot() {
    renderTopbar();
    applyRoute();

    global.DB.init().then(function (mode) {
      updateStorageBadge();
      applyRoute();                        // 数据就绪后重绘
      if (mode === 'local') {
        U.toast('未检测到后端服务，已切换到浏览器本地存储模式', 'warn', 4200);
      }
    }).catch(function (err) {
      U.toast('数据初始化失败：' + (err && err.message ? err.message : err), 'error', 5000);
    });

    /* 数据变更时，若当前视图提供 refresh 钩子则局部刷新 */
    global.DB.onChange(function () {
      var view = app.views[app.currentView];
      if (view && typeof view.onDataChange === 'function') {
        try { view.onDataChange(); } catch (e) { /* 忽略 */ }
      }
    });

    /* 全局键盘：Esc 关闭模态框 */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && app.hasModal()) {
        e.stopPropagation();
        app.closeModal();
      }
    });

    global.addEventListener('hashchange', applyRoute);
  }

  global.App = app;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
