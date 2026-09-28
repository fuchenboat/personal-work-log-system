/* =========================================================================
 * logs.js —— 工作日志视图
 *
 * 对外提供：
 *   App.views.logs              日志列表视图（筛选 / 搜索 / 标签快捷筛选 / 空态）
 *   App.openLogForm(options)    新建 / 编辑日志模态框（富文本编辑器 + 标签输入）
 *   App.openLogDetail(id)       日志详情模态框（含修改历史入口）
 * 内部函数：openHistory(id) —— 修改历史时间线
 *
 * 依赖：window.Utils / window.DB / window.App，无任何外部库
 * ========================================================================= */
(function (global) {
  'use strict';

  var U = window.Utils;
  var DB = window.DB;
  var App = window.App;

  /* ---------------------------------------------------------------- 常量 */
  var MOOD_ICON = { smooth: 'smile', normal: 'meh', frustrated: 'frown' };
  var PROJECT_STATUSES = ['active', 'completed', 'paused'];

  /* 修改记录中的字段名映射 */
  var FIELD_LABEL = {
    date: '日期',
    title: '标题',
    content: '工作内容',
    projectId: '所属项目',
    mood: '今日情绪',
    tags: '标签'
  };

  var TITLE_MAX = 80;
  var TAG_MAX_COUNT = 12;
  var TAG_MAX_LEN = 20;
  var PAGE_SIZE = 10;                       /* 日志列表每页条数 */

  /* 富文本工具栏配置 */
  var EDITOR_TOOLS = [
    { cmd: 'bold', icon: 'bold', title: '加粗（Ctrl+B）' },
    { cmd: 'italic', icon: 'italic', title: '斜体（Ctrl+I）' },
    { cmd: 'underline', icon: 'underline', title: '下划线（Ctrl+U）' },
    { sep: true },
    { cmd: 'insertUnorderedList', icon: 'ul', title: '无序列表' },
    { cmd: 'insertOrderedList', icon: 'ol', title: '有序列表' },
    { cmd: 'formatBlock', value: 'blockquote', icon: 'quote', title: '引用' },
    { sep: true },
    { cmd: 'removeFormat', icon: 'close', title: '清除格式' }
  ];

  /* ------------------------------------------------- 模块级筛选状态（唯一真相） */
  var currentFilter = { startDate: '', endDate: '', projectId: '', mood: '', keyword: '' };
  var currentPage = 1;                      /* 当前页码，筛选条件变化时回到第 1 页 */

  /* ============================================================ 小工具函数 */

  /** 由 params 初始化筛选状态 */
  function normalizeFilter(params) {
    var p = params || {};
    var f = {
      startDate: p.startDate || '',
      endDate: p.endDate || '',
      projectId: p.projectId || '',
      mood: p.mood || '',
      keyword: p.keyword || ''
    };
    /* 从看板点某一天跳转过来时，date 视为单日区间 */
    if (p.date) {
      if (!f.startDate) f.startDate = p.date;
      if (!f.endDate) f.endDate = p.date;
    }
    return f;
  }

  function hasActiveFilter() {
    return !!(currentFilter.startDate || currentFilter.endDate ||
      currentFilter.projectId || currentFilter.mood || currentFilter.keyword);
  }

  /** 同步筛选条件到 URL（replaceState 不触发 hashchange，避免输入焦点丢失） */
  function syncUrl() {
    try {
      if (!global.history || typeof global.history.replaceState !== 'function') return;
      var pairs = [];
      Object.keys(currentFilter).forEach(function (key) {
        var value = currentFilter[key];
        if (value) pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
      });
      var hash = '#/logs' + (pairs.length ? '?' + pairs.join('&') : '');
      if (global.location.hash !== hash) global.history.replaceState(null, '', hash);
    } catch (e) { /* file:// 等场景下可能受限，忽略即可 */ }
  }

  function projectBadgeClass(project) {
    if (project.archived) return 'badge--archived';
    var status = PROJECT_STATUSES.indexOf(project.status) === -1 ? 'active' : project.status;
    return 'badge--' + status;
  }

  /** 修改记录中的字段值展示 */
  function formatChangeValue(field, value) {
    var v = (value === undefined || value === null) ? '' : String(value);
    if (field === 'projectId') {
      if (!v) return '未关联';
      var project = DB.getProject(v);
      return project ? project.name : '已删除的项目';
    }
    if (field === 'mood') return U.MOOD_LABEL[v] || v || '未记录';
    return v || '（空）';
  }

  /* =================================================== 列表项 / 空态 / 统计 */

  function metaItem(iconName, text) {
    return U.el('span', { class: 'log-item__meta-item' }, [
      U.el('span', { html: U.icon(iconName, 14) }),
      U.el('span', { text: text })
    ]);
  }

  function projectMetaItem(project) {
    var kids = [U.el('span', { html: U.icon('folder', 14) })];
    if (project) {
      var badge = U.el('span', {
        class: 'badge ' + projectBadgeClass(project),
        text: project.name,
        title: '查看项目',
        role: 'button',
        tabindex: '0'
      });
      badge.addEventListener('click', function (e) {
        e.stopPropagation();
        App.navigate('projects', { focusId: project.id });
      });
      kids.push(badge);
    } else {
      kids.push(U.el('span', { class: 'badge badge--plain', text: '未关联' }));
    }
    return U.el('span', { class: 'log-item__meta-item' }, kids);
  }

  function moodMetaItem(mood) {
    var known = !!U.MOOD_LABEL[mood];
    return U.el('span', { class: 'log-item__meta-item' }, [
      U.el('span', { html: U.icon(MOOD_ICON[mood] || 'info', 14) }),
      U.el('span', {
        class: 'badge badge--' + (known ? mood : 'plain'),
        text: known ? U.MOOD_LABEL[mood] : '未记录'
      })
    ]);
  }

  function actionBtn(icon, title, handler, danger) {
    return U.el('button', {
      class: 'btn btn--icon btn--ghost btn--sm' + (danger ? ' btn--danger' : ''),
      type: 'button',
      html: U.icon(icon, 15),
      title: title,
      'aria-label': title,
      onclick: handler
    });
  }

  /**
   * 单条日志卡片
   * @param {object}   log      日志对象
   * @param {string}   keyword  关键词（用于高亮）
   * @param {Function} onTag    点击标签回调，用于把标签设为关键词
   */
  function buildLogItem(log, keyword, onTag) {
    var project = DB.getProject(log.projectId);

    var title = U.el('div', {
      class: 'log-item__title',
      html: U.highlight(log.title || '', keyword),
      title: log.title || ''
    });

    var actions = U.el('div', { class: 'log-item__actions' }, [
      actionBtn('edit', '编辑', function (e) {
        e.stopPropagation();
        App.openLogForm({ log: DB.getLog(log.id) });
      }),
      actionBtn('history', '修改历史', function (e) {
        e.stopPropagation();
        openHistory(log.id);
      }),
      actionBtn('trash', '删除', function (e) {
        e.stopPropagation();
        requestDelete(log.id);
      }, true)
    ]);

    var meta = U.el('div', { class: 'log-item__meta' }, [
      metaItem('calendar', U.formatDate(log.date) + ' ' + U.weekdayCN(log.date)),
      projectMetaItem(project),
      moodMetaItem(log.mood),
      metaItem('clock', '更新于 ' + U.relativeTime(log.updatedAt))
    ]);

    var excerptText = U.clampText(U.htmlToText(log.content || ''), 160);
    var excerpt = U.el('div', {
      class: 'log-item__excerpt',
      html: U.highlight(excerptText, keyword)
    });

    var item = U.el('div', { class: 'log-item' }, [
      U.el('div', { class: 'log-item__head' }, [title, actions]),
      meta,
      excerpt
    ]);

    var tags = log.tags || [];
    if (tags.length) {
      var tagWrap = U.el('div', { class: 'log-item__tags' });
      tags.forEach(function (tagText) {
        var chip = U.el('span', {
          class: 'chip chip--static',
          title: '按此标签筛选',
          role: 'button',
          tabindex: '0'
        }, [U.el('span', { class: 'chip__text', text: tagText })]);
        chip.addEventListener('click', function (e) {
          e.stopPropagation();
          if (typeof onTag === 'function') onTag(tagText);
        });
        tagWrap.appendChild(chip);
      });
      item.appendChild(tagWrap);
    }

    /* 点击卡片空白处 / 标题均可打开详情 */
    item.addEventListener('click', function () { App.openLogDetail(log.id); });
    return item;
  }

  function buildEmptyState(onClear) {
    var active = hasActiveFilter();
    return U.el('div', { class: 'empty' }, [
      U.el('div', { class: 'empty__icon', html: U.icon('list', 34) }),
      U.el('div', {
        class: 'empty__text',
        text: active ? '没有匹配的日志，试试调整筛选条件' : '还没有任何日志'
      }),
      U.el('div', {
        class: 'empty__hint',
        text: active ? '可以清除筛选条件，查看全部记录' : '点击右上角「新建日志」，开始记录今天的工作'
      }),
      active ? U.el('button', {
        class: 'btn btn--ghost btn--sm',
        type: 'button',
        html: U.icon('refresh', 15) + '<span>清除筛选</span>',
        onclick: onClear
      }) : null
    ]);
  }

  function buildResultRow(count, page, totalPages, onClear) {
    var summary = '共 ' + count + ' 条记录';
    if (totalPages > 1) summary += ' · 第 ' + page + ' / ' + totalPages + ' 页';
    var left = [
      U.el('span', { class: 'muted text-sm', text: summary })
    ];
    if (currentFilter.keyword) {
      left.push(U.el('span', {
        class: 'badge badge--cyan',
        text: '关键词：' + currentFilter.keyword
      }));
    }
    if (hasActiveFilter()) {
      left.push(U.el('button', {
        class: 'btn btn--ghost btn--sm',
        type: 'button',
        html: U.icon('refresh', 14) + '<span>清除筛选</span>',
        onclick: onClear
      }));
    }
    return U.el('div', { class: 'row row--between' }, [
      U.el('div', { class: 'row row--tight' }, left),
      U.el('span', { class: 'muted-2 text-xs', text: '按日期倒序' })
    ]);
  }

  /* ============================================================ 分页控件 */

  /** 计算需要展示的页码序列，中间被跳过的部分折叠为省略号 */
  function pagerTokens(page, totalPages) {
    var visible = {};
    visible[1] = true;
    visible[totalPages] = true;
    for (var i = page - 1; i <= page + 1; i++) {
      if (i >= 1 && i <= totalPages) visible[i] = true;
    }

    var tokens = [];
    var prev = 0;
    Object.keys(visible).map(Number).sort(function (a, b) { return a - b; })
      .forEach(function (num) {
        if (prev && num - prev > 1) tokens.push('...');
        tokens.push(num);
        prev = num;
      });
    return tokens;
  }

  /** 分页条：上一页 / 页码 / 下一页 */
  function buildPager(page, totalPages, onGo) {
    function makeBtn(label, target, opts) {
      var o = opts || {};
      var btn = U.el('button', {
        class: 'pager__btn' + (o.current ? ' is-current' : ''),
        type: 'button',
        text: label,
        title: o.title || ('第 ' + target + ' 页'),
        'aria-label': o.title || ('第 ' + target + ' 页')
      });
      if (o.current) btn.setAttribute('aria-current', 'page');
      if (o.disabled) {
        btn.disabled = true;
      } else {
        btn.addEventListener('click', function () { onGo(target); });
      }
      return btn;
    }

    var wrap = U.el('nav', { class: 'pager', 'aria-label': '日志分页' });
    wrap.appendChild(makeBtn('上一页', page - 1, { disabled: page <= 1, title: '上一页' }));

    pagerTokens(page, totalPages).forEach(function (token) {
      if (token === '...') {
        wrap.appendChild(U.el('span', { class: 'pager__gap', text: '…' }));
        return;
      }
      wrap.appendChild(makeBtn(String(token), token, { current: token === page }));
    });

    wrap.appendChild(makeBtn('下一页', page + 1, { disabled: page >= totalPages, title: '下一页' }));
    return wrap;
  }

  /* ============================================================ 删除流程 */

  function requestDelete(id) {
    var log = DB.getLog(id);
    if (!log) {
      U.toast('日志不存在或已被删除', 'error');
      return;
    }
    App.confirm({
      title: '删除日志',
      message: '确定要删除「' + log.title + '」吗？',
      detail: '删除后不可恢复，该日志的修改记录也会一并移除。',
      confirmText: '确认删除',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      DB.deleteLog(id).then(function () {
        U.toast('日志已删除', 'ok');
        App.closeModal();          /* 若详情弹窗还开着则一并关闭 */
        App.render();
      }).catch(function (err) {
        U.toast((err && err.message) ? err.message : '删除失败，请稍后重试', 'error');
      });
    });
  }

  /* ========================================================== 详情弹窗 */

  function infoItem(label, value) {
    var valueEl = U.el('div', { class: 'info-item__value' });
    if (value instanceof Node) valueEl.appendChild(value);
    else valueEl.textContent = String(value === undefined || value === null ? '' : value);
    return U.el('div', { class: 'info-item' }, [
      U.el('div', { class: 'info-item__label', text: label }),
      valueEl
    ]);
  }

  function buildTagBlock(tags) {
    if (!tags.length) return U.el('div', { class: 'muted text-sm', text: '无' });
    var wrap = U.el('div', { class: 'chips' });
    tags.forEach(function (tagText) {
      wrap.appendChild(U.el('span', { class: 'chip chip--static' }, [
        U.el('span', { class: 'chip__text', text: tagText })
      ]));
    });
    return wrap;
  }

  function buildHistoryCard(log) {
    var count = (log.history || []).length - 1;
    var btn = U.el('button', {
      class: 'btn btn--ghost btn--sm',
      type: 'button',
      html: U.icon('history', 15) + '<span>查看修改历史</span>'
    });
    btn.addEventListener('click', function () { openHistory(log.id); });

    return U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card__body' }, [
        U.el('div', { class: 'row row--between' }, [
          U.el('span', { class: 'text-sm muted', text: '该日志共修改 ' + count + ' 次' }),
          btn
        ])
      ])
    ]);
  }

  App.openLogDetail = function (id) {
    var log = DB.getLog(id);
    if (!log) {
      U.toast('日志不存在或已被删除', 'error');
      return;
    }

    var project = DB.getProject(log.projectId);
    var tags = log.tags || [];
    var history = log.history || [];

    /* 所属项目（可点击跳转） */
    var projectValue;
    if (project) {
      projectValue = U.el('span', {
        class: 'badge ' + projectBadgeClass(project),
        role: 'button',
        tabindex: '0',
        title: '查看项目'
      }, [
        U.el('span', { html: U.icon('folder', 13) }),
        U.el('span', { text: project.name + (project.archived ? '（已归档）' : '') })
      ]);
      projectValue.addEventListener('click', function () {
        App.closeModal();
        App.navigate('projects', { focusId: project.id });
      });
    } else {
      projectValue = U.el('span', { class: 'badge badge--plain', text: '未关联' });
    }

    /* 今日情绪 */
    var knownMood = !!U.MOOD_LABEL[log.mood];
    var moodValue = U.el('span', {
      class: 'badge badge--' + (knownMood ? log.mood : 'plain')
    }, [
      U.el('span', { html: U.icon(MOOD_ICON[log.mood] || 'info', 13) }),
      U.el('span', { text: knownMood ? U.MOOD_LABEL[log.mood] : '未记录' })
    ]);

    var body = U.el('div', { class: 'col' });
    body.appendChild(U.el('div', { class: 'info-grid' }, [
      infoItem('日期', U.formatDate(log.date) + ' ' + U.weekdayCN(log.date)),
      infoItem('所属项目', projectValue),
      infoItem('今日情绪', moodValue),
      infoItem('最后更新', U.formatDateTime(log.updatedAt))
    ]));
    body.appendChild(U.el('hr', { class: 'divider' }));
    body.appendChild(buildTagBlock(tags));
    body.appendChild(U.el('hr', { class: 'divider' }));
    body.appendChild(U.el('div', { class: 'prose', html: U.sanitizeHtml(log.content || '') }));
    if (history.length > 1) body.appendChild(buildHistoryCard(log));

    /* 底部操作 */
    var projectBtn = U.el('button', {
      class: 'btn btn--ghost btn--sm',
      type: 'button',
      html: U.icon('external', 15) + '<span>查看项目</span>'
    });
    projectBtn.disabled = !project;
    projectBtn.addEventListener('click', function () {
      if (!project) return;
      App.closeModal();
      App.navigate('projects', { focusId: project.id });
    });

    var histBtn = U.el('button', {
      class: 'btn btn--ghost btn--sm',
      type: 'button',
      html: U.icon('history', 15) + '<span>修改历史</span>'
    });
    histBtn.disabled = history.length === 0;
    histBtn.addEventListener('click', function () { openHistory(log.id); });

    var editBtn = U.el('button', {
      class: 'btn btn--primary btn--sm',
      type: 'button',
      html: U.icon('edit', 15) + '<span>编辑</span>'
    });
    editBtn.addEventListener('click', function () {
      var current = DB.getLog(log.id);
      if (!current) {
        U.toast('日志不存在或已被删除', 'error');
        return;
      }
      App.closeModal();
      App.openLogForm({ log: current });
    });

    var delBtn = U.el('button', {
      class: 'btn btn--danger btn--sm',
      type: 'button',
      html: U.icon('trash', 15) + '<span>删除</span>'
    });
    delBtn.addEventListener('click', function () { requestDelete(log.id); });

    App.showModal({
      title: log.title || '日志详情',
      icon: 'list',
      size: 'lg',
      body: body,
      footer: U.el('div', { class: 'row row--between' }, [
        U.el('div', { class: 'row row--tight' }, [projectBtn]),
        U.el('div', { class: 'row row--tight' }, [histBtn, editBtn, delBtn])
      ])
    });
  };

  /* ======================================================= 修改历史弹窗 */

  function buildChangeRow(change) {
    return U.el('div', { class: 'tl-change' }, [
      U.el('span', { class: 'tl-change__field', text: FIELD_LABEL[change.field] || change.field }),
      U.el('span', { class: 'tl-change__from', text: formatChangeValue(change.field, change.from) }),
      U.el('span', { class: 'tl-change__arrow', text: '→' }),
      U.el('span', { class: 'tl-change__to', text: formatChangeValue(change.field, change.to) })
    ]);
  }

  function buildHistoryItem(entry) {
    var isCreate = entry.action === 'create';
    var changes = entry.changes || [];

    var bodyEl = U.el('div', { class: 'tl-item__body' });
    if (!changes.length) {
      bodyEl.appendChild(U.el('div', {
        class: 'muted text-sm',
        text: isCreate ? '新建日志' : '保存（无字段变化）'
      }));
    } else {
      changes.forEach(function (change) { bodyEl.appendChild(buildChangeRow(change)); });
    }

    return U.el('div', { class: 'tl-item' + (isCreate ? ' tl-item--create' : '') }, [
      U.el('div', { class: 'tl-item__head' }, [
        U.el('span', { class: 'tl-item__time', text: U.formatFull(entry.at) }),
        U.el('span', {
          class: 'badge ' + (isCreate ? 'badge--completed' : 'badge--cyan'),
          text: isCreate ? '创建' : '修改'
        })
      ]),
      bodyEl
    ]);
  }

  function openHistory(id) {
    var log = DB.getLog(id);
    if (!log) {
      U.toast('日志不存在或已被删除', 'error');
      return;
    }

    var history = (log.history || []).slice().sort(function (a, b) {
      return String(b.at || '').localeCompare(String(a.at || ''));
    });

    var body;
    if (!history.length) {
      body = U.el('div', { class: 'empty' }, [
        U.el('div', { class: 'empty__icon', html: U.icon('history', 32) }),
        U.el('div', { class: 'empty__text', text: '暂无修改记录' }),
        U.el('div', { class: 'empty__hint', text: '该日志创建后尚未发生任何变更' })
      ]);
    } else {
      var timeline = U.el('div', { class: 'timeline' });
      history.forEach(function (entry) { timeline.appendChild(buildHistoryItem(entry)); });
      body = timeline;
    }

    App.showModal({
      title: '修改记录 · ' + (log.title || ''),
      icon: 'history',
      size: 'lg',
      body: body
    });
  }

  /* ======================================================= 富文本编辑器 */

  function createEditor(initialHtml) {
    var area = U.el('div', {
      class: 'editor__area',
      contenteditable: 'true',
      'data-placeholder': '记录今天做了什么、遇到什么问题、下一步计划…'
    });
    area.innerHTML = U.sanitizeHtml(initialHtml || '');

    var toolbar = U.el('div', { class: 'editor__toolbar' });
    var buttons = [];

    function exec(cmd, value) {
      if (typeof document.execCommand !== 'function') return;
      try { document.execCommand(cmd, false, value === undefined ? null : value); }
      catch (e) { /* 浏览器不支持时静默忽略 */ }
    }

    function syncActive() {
      buttons.forEach(function (btn) {
        var cmd = btn.dataset.cmd;
        var active = false;
        try {
          if (cmd === 'formatBlock') {
            active = String(document.queryCommandValue('formatBlock') || '').toLowerCase() === 'blockquote';
          } else if (cmd === 'bold' || cmd === 'italic' || cmd === 'underline' ||
                     cmd === 'insertUnorderedList' || cmd === 'insertOrderedList') {
            active = document.queryCommandState(cmd);
          }
        } catch (e) { active = false; }
        btn.classList.toggle('is-active', !!active);
      });
    }

    EDITOR_TOOLS.forEach(function (tool) {
      if (tool.sep) {
        toolbar.appendChild(U.el('span', { class: 'editor__sep' }));
        return;
      }
      var btn = U.el('button', {
        class: 'editor__btn',
        type: 'button',
        title: tool.title,
        'aria-label': tool.title,
        dataset: { cmd: tool.cmd, cmdValue: tool.value || '' },
        html: U.icon(tool.icon, 16)
      });
      /* mousedown 时 preventDefault，避免编辑器选区被按钮抢走焦点 */
      btn.addEventListener('mousedown', function (e) {
        e.preventDefault();
        area.focus();
        exec(tool.cmd, tool.value);
        syncActive();
      });
      buttons.push(btn);
      toolbar.appendChild(btn);
    });

    toolbar.appendChild(U.el('span', {
      class: 'editor__tip',
      text: '支持加粗 / 斜体 / 下划线 / 列表 / 引用'
    }));

    var root = U.el('div', { class: 'editor' }, [toolbar, area]);

    /* selectionchange 是 document 级事件，必须在关闭时移除，避免监听器泄漏 */
    function onSelectionChange() {
      if (!document.body.contains(area)) {
        document.removeEventListener('selectionchange', onSelectionChange);
        return;
      }
      syncActive();
    }
    document.addEventListener('selectionchange', onSelectionChange);

    area.addEventListener('keyup', syncActive);
    area.addEventListener('mouseup', syncActive);

    return {
      root: root,
      area: area,
      dispose: function () {
        document.removeEventListener('selectionchange', onSelectionChange);
      }
    };
  }

  /* ============================================================= 表单弹窗 */

  App.openLogForm = function (options) {
    var opts = options || {};
    var source = opts.log || null;
    var editing = !!source;

    var editor = null;

    /* 待办标签（表单内维护，变更后重绘标签区） */
    var tags = (source && source.tags) ? source.tags.slice() : [];

    /* ---- 项目下拉：未归档项目 + 编辑时补上已归档的当前项目 ---- */
    var selectable = DB.getSelectableProjects();
    var currentProject = source ? DB.getProject(source.projectId) : null;
    var archivedOption = (currentProject && currentProject.archived) ? currentProject : null;
    var noProject = selectable.length === 0 && !archivedOption;

    /* ---- 字段：日期 ---- */
    var dateInput = U.el('input', { class: 'input', type: 'date', name: 'date' });
    dateInput.value = opts.presetDate || (source && source.date) || U.today();

    /* ---- 字段：今日情绪（必须选择） ---- */
    var moodInputs = {};
    var moodLabels = {};
    var moodGroup = U.el('div', { class: 'radio-group' });

    function syncMoodUI() {
      U.MOODS.forEach(function (mood) {
        moodLabels[mood.value].classList.toggle('is-checked', !!moodInputs[mood.value].checked);
      });
    }

    U.MOODS.forEach(function (mood) {
      var input = U.el('input', { type: 'radio', name: 'mood', value: mood.value });
      var label = U.el('label', { class: 'radio radio--' + mood.value }, [
        input,
        U.el('span', { html: U.icon(mood.icon, 16) }),
        U.el('span', { text: mood.label })
      ]);
      input.addEventListener('change', syncMoodUI);
      moodInputs[mood.value] = input;
      moodLabels[mood.value] = label;
      moodGroup.appendChild(label);
    });
    /* 编辑模式：回填原有情绪，避免用户被迫重新选择 */
    if (source && source.mood && moodInputs[source.mood]) {
      moodInputs[source.mood].checked = true;
    }
    syncMoodUI();

    /* ---- 字段：项目分类 ---- */
    var projectSelect = U.el('select', { class: 'select', name: 'projectId' });
    projectSelect.appendChild(U.el('option', { value: '', text: '请选择项目' }));
    if (archivedOption) {
      projectSelect.appendChild(U.el('option', {
        value: archivedOption.id,
        text: archivedOption.name + '（已归档）'
      }));
    }
    selectable.forEach(function (project) {
      projectSelect.appendChild(U.el('option', { value: project.id, text: project.name }));
    });
    if (source && source.projectId) {
      var exists = Array.prototype.some.call(projectSelect.options, function (option) {
        return option.value === source.projectId;
      });
      if (exists) projectSelect.value = source.projectId;
    }

    /* ---- 字段：标题 ---- */
    var titleInput = U.el('input', {
      class: 'input',
      type: 'text',
      maxlength: String(TITLE_MAX),
      placeholder: '用一句话概括今天的工作',
      'data-autofocus': ''
    });
    titleInput.value = source ? (source.title || '') : '';

    var titleCounter = U.el('span', {
      class: 'field__counter',
      text: titleInput.value.length + ' / ' + TITLE_MAX
    });
    titleInput.addEventListener('input', function () {
      var len = titleInput.value.length;
      titleCounter.textContent = len + ' / ' + TITLE_MAX;
      titleCounter.classList.toggle('is-over', len > TITLE_MAX);
    });

    /* ---- 字段：工作内容（富文本） ---- */
    editor = createEditor(source ? source.content : '');

    /* ---- 字段：待办事项标签 ---- */
    var tagInput = U.el('input', {
      class: 'tag-input__field',
      type: 'text',
      placeholder: '输入标签后按回车添加'
    });
    var tagWrap = U.el('div', { class: 'tag-input' });

    function renderTags(keepFocus) {
      tagWrap.innerHTML = '';
      tags.forEach(function (tagText, index) {
        var chip = U.el('span', { class: 'chip' }, [
          U.el('span', { class: 'chip__text', text: tagText }),
          U.el('button', {
            class: 'chip__x',
            type: 'button',
            html: U.icon('close', 10),
            title: '删除标签',
            'aria-label': '删除标签',
            onclick: function () {
              tags.splice(index, 1);
              renderTags(true);
            }
          })
        ]);
        tagWrap.appendChild(chip);
      });
      tagWrap.appendChild(tagInput);
      if (keepFocus !== false) tagInput.focus();
    }

    function addTag(raw) {
      var value = String(raw === null || raw === undefined ? '' : raw).trim();
      if (!value) return;
      if (value.length > TAG_MAX_LEN) value = value.slice(0, TAG_MAX_LEN);

      var duplicated = tags.some(function (tagText) {
        return tagText.toLowerCase() === value.toLowerCase();
      });
      if (duplicated) {
        tagInput.value = '';
        return;
      }
      if (tags.length >= TAG_MAX_COUNT) {
        U.toast('最多添加 12 个标签', 'warn');
        return;
      }
      tags.push(value);
      renderTags(true);
    }

    tagInput.addEventListener('keydown', function (e) {
      if (e.isComposing) return;              /* 中文输入法组词中不处理 */
      if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
        e.preventDefault();
        addTag(tagInput.value);
        tagInput.value = '';
        return;
      }
      if (e.key === 'Backspace' && !tagInput.value && tags.length) {
        tags.pop();
        renderTags(true);
      }
    });

    renderTags(false);

    /* ---- 组装表单 ---- */
    function makeField(name, labelText, control, cfg) {
      var o = cfg || {};
      var labelKids = [U.el('span', { text: labelText })];
      if (o.required) labelKids.push(U.el('span', { class: 'req', text: '*' }));
      if (o.hint) labelKids.push(U.el('span', { class: 'field__hint', text: o.hint }));
      if (o.counter) labelKids.push(o.counter);

      return U.el('div', {
        class: 'field' + (o.full ? ' field--full' : ''),
        dataset: { field: name }
      }, [
        U.el('label', { class: 'field__label' }, labelKids),
        control,
        U.el('div', { class: 'field__error' })
      ]);
    }

    var form = U.el('form', { class: 'form', novalidate: 'novalidate' }, [
      U.el('div', { class: 'form-grid form-grid--3' }, [
        makeField('date', '日期', dateInput, { required: true }),
        makeField('mood', '今日情绪', moodGroup, { required: true }),
        makeField('projectId', '项目分类', projectSelect, {
          required: true,
          hint: noProject ? '请先到项目管理创建项目' : ''
        })
      ]),
      makeField('title', '标题', titleInput, { required: true, full: true, counter: titleCounter }),
      makeField('content', '工作内容', editor.root, { required: true, full: true }),
      makeField('tags', '待办事项标签', tagWrap, {
        full: true,
        hint: '输入后按回车或逗号添加，最多 12 个'
      }),
      /* 隐藏的提交按钮：让输入框内回车也能提交表单 */
      U.el('button', { class: 'hide', type: 'submit', text: '保存' })
    ]);

    /* ---- 校验反馈 ---- */
    function clearErrors() {
      U.$$('.field.has-error', form).forEach(function (field) { field.classList.remove('has-error'); });
      U.$$('.field__error', form).forEach(function (errorEl) { errorEl.textContent = ''; });
    }

    function showErrors(errors) {
      clearErrors();
      var firstField = null;
      Object.keys(errors).forEach(function (key) {
        var field = form.querySelector('.field[data-field="' + key + '"]');
        if (!field) return;
        field.classList.add('has-error');
        var errorEl = field.querySelector('.field__error');
        if (errorEl) errorEl.textContent = errors[key];
        if (!firstField) firstField = field;
      });
      if (!firstField) return;
      if (typeof firstField.scrollIntoView === 'function') {
        firstField.scrollIntoView({ block: 'nearest' });
      }
      var focusable = firstField.querySelector('input:not([type=radio]), select, .editor__area');
      if (focusable && typeof focusable.focus === 'function') focusable.focus();
    }

    /* ---- 收集与提交 ---- */
    function collect() {
      var checked = form.querySelector('input[name="mood"]:checked');
      return {
        date: dateInput.value,
        title: titleInput.value.trim(),
        content: editor.area.innerHTML,
        projectId: projectSelect.value,
        mood: checked ? checked.value : '',
        tags: tags.slice()
      };
    }

    var modalApiRef = null;

    function submit() {
      var payload = collect();

      /* 前端基础校验（即时反馈），再由 DB.validateLog 做统一校验 */
      var errors = {};
      if (!payload.date) errors.date = '请选择日期';
      if (!payload.title) errors.title = '标题不能为空';
      if (!U.htmlToText(payload.content || '')) errors.content = '工作内容不能为空';
      if (!payload.projectId) errors.projectId = '请选择所属项目';
      if (!payload.mood) errors.mood = '请选择今日情绪';

      var dbErrors = DB.validateLog(payload);
      Object.keys(dbErrors).forEach(function (key) { errors[key] = dbErrors[key]; });

      if (Object.keys(errors).length) {
        showErrors(errors);
        U.toast('请检查表单填写', 'error');
        return;
      }

      saveBtn.disabled = true;
      var promise = editing ? DB.updateLog(source.id, payload) : DB.createLog(payload);

      promise.then(function () {
        U.toast(editing ? '日志已更新' : '日志已创建', 'ok');
        if (modalApiRef) modalApiRef.close();
        App.render();
      }).catch(function (err) {
        saveBtn.disabled = false;
        var fieldErrors = err && err.errors ? err.errors : null;
        if (fieldErrors && Object.keys(fieldErrors).length) {
          showErrors(fieldErrors);
          U.toast('请检查表单填写', 'error');
        } else {
          U.toast((err && err.message) ? err.message : '保存失败，请稍后重试', 'error');
        }
      });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      submit();
    });

    /* ---- 底部按钮 ---- */
    var cancelBtn = U.el('button', {
      class: 'btn btn--ghost',
      type: 'button',
      text: '取消',
      onclick: function () { if (modalApiRef) modalApiRef.close(); }
    });

    var saveBtn = U.el('button', {
      class: 'btn btn--primary',
      type: 'button',
      html: U.icon('save', 17) + '<span>保存</span>',
      onclick: submit
    });
    if (noProject) saveBtn.disabled = true;

    var footer;
    if (editing) {
      footer = U.el('div', { class: 'row row--between' }, [
        U.el('span', {
          class: 'muted-2 text-xs nowrap',
          text: '上次更新：' + U.formatFull(source.updatedAt)
        }),
        U.el('div', { class: 'row row--tight' }, [cancelBtn, saveBtn])
      ]);
    } else {
      footer = U.el('div', { class: 'row row--end row--gap' }, [cancelBtn, saveBtn]);
    }

    /* ---- 打开模态框 ---- */
    modalApiRef = App.showModal({
      title: editing ? '编辑日志' : '新建日志',
      icon: editing ? 'edit' : 'plus',
      size: 'lg',
      closeOnMask: false,
      body: form,
      footer: footer,
      onClose: function () {                      /* 释放 document 级监听 */
        if (editor) editor.dispose();
      }
    });
  };

  /* ================================================================ 视图 */

  function render(container, params) {
    /* 仅从外部进入时用 params 初始化筛选条件 */
    currentFilter = normalizeFilter(params);
    currentPage = 1;

    /* ---- 页头 ---- */
    var newBtn = U.el('button', {
      class: 'btn btn--primary',
      type: 'button',
      html: U.icon('plus', 17) + '<span>新建日志</span>',
      onclick: function () { App.openLogForm({}); }
    });

    container.appendChild(U.el('div', { class: 'view__head' }, [
      U.el('div', { class: 'view__heading' }, [
        U.el('h2', { class: 'view__title', html: U.icon('list', 20) + '<span>工作日志</span>' }),
        U.el('p', { class: 'view__sub', text: '记录每一天的进展、情绪与待办' })
      ]),
      U.el('div', { class: 'view__actions' }, [newBtn])
    ]));

    /* ---- 筛选栏 ---- */
    var startInput = U.el('input', { class: 'input', type: 'date', 'aria-label': '开始日期' });
    startInput.value = currentFilter.startDate;
    var endInput = U.el('input', { class: 'input', type: 'date', 'aria-label': '结束日期' });
    endInput.value = currentFilter.endDate;

    var projectSelect = U.el('select', { class: 'select', 'aria-label': '项目筛选' });
    projectSelect.appendChild(U.el('option', { value: '', text: '全部项目' }));
    DB.getProjects().forEach(function (project) {
      projectSelect.appendChild(U.el('option', {
        value: project.id,
        text: project.name + (project.archived ? '（已归档）' : '')
      }));
    });
    var projectFound = Array.prototype.some.call(projectSelect.options, function (option) {
      return option.value === currentFilter.projectId;
    });
    projectSelect.value = projectFound ? currentFilter.projectId : '';
    if (!projectFound) currentFilter.projectId = '';

    var moodSelect = U.el('select', { class: 'select', 'aria-label': '情绪筛选' });
    moodSelect.appendChild(U.el('option', { value: '', text: '全部情绪' }));
    U.MOODS.forEach(function (mood) {
      moodSelect.appendChild(U.el('option', { value: mood.value, text: mood.label }));
    });
    var moodFound = Array.prototype.some.call(moodSelect.options, function (option) {
      return option.value === currentFilter.mood;
    });
    moodSelect.value = moodFound ? currentFilter.mood : '';
    if (!moodFound) currentFilter.mood = '';

    var kwInput = U.el('input', {
      class: 'input',
      type: 'text',
      placeholder: '搜索标题、内容、标签…',
      'aria-label': '关键词'
    });
    kwInput.value = currentFilter.keyword;

    var resetBtn = U.el('button', {
      class: 'btn btn--ghost',
      type: 'button',
      html: U.icon('refresh', 16) + '<span>重置</span>'
    });
    resetBtn.addEventListener('click', function () {
      currentFilter = { startDate: '', endDate: '', projectId: '', mood: '', keyword: '' };
      App.navigate('logs', {});
    });

    container.appendChild(U.el('div', { class: 'filter-bar' }, [
      U.el('div', { class: 'field' }, [
        U.el('label', { class: 'field__label' }, [
          U.el('span', { text: '开始日期' }),
          U.el('span', { class: 'field__hint', text: '默认不限' })
        ]),
        startInput
      ]),
      U.el('div', { class: 'field' }, [
        U.el('label', { class: 'field__label' }, [U.el('span', { text: '结束日期' })]),
        endInput
      ]),
      U.el('div', { class: 'field' }, [
        U.el('label', { class: 'field__label' }, [U.el('span', { text: '项目' })]),
        projectSelect
      ]),
      U.el('div', { class: 'field' }, [
        U.el('label', { class: 'field__label' }, [U.el('span', { text: '情绪' })]),
        moodSelect
      ]),
      U.el('div', { class: 'field field--kw' }, [
        U.el('label', { class: 'field__label' }, [U.el('span', { text: '关键词' })]),
        kwInput
      ]),
      U.el('div', { class: 'row' }, [resetBtn])
    ]));

    /* ---- 结果区（仅此容器做局部重绘，筛选栏输入焦点不丢失） ---- */
    var resultWrap = U.el('div', { id: 'logResultWrap', class: 'section' });
    container.appendChild(resultWrap);

    /** 筛选条件变化：回到第 1 页再刷新 */
    function refreshFromFilter() {
      currentPage = 1;
      refreshList();
    }

    function clearFilters() {
      currentFilter = { startDate: '', endDate: '', projectId: '', mood: '', keyword: '' };
      startInput.value = '';
      endInput.value = '';
      projectSelect.value = '';
      moodSelect.value = '';
      kwInput.value = '';
      syncUrl();
      refreshFromFilter();
    }

    function setKeyword(keyword) {
      currentFilter.keyword = keyword;
      kwInput.value = keyword;
      syncUrl();
      refreshFromFilter();
    }

    /** 翻页：只重绘结果区，并把列表滚回可视区顶部 */
    function goPage(page) {
      if (page === currentPage) return;
      currentPage = page;
      refreshList();
      if (typeof resultWrap.scrollIntoView === 'function') {
        resultWrap.scrollIntoView({ block: 'start' });
      }
    }

    function refreshList() {
      var logs = DB.queryLogs(currentFilter);
      var total = logs.length;
      var totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      if (currentPage > totalPages) currentPage = totalPages;
      if (currentPage < 1) currentPage = 1;
      var start = (currentPage - 1) * PAGE_SIZE;

      resultWrap.innerHTML = '';
      resultWrap.appendChild(buildResultRow(total, currentPage, totalPages, clearFilters));
      if (!total) {
        resultWrap.appendChild(buildEmptyState(clearFilters));
        return;
      }
      var list = U.el('div', { class: 'log-list' });
      logs.slice(start, start + PAGE_SIZE).forEach(function (log) {
        list.appendChild(buildLogItem(log, currentFilter.keyword, setKeyword));
      });
      resultWrap.appendChild(list);
      if (totalPages > 1) {
        resultWrap.appendChild(buildPager(currentPage, totalPages, goPage));
      }
    }

    function onFilterChange() {
      currentFilter.startDate = startInput.value;
      currentFilter.endDate = endInput.value;
      currentFilter.projectId = projectSelect.value;
      currentFilter.mood = moodSelect.value;
      currentFilter.keyword = kwInput.value.trim();
      syncUrl();
      refreshFromFilter();
    }

    startInput.addEventListener('change', onFilterChange);
    endInput.addEventListener('change', onFilterChange);
    projectSelect.addEventListener('change', onFilterChange);
    moodSelect.addEventListener('change', onFilterChange);
    kwInput.addEventListener('input', U.debounce(function () {
      currentFilter.keyword = kwInput.value.trim();
      syncUrl();
      refreshFromFilter();
    }, 250));

    refreshList();
  }

  function onDataChange() {
    App.render();
  }

  /* ---------------------------------------------------------------- 导出 */
  App.views.logs = { render: render, onDataChange: onDataChange };
})(window);
