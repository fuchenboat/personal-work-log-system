/* =========================================================================
 * dashboard.js —— 数据看板视图
 *
 * 内容分区：
 *   1. 页头（标题 / 副标题 / 刷新）
 *   2. 指标卡 ×4（总日志 / 本月新增 / 进行中项目 / 连续记录）
 *   3. 两列主体：项目日志占比（纯 SVG 环形图 + 图例）、记录节奏（情绪分布 + 投入 TOP5）
 *   4. 记录日历（月份切换、日志标记、当日日志面板）
 *   5. 最近日志（最近 6 条）
 *
 * 注册：App.views.dashboard = { render, onDataChange }
 * 依赖：window.Utils / window.DB / window.App（无任何外部库）
 * ========================================================================= */
(function (global) {
  'use strict';

  var U = global.Utils;
  var DB = global.DB;
  var App = global.App;

  /* 项目调色板：按项目序号取模循环 */
  var PALETTE = ['#22d3ee', '#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#60a5fa', '#facc15', '#fb7185'];

  /* 环形图几何常量：半径 70，圆心 (95,95)，线宽 20 */
  var DONUT_R = 70;
  var DONUT_CX = 95;
  var DONUT_CY = 95;
  var DONUT_CIRC = 2 * Math.PI * DONUT_R;          // ≈ 439.82

  /* 日历卡片在 DOM 中的标识，供局部刷新时定位 */
  var CAL_HOST_ID = 'calCardHost';

  /* 情绪条形填充色 */
  var MOOD_GRADIENT = {
    smooth: 'linear-gradient(90deg,#34d399,#22d3ee)',
    normal: 'linear-gradient(90deg,#22d3ee,#60a5fa)',
    frustrated: 'linear-gradient(90deg,#fb7185,#f472b6)'
  };

  var MOOD_VALUES = ['smooth', 'normal', 'frustrated'];

  var WEEK_DOW = ['日', '一', '二', '三', '四', '五', '六'];

  /* 模块级状态：日历显示的年月（month 为 0-11）与选中日期 */
  var nowDate = new Date();
  var calState = { year: nowDate.getFullYear(), month: nowDate.getMonth(), selected: null };

  /* ------------------------------------------------------------ 小工具 */
  function round1(n) { return Math.round(n * 10) / 10; }

  function round2(n) { return Math.round(n * 100) / 100; }

  /** 「N 条」占比文案，总数为 0 时返回 0% */
  function pctText(part, total) {
    if (!total) return '0%';
    return round1(part / total * 100) + '%';
  }

  /** 百分比宽度字符串 */
  function pctWidth(part, total) {
    if (!total) return '0%';
    return round1(part / total * 100) + '%';
  }

  /** 规范化情绪值，防止脏数据导致类名异常 */
  function safeMood(mood) {
    return MOOD_VALUES.indexOf(mood) === -1 ? 'normal' : mood;
  }

  /** 调用日志模块新建（模块未就绪时给出提示） */
  function openLogForm(dateStr) {
    if (typeof App.openLogForm === 'function') App.openLogForm({ presetDate: dateStr });
    else U.toast('日志模块尚未就绪', 'warn');
  }

  /** 调用日志模块查看详情 */
  function openLogDetail(id) {
    if (typeof App.openLogDetail === 'function') App.openLogDetail(id);
    else U.toast('日志模块尚未就绪', 'warn');
  }

  /* -------------------------------------------------------- 空态 / 小片段 */
  function emptyBlock(iconName, text, hint) {
    return U.el('div', { class: 'empty' }, [
      U.el('div', { class: 'empty__icon', html: U.icon(iconName, 30) }),
      U.el('div', { class: 'empty__text', text: text }),
      hint ? U.el('div', { class: 'empty__hint', text: hint }) : null
    ]);
  }

  /** 单条日志（看板 / 日历面板共用） */
  function miniLog(log) {
    var project = log.projectId ? DB.getProject(log.projectId) : null;
    var projectName = project ? project.name : '未关联';
    var mood = safeMood(log.mood);

    return U.el('div', {
      class: 'mini-log',
      onclick: function () { openLogDetail(log.id); }
    }, [
      U.el('div', { class: 'mini-log__date', text: String(log.date || '').slice(5) }),
      U.el('div', { class: 'mini-log__main' }, [
        U.el('div', { class: 'mini-log__title', text: log.title || '(无标题)', title: log.title || '' }),
        U.el('div', { class: 'mini-log__meta' }, [
          U.el('span', { html: U.icon('link', 12) + '<span>' + U.escapeHtml(projectName) + '</span>' }),
          U.el('span', { class: 'badge badge--' + mood, text: U.MOOD_LABEL[mood] }),
          U.el('span', { text: U.relativeTime(log.updatedAt) })
        ])
      ])
    ]);
  }

  /* =============================================================== 页头 */
  function renderHead() {
    var refreshBtn = U.el('button', {
      class: 'btn btn--ghost',
      type: 'button',
      title: '重新加载看板数据',
      html: U.icon('refresh', 16) + '<span>刷新</span>'
    });
    refreshBtn.addEventListener('click', function () {
      U.toast('数据已是最新', 'ok');
      App.render();
    });

    return U.el('header', { class: 'view__head' }, [
      U.el('div', { class: 'view__heading' }, [
        U.el('h2', { class: 'view__title', html: U.icon('dashboard', 22) + '<span>数据看板</span>' }),
        U.el('p', { class: 'view__sub', text: '实时掌握工作节奏与项目投入分布' })
      ]),
      U.el('div', { class: 'view__actions' }, [refreshBtn])
    ]);
  }

  /* ========================================================== 上下文计算 */
  function buildContext(stats) {
    var byProject = stats.byProject || [];
    var colorMap = {};
    var usedProjects = 0;

    byProject.forEach(function (p, i) {
      colorMap[p.id] = PALETTE[i % PALETTE.length];
      if (p.count > 0) usedProjects++;
    });

    return { stats: stats, byProject: byProject, colorMap: colorMap, usedProjects: usedProjects };
  }

  /* ========================================================== 指标卡区 */
  function statCard(opts) {
    return U.el('div', { class: 'stat' + (opts.modifier ? ' ' + opts.modifier : '') }, [
      U.el('div', { class: 'stat__top' }, [
        U.el('span', { class: 'stat__label', text: opts.label }),
        U.el('span', { class: 'stat__icon', html: U.icon(opts.icon, 18) })
      ]),
      U.el('div', {
        class: 'stat__value',
        html: U.escapeHtml(opts.value) + '<span class="stat__unit">' + U.escapeHtml(opts.unit) + '</span>'
      }),
      U.el('div', { class: 'stat__hint', text: opts.hint })
    ]);
  }

  function renderStats(ctx) {
    var stats = ctx.stats;
    var monthLabel = nowDate.getFullYear() + ' 年 ' + (nowDate.getMonth() + 1) + ' 月';

    return U.el('div', { class: 'stat-grid' }, [
      statCard({
        label: '总日志记录数',
        icon: 'list',
        value: stats.totalLogs,
        unit: '条',
        hint: '覆盖 ' + ctx.usedProjects + ' 个项目'
      }),
      statCard({
        label: '本月新增',
        icon: 'sparkles',
        value: stats.monthLogs,
        unit: '条',
        modifier: 'stat--violet',
        hint: monthLabel
      }),
      statCard({
        label: '进行中项目',
        icon: 'folder',
        value: stats.activeProjects,
        unit: '个',
        modifier: 'stat--green',
        hint: '共 ' + stats.totalProjects + ' 个项目'
      }),
      statCard({
        label: '连续记录',
        icon: 'clock',
        value: stats.streak,
        unit: '天',
        modifier: 'stat--amber',
        hint: '平均每周 ' + stats.avgPerWeek + ' 条'
      })
    ]);
  }

  /* ================================================== 环形图（纯 SVG） */
  function donutSvg(segments, total) {
    var out = '<svg width="190" height="190" viewBox="0 0 190 190">';

    if (!total) {
      /* 无数据：画一个灰色底圆 */
      out += '<circle class="chart-donut__seg" cx="' + DONUT_CX + '" cy="' + DONUT_CY + '" r="' + DONUT_R +
        '" fill="none" stroke="rgba(56,189,248,0.15)" stroke-width="20" stroke-linecap="butt"></circle>';
    } else {
      var offset = 0;
      segments.forEach(function (seg) {
        var len = DONUT_CIRC * (seg.count / total);
        var title = seg.name + '：' + seg.count + ' 条（' + pctText(seg.count, total) + '）';
        out += '<circle class="chart-donut__seg" cx="' + DONUT_CX + '" cy="' + DONUT_CY + '" r="' + DONUT_R +
          '" fill="none" stroke="' + seg.color + '" stroke-width="20" stroke-linecap="butt"' +
          ' stroke-dasharray="' + round2(len) + ' ' + round2(DONUT_CIRC - len) + '"' +
          ' stroke-dashoffset="' + round2(-offset) + '">' +
          '<title>' + U.escapeHtml(title) + '</title></circle>';
        offset += len;
      });
    }

    out += '</svg>';
    return out;
  }

  function renderDonutCard(ctx) {
    var stats = ctx.stats;
    var total = stats.totalLogs;

    /* 组装分段：有日志的项目 + 未关联项目 */
    var segments = [];
    ctx.byProject.forEach(function (p) {
      if (p.count > 0) {
        segments.push({ id: p.id, name: p.name, count: p.count, color: ctx.colorMap[p.id] });
      }
    });
    if (stats.orphanLogs > 0) {
      segments.push({ id: null, name: '未关联项目', count: stats.orphanLogs, color: '#6a81a6' });
    }

    var donut = U.el('div', { class: 'chart-donut', html: donutSvg(segments, total) });
    donut.appendChild(U.el('div', { class: 'chart-donut__center' }, [
      U.el('div', { class: 'chart-donut__num', text: String(total) }),
      U.el('div', { class: 'chart-donut__cap', text: '条日志' })
    ]));

    var legend = U.el('div', { class: 'legend' });
    if (!segments.length) {
      legend.appendChild(U.el('p', { class: 'muted text-sm', text: '暂无项目日志数据' }));
    } else {
      segments.forEach(function (seg) {
        legend.appendChild(U.el('div', {
          class: 'legend__item',
          title: seg.name,
          onclick: seg.id ? function () { App.navigate('logs', { projectId: seg.id }); } : null
        }, [
          U.el('span', { class: 'legend__dot', style: { background: seg.color, color: seg.color } }),
          U.el('span', { class: 'legend__name', text: seg.name }),
          U.el('span', { class: 'legend__val', text: seg.count + ' 条' }),
          U.el('span', { class: 'legend__pct', text: pctText(seg.count, total) })
        ]));
      });
    }

    return U.el('section', { class: 'card' }, [
      U.el('header', { class: 'card__head' }, [
        U.el('h3', { class: 'card__title', html: U.icon('pie', 17) + '<span>项目日志占比</span>' })
      ]),
      U.el('div', { class: 'card__body' }, [
        U.el('div', { class: 'chart-wrap' }, [donut, legend])
      ])
    ]);
  }

  /* ================================================== 记录节奏卡片 */
  function barItem(name, valueText, width, color, onClick) {
    return U.el('div', { class: 'bar-item', onclick: onClick }, [
      U.el('div', { class: 'bar-item__head' }, [
        U.el('span', { class: 'bar-item__name', text: name }),
        U.el('span', { class: 'bar-item__val', text: valueText })
      ]),
      U.el('div', { class: 'bar' }, [
        U.el('div', { class: 'bar__fill', style: { width: width, background: color } })
      ])
    ]);
  }

  function renderRhythmCard(ctx) {
    var stats = ctx.stats;
    var total = stats.totalLogs;
    var body = U.el('div', { class: 'card__body' });

    if (!total) {
      body.appendChild(emptyBlock('chart', '还没有日志记录', '记录日志后即可查看情绪分布与项目投入 TOP5'));
    } else {
      var col = U.el('div', { class: 'col' });

      /* 1. 情绪分布 */
      var moodList = U.el('div', { class: 'bar-list' });
      U.MOODS.forEach(function (m) {
        var count = stats.moods[m.value] || 0;
        moodList.appendChild(barItem(
          m.label,
          count + ' 条 · ' + pctText(count, total),
          pctWidth(count, total),
          MOOD_GRADIENT[m.value],
          function () { App.navigate('logs', { mood: m.value }); }
        ));
      });
      col.appendChild(U.el('div', { class: 'section' }, [
        U.el('div', { class: 'section__title', text: '今日情绪分布' }),
        moodList
      ]));

      col.appendChild(U.el('hr', { class: 'divider' }));

      /* 2. 项目投入 TOP5 */
      var top = ctx.byProject.filter(function (p) { return p.count > 0; }).slice(0, 5);
      var topList = U.el('div', { class: 'bar-list' });
      if (!top.length) {
        topList.appendChild(U.el('p', { class: 'muted text-sm', text: '暂无项目投入数据' }));
      } else {
        var max = top[0].count;
        top.forEach(function (p) {
          var width = max ? (round1(p.count / max * 100) + '%') : '0%';
          topList.appendChild(barItem(
            p.name,
            p.count + ' 条',
            width,
            ctx.colorMap[p.id],
            function () { App.navigate('logs', { projectId: p.id }); }
          ));
        });
      }
      col.appendChild(U.el('div', { class: 'section' }, [
        U.el('div', { class: 'section__title', text: '项目投入 TOP5' }),
        topList
      ]));

      body.appendChild(col);
    }

    return U.el('section', { class: 'card' }, [
      U.el('header', { class: 'card__head' }, [
        U.el('h3', { class: 'card__title', html: U.icon('chart', 17) + '<span>记录节奏</span>' })
      ]),
      body
    ]);
  }

  /* ====================================================== 记录日历 */
  function shiftMonth(delta) {
    var m = calState.month + delta;
    calState.year += Math.floor(m / 12);
    calState.month = ((m % 12) + 12) % 12;
    refreshCalendar();
  }

  function goToday() {
    var d = new Date();
    calState.year = d.getFullYear();
    calState.month = d.getMonth();
    refreshCalendar();
  }

  /**
   * 局部刷新日历卡片。
   * 这里刻意不使用 App.render()：整页重绘会把主区域滚动位置重置到顶部，
   * 导致用户每次点击日期后都要重新往下滚动才能看到日历。改为只替换
   * 日历这一张卡片，滚动位置保持不变。
   */
  function refreshCalendar() {
    var host = document.getElementById(CAL_HOST_ID);
    if (!host) { App.render(); return; }   // 兜底：卡片不在 DOM 中时退回整页重绘

    var fresh = renderCalendarCard();
    host.replaceWith(fresh);

    /* 若当天日志面板在视口外，最小幅度滚动使其可见，不影响已有滚动位置 */
    var panel = fresh.querySelector('.cal__panel');
    if (panel && typeof panel.scrollIntoView === 'function') {
      panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function dayCell(year, month, day, todayStr) {
    var date = new Date(year, month, day);
    var dateStr = U.formatDate(date);
    var dow = date.getDay();
    var logs = DB.logsByDate(dateStr);

    var cls = 'cal__day';
    if (dow === 0 || dow === 6) cls += ' is-weekend';
    if (dateStr === todayStr) cls += ' is-today';
    if (logs.length) cls += ' has-log';
    if (calState.selected === dateStr) cls += ' is-selected';

    var children = [U.el('span', { class: 'cal__num', text: String(day) })];

    if (logs.length) {
      var first = logs[0];
      children.push(U.el('div', { class: 'cal__badges' }, [
        U.el('span', { class: 'cal__count', text: logs.length + ' 条' }),
        U.el('span', { class: 'cal__mood cal__mood--' + safeMood(first.mood) })
      ]));
      children.push(U.el('div', { class: 'cal__peek', text: U.clampText(first.title, 10) }));
    }

    return U.el('button', {
      class: cls,
      type: 'button',
      title: dateStr + ' ' + U.weekdayCN(date),
      onclick: function () {
        if (logs.length) {
          calState.selected = dateStr;
          refreshCalendar();
        } else {
          openLogForm(dateStr);
        }
      }
    }, children);
  }

  function renderDayPanel() {
    var dateStr = calState.selected;
    if (!dateStr) return null;

    var logs = DB.logsByDate(dateStr);
    if (!logs.length) return null;

    var panel = U.el('div', { class: 'cal__panel' });

    panel.appendChild(U.el('div', { class: 'row row--between' }, [
      U.el('div', { class: 'row row--tight' }, [
        U.el('span', { class: 'badge badge--cyan', text: dateStr }),
        U.el('span', { class: 'muted text-sm', text: U.weekdayCN(dateStr) + ' · 共 ' + logs.length + ' 条日志' })
      ])
    ]));

    logs.forEach(function (log) { panel.appendChild(miniLog(log)); });

    var more = U.el('button', {
      class: 'btn btn--ghost btn--sm',
      type: 'button',
      html: U.icon('external', 14) + '<span>查看该日全部日志</span>'
    });
    more.addEventListener('click', function () { App.navigate('logs', { date: dateStr }); });
    panel.appendChild(U.el('div', { class: 'row row--end' }, [more]));

    return panel;
  }

  function navButton(iconName, label, handler) {
    var btn = U.el('button', {
      class: 'btn btn--icon btn--ghost',
      type: 'button',
      title: label,
      'aria-label': label,
      html: U.icon(iconName, 16)
    });
    btn.addEventListener('click', handler);
    return btn;
  }

  function renderCalendarCard() {
    /* 选中日期已无日志（被删除）时清除选中态 */
    if (calState.selected && DB.logsByDate(calState.selected).length === 0) calState.selected = null;

    var todayBtn = U.el('button', { class: 'btn btn--sm btn--ghost', type: 'button', text: '今天' });
    todayBtn.addEventListener('click', goToday);

    var nav = U.el('div', { class: 'cal__nav' }, [
      navButton('chevron-left', '上一月', function () { shiftMonth(-1); }),
      navButton('chevron-right', '下一月', function () { shiftMonth(1); }),
      todayBtn
    ]);

    var grid = U.el('div', { class: 'cal__grid' });
    WEEK_DOW.forEach(function (label, i) {
      grid.appendChild(U.el('div', {
        class: 'cal__dow' + (i === 0 || i === 6 ? ' cal__dow--weekend' : ''),
        text: label
      }));
    });

    var firstDow = new Date(calState.year, calState.month, 1).getDay();
    var daysInMonth = new Date(calState.year, calState.month + 1, 0).getDate();
    var todayStr = U.today();
    var i;

    /* 月初空白占位 */
    for (i = 0; i < firstDow; i++) {
      grid.appendChild(U.el('button', {
        class: 'cal__day is-empty',
        type: 'button',
        tabindex: '-1',
        'aria-hidden': 'true'
      }));
    }
    for (i = 1; i <= daysInMonth; i++) {
      grid.appendChild(dayCell(calState.year, calState.month, i, todayStr));
    }

    var cal = U.el('div', { class: 'cal' }, [
      U.el('div', { class: 'cal__head' }, [
        U.el('div', { class: 'cal__title', text: calState.year + ' 年 ' + U.pad2(calState.month + 1) + ' 月' }),
        U.el('div', { class: 'cal__legend' }, [
          U.el('span', { class: 'cal__legend-item' }, [
            U.el('span', { class: 'cal__legend-dot' }),
            U.el('span', { text: '有记录' })
          ]),
          U.el('span', { class: 'cal__legend-item' }, [
            U.el('span', { class: 'cal__legend-ring' }),
            U.el('span', { text: '今天' })
          ]),
          U.el('span', { class: 'muted-2', text: '点击空白日期可快速创建' })
        ])
      ]),
      grid,
      renderDayPanel()
    ]);

    return U.el('section', { class: 'card', id: CAL_HOST_ID }, [
      U.el('header', { class: 'card__head' }, [
        U.el('h3', { class: 'card__title', html: U.icon('calendar', 17) + '<span>记录日历</span>' }),
        U.el('div', { class: 'card__head-actions' }, [nav])
      ]),
      U.el('div', { class: 'card__body' }, [cal])
    ]);
  }

  /* ====================================================== 最近日志 */
  function renderRecentCard() {
    var logs = DB.getLogs().slice(0, 6);
    var body = U.el('div', { class: 'card__body' });

    if (!logs.length) {
      body.appendChild(emptyBlock('history', '还没有日志', '点击右上角「新建日志」开始记录'));
    } else {
      logs.forEach(function (log) { body.appendChild(miniLog(log)); });
    }

    var allBtn = U.el('button', {
      class: 'btn btn--ghost btn--sm',
      type: 'button',
      html: U.icon('list', 14) + '<span>查看全部</span>'
    });
    allBtn.addEventListener('click', function () { App.navigate('logs', {}); });

    return U.el('section', { class: 'card' }, [
      U.el('header', { class: 'card__head' }, [
        U.el('h3', { class: 'card__title', html: U.icon('clock', 17) + '<span>最近日志</span>' }),
        U.el('div', { class: 'card__head-actions' }, [allBtn])
      ]),
      body
    ]);
  }

  /* ========================================================== 渲染入口 */
  function render(container, params) {
    var stats = DB.stats();
    var ctx = buildContext(stats);

    container.appendChild(renderHead());
    container.appendChild(renderStats(ctx));
    container.appendChild(U.el('div', { class: 'grid grid--2' }, [
      renderDonutCard(ctx),
      renderRhythmCard(ctx)
    ]));
    container.appendChild(renderCalendarCard());
    container.appendChild(renderRecentCard());
  }

  /** 数据变更时重绘（渲染过程不写数据，不会造成循环） */
  function onDataChange() {
    App.render();
  }

  App.views.dashboard = { render: render, onDataChange: onDataChange };
})(window);
