/* =========================================================================
 * projects.js —— 项目管理视图
 *
 * 依赖：window.Utils（U） / window.DB / window.App
 * 导出：
 *   App.views.projects = { render, onDataChange }
 *   App.openProjectForm(options)          —— 新建 / 编辑项目弹窗
 *
 * 说明：原生 JS（无模块化），可直接 file:// 打开运行。
 * ========================================================================= */
(function (global) {
  'use strict';

  var U = global.Utils;
  var DB = global.DB;
  var App = global.App;

  /* 是否展开「已归档」分组（模块级状态，切换后重绘） */
  var showArchived = false;

  /* ============================================================ 通用片段 */

  /** 概览指标卡：statCard('stat--green', '进行中', 3, '个', 'sparkles', hint) */
  function statCard(mod, label, value, unit, iconName, hint) {
    var children = [
      U.el('div', { class: 'stat__top' }, [
        U.el('span', { class: 'stat__label', text: label }),
        U.el('span', { class: 'stat__icon', html: U.icon(iconName, 18) })
      ]),
      U.el('div', { class: 'stat__value' }, [
        String(value),
        U.el('span', { class: 'stat__unit', text: unit })
      ])
    ];
    if (hint) children.push(U.el('div', { class: 'stat__hint', text: hint }));
    return U.el('div', { class: 'stat' + (mod ? ' ' + mod : '') }, children);
  }

  /** 图标 + 文字的小片段 */
  function iconText(iconName, size, text) {
    return U.el('span', { class: 'row row--tight' }, [
      U.el('span', { html: U.icon(iconName, size) }),
      U.el('span', { text: text })
    ]);
  }

  /* ============================================================ 项目卡片 */

  function buildProjectCard(p) {
    var archived = !!p.archived;
    var logCount = DB.countLogsOfProject(p.id);
    var latest = DB.latestLogOfProject(p.id);

    /* ---- 状态徽章 ---- */
    var badges = [
      U.el('span', {
        class: 'badge badge--' + (p.status || 'active'),
        text: U.PROJECT_STATUS_LABEL[p.status] || String(p.status || '')
      })
    ];
    if (archived) badges.push(U.el('span', { class: 'badge badge--archived', text: '已归档' }));

    /* ---- 标题（点击进入该项目的日志列表）---- */
    var titleEl = U.el('div', {
      class: 'project-card__title',
      title: '查看该项目下的全部日志',
      text: p.name,
      onclick: function () { App.navigate('logs', { projectId: p.id }); }
    });

    /* ---- 操作按钮：编辑 / 归档 / 删除 ---- */
    var editBtn = U.el('button', {
      class: 'btn btn--icon btn--ghost',
      type: 'button',
      html: U.icon('edit', 15),
      title: '编辑项目',
      'aria-label': '编辑项目',
      onclick: function () { App.openProjectForm({ project: p }); }
    });

    var archiveBtn = U.el('button', {
      class: 'btn btn--icon btn--ghost',
      type: 'button',
      html: U.icon(archived ? 'archive-restore' : 'archive', 15),
      title: archived ? '取消归档' : '归档项目',
      'aria-label': archived ? '取消归档' : '归档项目',
      onclick: function () { toggleArchive(p); }
    });

    var deleteBtn = U.el('button', {
      class: 'btn btn--icon btn--ghost btn--danger',
      type: 'button',
      html: U.icon('trash', 15),
      title: '删除项目',
      'aria-label': '删除项目',
      onclick: function () { removeProject(p); }
    });

    var head = U.el('div', { class: 'project-card__head' }, [
      U.el('div', { class: 'grow' }, [
        titleEl,
        U.el('div', { class: 'row row--tight', style: { marginTop: '7px' } }, badges)
      ]),
      U.el('div', { class: 'project-card__actions' }, [editBtn, archiveBtn, deleteBtn])
    ]);

    /* ---- 描述 ---- */
    var desc = String(p.description || '').trim();
    var descEl = U.el('div', { class: 'project-card__desc' }, [
      desc ? document.createTextNode(desc) : U.el('span', { class: 'muted', text: '暂无描述' })
    ]);

    /* ---- 统计块 ---- */
    var statsEl = U.el('div', { class: 'project-card__stats' }, [
      U.el('div', { class: 'pstat' }, [
        U.el('div', { class: 'pstat__label', text: '日志数量' }),
        U.el('div', { class: 'pstat__value', text: logCount + ' 条' })
      ]),
      U.el('div', { class: 'pstat' }, [
        U.el('div', { class: 'pstat__label', text: '最近更新' }),
        U.el('div', { class: 'pstat__value', text: U.relativeTime(p.updatedAt) })
      ])
    ]);

    /* ---- 最近日志预览 ---- */
    var preview;
    if (latest) {
      preview = U.el('div', {
        class: 'project-card__preview',
        title: '查看日志详情',
        onclick: function () { App.openLogDetail(latest.id); }
      }, [
        U.el('div', { class: 'project-card__preview-label', html: U.icon('clock', 13) + '<span>最近日志</span>' }),
        U.el('div', {
          class: 'project-card__preview-title',
          text: U.formatDate(latest.date).slice(5) + ' ' + String(latest.title || '')
        }),
        U.el('div', {
          class: 'project-card__preview-text',
          text: U.clampText(U.htmlToText(latest.content || ''), 60)
        })
      ]);
    } else {
      preview = U.el('div', { class: 'project-card__preview', style: { cursor: 'default' } }, [
        U.el('div', { class: 'project-card__preview-label', html: U.icon('clock', 13) + '<span>最近日志</span>' }),
        U.el('div', { class: 'muted text-sm', text: '该项目还没有日志记录' })
      ]);
    }

    /* ---- 底部信息 ---- */
    var footChildren = [iconText('calendar', 13, '创建于 ' + U.formatDate(p.createdAt))];
    if (latest) footChildren.push(iconText('clock', 13, '最近记录 ' + U.formatDate(latest.date)));
    var foot = U.el('div', { class: 'project-card__foot' }, footChildren);

    return U.el('div', {
      class: 'project-card' + (archived ? ' is-archived' : ''),
      dataset: { projectId: p.id }
    }, [head, descEl, statsEl, preview, foot]);
  }

  /* ============================================================ 分组小节 */

  function buildSection(cfg) {
    var titleRow = U.el('div', { class: 'row row--between' }, [
      U.el('div', { class: 'section__title' }, [
        U.el('span', { html: U.icon(cfg.icon, 15) }),
        U.el('span', { text: cfg.label }),
        U.el('span', { class: 'section__count', text: String(cfg.list.length) })
      ]),
      cfg.hint ? U.el('span', { class: 'muted-2 text-xs', text: cfg.hint }) : null
    ]);

    var bodyEl = cfg.list.length
      ? U.el('div', { class: 'project-grid' }, cfg.list.map(function (p) { return buildProjectCard(p); }))
      : U.el('p', { class: 'muted text-sm', text: cfg.empty });

    return U.el('div', { class: 'section' }, [titleRow, bodyEl]);
  }

  /* ======================================================== focusId 高亮 */

  function highlightFocus(container, focusId) {
    if (!focusId) return;
    var cards = U.$$('.project-card', container);
    var target = null;
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].dataset.projectId === focusId) { target = cards[i]; break; }
    }
    if (!target) return;

    setTimeout(function () {
      try { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      catch (e) { target.scrollIntoView(); }

      /* 短暂视觉强调（行内样式，不依赖 style.css） */
      target.style.outline = '2px solid var(--cyan)';
      target.style.outlineOffset = '2px';
      setTimeout(function () {
        target.style.outline = '';
        target.style.outlineOffset = '';
      }, 1600);
    }, 80);
  }

  /* ============================================================ 归档逻辑 */

  function toggleArchive(p) {
    if (!p.archived) {
      App.confirm({
        title: '归档项目',
        message: '确定要归档「' + p.name + '」吗？',
        detail: '归档后该项目不会再出现在新建日志的项目选择列表中，但历史日志与项目信息仍会保留，可随时取消归档。',
        confirmText: '确认归档'
      }).then(function (ok) {
        if (!ok) return;
        DB.setProjectArchived(p.id, true).then(function () {
          U.toast('项目已归档', 'ok');
          App.render();
        }).catch(function (err) {
          U.toast(err && err.message ? err.message : '归档失败，请重试', 'error');
        });
      });
      return;
    }

    App.confirm({
      title: '取消归档',
      message: '确定要取消归档「' + p.name + '」吗？取消后该项目将重新出现在新建日志的项目选择列表中。',
      confirmText: '取消归档',
      danger: false
    }).then(function (ok) {
      if (!ok) return;
      DB.setProjectArchived(p.id, false).then(function () {
        U.toast('已取消归档', 'ok');
        App.render();
      }).catch(function (err) {
        U.toast(err && err.message ? err.message : '操作失败，请重试', 'error');
      });
    });
  }

  /* ============================================================ 删除逻辑 */

  function removeProject(p) {
    var n = DB.countLogsOfProject(p.id);
    var detail = n > 0
      ? '该项目下的 ' + n + ' 条日志不会被删除，但会变为「未关联」状态。此操作不可恢复。'
      : '此操作不可恢复。';

    App.confirm({
      title: '删除项目',
      message: '确定要删除「' + p.name + '」吗？',
      detail: detail,
      confirmText: '确认删除',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      DB.deleteProject(p.id).then(function () {
        U.toast('项目已删除', 'ok');
        App.render();
      }).catch(function (err) {
        U.toast(err && err.message ? err.message : '删除失败，请重试', 'error');
      });
    });
  }

  /* ============================================================ 视图渲染 */

  function render(container, params) {
    params = params || {};
    container.innerHTML = '';

    var stats = DB.stats();
    var projects = DB.getProjects();
    var archivedProjects = projects.filter(function (p) { return !!p.archived; });

    /* ---- 页头 ---- */
    var toggleBtn = U.el('button', {
      class: 'btn btn--ghost btn--sm',
      type: 'button',
      html: U.icon(showArchived ? 'close' : 'archive', 15) + '<span>' +
        (showArchived ? '隐藏已归档项目' : '显示已归档项目 ' + archivedProjects.length + ' 个') + '</span>',
      onclick: function () { showArchived = !showArchived; App.render(); }
    });

    var newBtn = U.el('button', {
      class: 'btn btn--primary',
      type: 'button',
      html: U.icon('plus', 17) + '<span>新建项目</span>',
      onclick: function () { App.openProjectForm({}); }
    });

    container.appendChild(U.el('div', { class: 'view__head' }, [
      U.el('div', { class: 'view__heading' }, [
        U.el('h2', { class: 'view__title', html: U.icon('folder', 21) + '<span>项目管理</span>' }),
        U.el('p', { class: 'view__sub', text: '维护项目信息、跟踪日志产出与最近进展' })
      ]),
      U.el('div', { class: 'view__actions' }, [toggleBtn, newBtn])
    ]));

    /* ---- 全部为空：整体空态 ---- */
    if (!projects.length) {
      container.appendChild(U.el('div', { class: 'empty' }, [
        U.el('div', { class: 'empty__icon', html: U.icon('folder', 34) }),
        U.el('div', { class: 'empty__text', text: '还没有项目，先创建一个项目再开始记录日志吧' }),
        U.el('button', {
          class: 'btn btn--primary',
          type: 'button',
          html: U.icon('plus', 17) + '<span>创建第一个项目</span>',
          onclick: function () { App.openProjectForm({}); }
        })
      ]));
      highlightFocus(container, params.focusId);
      return;
    }

    /* ---- 概览指标 ---- */
    var relatedLogs = stats.totalLogs - stats.orphanLogs;
    container.appendChild(U.el('div', { class: 'stat-grid' }, [
      statCard('', '项目总数', stats.totalProjects, '个', 'folder', ''),
      statCard('stat--green', '进行中', stats.activeProjects, '个', 'sparkles', ''),
      statCard('stat--amber', '已归档', stats.archivedProjects, '个', 'archive', ''),
      statCard('stat--violet', '关联日志', relatedLogs, '条', 'list', '未关联 ' + stats.orphanLogs + ' 条')
    ]));

    /* ---- 按状态分组 ---- */
    var active = [], completed = [], paused = [];
    projects.forEach(function (p) {
      if (p.archived) return;
      if (p.status === 'active') active.push(p);
      else if (p.status === 'completed') completed.push(p);
      else if (p.status === 'paused') paused.push(p);
    });

    container.appendChild(buildSection({
      icon: 'folder', label: '进行中', list: active, empty: '暂无进行中的项目'
    }));
    container.appendChild(buildSection({
      icon: 'check-circle', label: '已完成', list: completed, empty: '暂无已完成的项目'
    }));
    container.appendChild(buildSection({
      icon: 'clock', label: '已搁置', list: paused, empty: '暂无已搁置的项目'
    }));

    /* ---- 已归档分组（仅开启显示时渲染）---- */
    if (showArchived) {
      container.appendChild(buildSection({
        icon: 'archive',
        label: '已归档',
        list: archivedProjects,
        empty: '暂无已归档的项目',
        hint: '归档项目不会出现在新建日志的项目选择列表中'
      }));
    }

    /* ---- focusId 高亮 ---- */
    highlightFocus(container, params.focusId);
  }

  function onDataChange() { App.render(); }

  /* ======================================================== 新建 / 编辑弹窗 */

  /**
   * 打开项目表单弹窗
   * @param {object} options { project?: 项目对象 }（传入 project 即为编辑模式）
   */
  App.openProjectForm = function (options) {
    var opts = options || {};
    var original = opts.project || null;
    var editing = !!original;
    var modal;

    /* ---- 字段 1：项目名称 ---- */
    var nameInput = U.el('input', {
      class: 'input', type: 'text', maxlength: '50',
      placeholder: '例如：智能巡检机器人平台', 'data-autofocus': '1'
    });
    nameInput.value = editing ? String(original.name || '') : '';

    var nameCounter = U.el('span', { class: 'field__counter' });
    var nameErrText = U.el('span');
    var nameField = U.el('div', { class: 'field field--full' }, [
      U.el('label', { class: 'field__label' }, [
        U.el('span', { text: '项目名称' }),
        U.el('span', { class: 'req', text: '*' })
      ]),
      nameInput,
      U.el('div', { class: 'row row--between' }, [
        U.el('span', { class: 'field__hint', text: '1-50 个字符，项目名称需唯一' }),
        nameCounter
      ]),
      U.el('div', { class: 'field__error' }, [
        U.el('span', { html: U.icon('alert-circle', 12) }),
        nameErrText
      ])
    ]);

    /* ---- 字段 2：项目状态 ---- */
    var statusSelect = U.el('select', { class: 'select' });
    var initialStatus = editing ? original.status : 'active';
    U.PROJECT_STATUS.forEach(function (s) {
      var opt = U.el('option', { value: s.value, text: s.label });
      if (s.value === initialStatus) opt.selected = true;
      statusSelect.appendChild(opt);
    });

    var statusErrText = U.el('span');
    var statusField = U.el('div', { class: 'field' }, [
      U.el('label', { class: 'field__label' }, [
        U.el('span', { text: '项目状态' }),
        U.el('span', { class: 'req', text: '*' })
      ]),
      statusSelect,
      U.el('div', { class: 'field__error' }, [
        U.el('span', { html: U.icon('alert-circle', 12) }),
        statusErrText
      ])
    ]);

    /* ---- 字段 3：项目描述 ---- */
    var descInput = U.el('textarea', {
      class: 'textarea', maxlength: '2000', rows: '4',
      placeholder: '补充项目背景、目标与范围等（可留空）'
    });
    descInput.value = editing ? String(original.description || '') : '';

    var descCounter = U.el('span', { class: 'field__counter' });
    var descErrText = U.el('span');
    var descField = U.el('div', { class: 'field field--full' }, [
      U.el('label', { class: 'field__label' }, [U.el('span', { text: '项目描述' })]),
      descInput,
      U.el('div', { class: 'row row--between' }, [
        U.el('span', { class: 'field__hint', text: '0-2000 个字符，可留空' }),
        descCounter
      ]),
      U.el('div', { class: 'field__error' }, [
        U.el('span', { html: U.icon('alert-circle', 12) }),
        descErrText
      ])
    ]);

    /* ---- 表单容器 ---- */
    var form = U.el('form', {
      class: 'form',
      onsubmit: function (e) { e.preventDefault(); submit(); }
    }, [
      U.el('div', { class: 'form-grid' }, [nameField, statusField, descField])
    ]);

    var body = U.el('div', { class: 'col' });
    if (editing) {
      body.appendChild(U.el('p', {
        class: 'muted text-sm',
        text: '创建于 ' + U.formatDate(original.createdAt) +
          ' · 当前 ' + DB.countLogsOfProject(original.id) + ' 条关联日志'
      }));
    }
    body.appendChild(form);

    /* ---- 字数计数器 ---- */
    function bindCounter(input, counter, max) {
      function update() {
        var len = input.value.length;
        counter.textContent = len + ' / ' + max;
        counter.classList.toggle('is-over', len > max);
      }
      input.addEventListener('input', update);
      update();
    }
    bindCounter(nameInput, nameCounter, 50);
    bindCounter(descInput, descCounter, 2000);

    /* ---- 字段注册表（用于错误展示与聚焦）---- */
    var fields = {
      name: { field: nameField, error: nameErrText, control: nameInput },
      status: { field: statusField, error: statusErrText, control: statusSelect },
      description: { field: descField, error: descErrText, control: descInput }
    };
    var fieldOrder = ['name', 'status', 'description'];

    function clearErrors() {
      fieldOrder.forEach(function (k) {
        fields[k].field.classList.remove('has-error');
        fields[k].error.textContent = '';
      });
    }

    function applyErrors(errors) {
      Object.keys(errors).forEach(function (k) {
        var f = fields[k];
        if (!f) return;
        f.field.classList.add('has-error');
        f.error.textContent = errors[k];
      });
    }

    function focusFirstError(errors) {
      for (var i = 0; i < fieldOrder.length; i++) {
        if (errors[fieldOrder[i]] && fields[fieldOrder[i]]) {
          fields[fieldOrder[i]].control.focus();
          return;
        }
      }
    }

    /* ---- 提交 ---- */
    function submit() {
      clearErrors();

      var payload = {
        name: nameInput.value.trim(),
        status: statusSelect.value,
        description: descInput.value
      };

      var errors = DB.validateProject(payload, editing ? original.id : null);
      if (Object.keys(errors).length) {
        applyErrors(errors);
        U.toast('请检查表单填写', 'error');
        focusFirstError(errors);
        return;
      }

      saveBtn.disabled = true;
      var action = editing
        ? DB.updateProject(original.id, payload)
        : DB.createProject(payload);

      action.then(function () {
        U.toast(editing ? '项目已更新' : '项目已创建', 'ok');
        modal.close();
        App.render();
      }).catch(function (err) {
        saveBtn.disabled = false;
        var errs = err && err.errors ? err.errors : null;
        if (errs && Object.keys(errs).length) {
          applyErrors(errs);
          U.toast('请检查表单填写', 'error');
          focusFirstError(errs);
        } else {
          U.toast(err && err.message ? err.message : '保存失败，请重试', 'error');
        }
      });
    }

    /* ---- 底部按钮 ---- */
    var cancelBtn = U.el('button', {
      class: 'btn btn--ghost', type: 'button', text: '取消',
      onclick: function () { modal.close(); }
    });
    var saveBtn = U.el('button', {
      class: 'btn btn--primary', type: 'button',
      html: U.icon('save', 16) + '<span>保存</span>',
      onclick: submit
    });
    var footer = U.el('div', { class: 'row row--end row--gap' }, [cancelBtn, saveBtn]);

    modal = App.showModal({
      size: 'md',
      icon: editing ? 'edit' : 'plus',
      title: editing ? '编辑项目' : '新建项目',
      closeOnMask: false,
      body: body,
      footer: footer
    });
  };

  /* ================================================================ 导出 */
  App.views.projects = { render: render, onDataChange: onDataChange };
})(window);
