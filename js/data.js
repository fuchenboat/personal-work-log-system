/* =========================================================================
 * data.js —— 数据层（DB）
 *
 * 双模式自动切换：
 *   1) server 模式：检测到后端 API 可用（server.js / server.py）时，
 *      所有读写都通过 REST 接口落到 data/logs.json、data/projects.json，
 *      实现真正的文件级持久化。
 *   2) local  模式：直接双击打开 index.html 时（file:// 协议无后端），
 *      自动降级为浏览器 localStorage 持久化，刷新/重开页面数据不丢失。
 *
 * 对外暴露 window.DB，所有方法均为 Promise 风格。
 * ========================================================================= */
(function (global) {
  'use strict';

  var U = global.Utils;
  var STORAGE_KEY = 'pwls:data:v1';
  var API_BASE = 'api';

  /* 参与"修改记录"比对的日志字段 */
  var TRACKED_FIELDS = ['date', 'title', 'content', 'projectId', 'mood', 'tags'];

  /* ------------------------------------------------------------ 内部状态 */
  var state = {
    mode: 'local',      // 'server' | 'local'
    ready: false,
    projects: [],
    logs: [],
    listeners: []
  };

  /* -------------------------------------------------------------- 工具函数 */
  function nextId(prefix) { return U.uid(prefix); }

  function nowIso() { return new Date().toISOString(); }

  function clone(obj) { return U.deepClone(obj); }

  /** 数组字段排序：日志按日期倒序，同日按更新时间倒序 */
  function sortLogs(list) {
    return list.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    });
  }

  /* ------------------------------------------------------ 请求封装（server） */
  function request(path, options) {
    var opts = options || {};
    var init = {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json' }
    };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);

    var controller = null;
    var timer = null;
    if (typeof AbortController === 'function') {
      controller = new AbortController();
      init.signal = controller.signal;
      timer = setTimeout(function () { controller.abort(); }, 6000);
    }

    return fetch(API_BASE + path, init).then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) {
        return res.text().then(function (text) {
          var msg = '请求失败（' + res.status + '）';
          try { var j = JSON.parse(text); if (j && j.error) msg = j.error; } catch (e) { /* 忽略 */ }
          var err = new Error(msg); err.status = res.status; throw err;
        });
      }
      return res.json();
    }).catch(function (err) {
      if (timer) clearTimeout(timer);
      throw err;
    });
  }

  /* ------------------------------------------------- localStorage 读写（local 模式） */
  function readLocal() {
    var raw = null;
    try { raw = global.localStorage.getItem(STORAGE_KEY); } catch (e) { raw = null; }
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.projects) && Array.isArray(parsed.logs)) return parsed;
    } catch (e) { /* 数据损坏则重新播种 */ }
    return null;
  }

  function writeLocal() {
    var payload = {
      version: 1,
      updatedAt: nowIso(),
      projects: state.projects,
      logs: state.logs
    };
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      U.toast('本地存储写入失败，可能是浏览器隐私模式或空间已满', 'error');
    }
  }

  function seedLocal() {
    var seed = global.SEED_DATA || { projects: [], logs: [] };
    state.projects = clone(seed.projects || []);
    state.logs = clone(seed.logs || []);
    writeLocal();
  }

  /* ------------------------------------------------------------- 变更通知 */
  function emit() {
    state.listeners.forEach(function (fn) {
      try { fn(state); } catch (e) { /* 单个监听器异常不影响其他 */ }
    });
  }

  /* ------------------------------------------------------------------ 校验 */
  function normalizeTags(tags) {
    var list = [];
    var seen = {};
    (tags || []).forEach(function (t) {
      var v = String(t === null || t === undefined ? '' : t).trim();
      if (!v) return;
      if (v.length > 20) v = v.slice(0, 20);
      var key = v.toLowerCase();
      if (seen[key]) return;
      seen[key] = 1;
      list.push(v);
    });
    return list.slice(0, 12);
  }

  function validateLog(payload, excludeId) {
    var errors = {};
    if (!payload.date || !U.toDate(payload.date)) errors.date = '请选择有效日期';
    var title = String(payload.title || '').trim();
    if (!title) errors.title = '标题不能为空';
    else if (title.length > 80) errors.title = '标题不超过 80 个字符';

    var text = U.htmlToText(payload.content || '');
    if (!text) errors.content = '工作内容不能为空';

    if (!payload.projectId) errors.projectId = '请选择所属项目';
    else if (!state.projects.some(function (p) { return p.id === payload.projectId; })) {
      errors.projectId = '所选项目不存在';
    }
    if (['smooth', 'normal', 'frustrated'].indexOf(payload.mood) === -1) {
      errors.mood = '请选择今日情绪';
    }
    return errors;
  }

  function validateProject(payload, excludeId) {
    var errors = {};
    var name = String(payload.name || '').trim();
    if (!name) errors.name = '项目名称不能为空';
    else if (name.length > 50) errors.name = '项目名称不超过 50 个字符';
    else if (nameExists(name, excludeId)) errors.name = '项目名称已存在，请更换';

    var desc = String(payload.description || '');
    if (desc.length > 2000) errors.description = '项目描述不超过 2000 个字符';

    if (['active', 'completed', 'paused'].indexOf(payload.status) === -1) {
      errors.status = '请选择项目状态';
    }
    return errors;
  }

  function nameExists(name, excludeId) {
    var target = String(name || '').trim().toLowerCase();
    return state.projects.some(function (p) {
      return p.id !== excludeId && String(p.name).trim().toLowerCase() === target;
    });
  }

  /* ------------------------------------------------------------ 修改记录 */
  function buildChanges(before, after) {
    var changes = [];
    TRACKED_FIELDS.forEach(function (field) {
      var a = before[field];
      var b = after[field];
      if (field === 'tags') {
        a = (a || []).join(', ');
        b = (b || []).join(', ');
      }
      if (field === 'content') {
        a = U.clampText(U.htmlToText(a || ''), 60);
        b = U.clampText(U.htmlToText(b || ''), 60);
      }
      if (String(a === undefined ? '' : a) !== String(b === undefined ? '' : b)) {
        changes.push({ field: field, from: a === undefined ? '' : a, to: b === undefined ? '' : b });
      }
    });
    return changes;
  }

  /* =============================================================== ORM 层 */
  var DB = {
    STORAGE_KEY: STORAGE_KEY,

    /* -------------------------------------------------------------- 初始化 */
    init: function () {
      if (state.ready) return Promise.resolve(DB.mode);

      return request('/state').then(function (data) {
        state.mode = 'server';
        state.projects = (data && data.projects) || [];
        state.logs = sortLogs((data && data.logs) || []);
        state.ready = true;
        return DB.mode;
      }).catch(function () {
        /* 后端不可用 —— 降级为本地模式 */
        state.mode = 'local';
        var local = readLocal();
        if (local) {
          state.projects = local.projects || [];
          state.logs = sortLogs(local.logs || []);
        } else {
          seedLocal();
          state.logs = sortLogs(state.logs);
        }
        state.ready = true;
        return DB.mode;
      }).then(function (mode) {
        emit();
        return mode;
      });
    },

    /** 当前存储模式：'server'（JSON 文件） | 'local'（浏览器本地存储） */
    get mode() { return state.mode; },
    get isServer() { return state.mode === 'server'; },

    /** 订阅数据变更，返回取消订阅函数 */
    onChange: function (fn) {
      state.listeners.push(fn);
      return function () {
        state.listeners = state.listeners.filter(function (f) { return f !== fn; });
      };
    },

    /** 导出全部数据（用于备份） */
    exportAll: function () {
      return { version: 1, exportedAt: nowIso(), projects: clone(state.projects), logs: clone(state.logs) };
    },

    /* --------------------------------------------------------------- 项目 */
    getProjects: function () { return state.projects.slice(); },

    getProject: function (id) {
      for (var i = 0; i < state.projects.length; i++) {
        if (state.projects[i].id === id) return state.projects[i];
      }
      return null;
    },

    /** 未归档的项目（新建日志时的下拉选项） */
    getSelectableProjects: function () {
      return state.projects.filter(function (p) { return !p.archived; });
    },

    countLogsOfProject: function (projectId) {
      var n = 0;
      state.logs.forEach(function (l) { if (l.projectId === projectId) n++; });
      return n;
    },

    /** 项目下最近一条日志 */
    latestLogOfProject: function (projectId) {
      var list = state.logs.filter(function (l) { return l.projectId === projectId; });
      return list.length ? list[0] : null;
    },

    createProject: function (payload) {
      var errors = validateProject(payload, null);
      if (Object.keys(errors).length) return Promise.reject({ errors: errors });

      var now = nowIso();
      var project = {
        id: nextId('p'),
        name: String(payload.name).trim(),
        description: String(payload.description || '').trim(),
        status: payload.status,
        archived: !!payload.archived,
        createdAt: now,
        updatedAt: now
      };

      if (state.mode === 'server') {
        return request('/projects', { method: 'POST', body: project }).then(function (saved) {
          state.projects.push(saved);
          emit();
          return saved;
        });
      }
      state.projects.push(project);
      writeLocal();
      emit();
      return Promise.resolve(project);
    },

    updateProject: function (id, payload) {
      var current = DB.getProject(id);
      if (!current) return Promise.reject({ errors: { name: '项目不存在或已被删除' } });

      var errors = validateProject(payload, id);
      if (Object.keys(errors).length) return Promise.reject({ errors: errors });

      var patch = {
        name: String(payload.name).trim(),
        description: String(payload.description || '').trim(),
        status: payload.status,
        archived: payload.archived === undefined ? !!current.archived : !!payload.archived,
        updatedAt: nowIso()
      };

      if (state.mode === 'server') {
        return request('/projects/' + encodeURIComponent(id), { method: 'PUT', body: patch }).then(function (saved) {
          var idx = state.projects.indexOf(current);
          state.projects[idx] = saved;
          emit();
          return saved;
        });
      }
      Object.assign(current, patch);
      writeLocal();
      emit();
      return Promise.resolve(current);
    },

    setProjectArchived: function (id, archived) {
      var current = DB.getProject(id);
      if (!current) return Promise.reject(new Error('项目不存在'));
      return DB.updateProject(id, {
        name: current.name,
        description: current.description,
        status: current.status,
        archived: !!archived
      });
    },

    deleteProject: function (id) {
      var current = DB.getProject(id);
      if (!current) return Promise.reject(new Error('项目不存在'));
      var related = DB.countLogsOfProject(id);

      if (state.mode === 'server') {
        return request('/projects/' + encodeURIComponent(id), { method: 'DELETE' }).then(function () {
          state.projects = state.projects.filter(function (p) { return p.id !== id; });
          emit();
          return { removedLogs: related };
        });
      }
      state.projects = state.projects.filter(function (p) { return p.id !== id; });
      writeLocal();
      emit();
      return Promise.resolve({ removedLogs: related });
    },

    /* --------------------------------------------------------------- 日志 */
    getLogs: function () { return state.logs.slice(); },

    getLog: function (id) {
      for (var i = 0; i < state.logs.length; i++) {
        if (state.logs[i].id === id) return state.logs[i];
      }
      return null;
    },

    logsByDate: function (date) {
      return state.logs.filter(function (l) { return l.date === date; });
    },

    /** 复合筛选：{ startDate, endDate, projectId, keyword, mood } */
    queryLogs: function (filter) {
      var f = filter || {};
      var kw = String(f.keyword || '').trim().toLowerCase();

      return state.logs.filter(function (log) {
        if (f.startDate && log.date < f.startDate) return false;
        if (f.endDate && log.date > f.endDate) return false;
        if (f.projectId && log.projectId !== f.projectId) return false;
        if (f.mood && log.mood !== f.mood) return false;
        if (kw) {
          var haystack = [
            log.title || '',
            U.htmlToText(log.content || ''),
            (log.tags || []).join(' ')
          ].join('\n').toLowerCase();
          if (haystack.indexOf(kw) === -1) return false;
        }
        return true;
      });
    },

    createLog: function (payload) {
      var errors = validateLog(payload, null);
      if (Object.keys(errors).length) return Promise.reject({ errors: errors });

      var now = nowIso();
      var log = {
        id: nextId('l'),
        date: U.formatDate(payload.date),
        title: String(payload.title).trim(),
        content: U.sanitizeHtml(payload.content || ''),
        projectId: payload.projectId,
        mood: payload.mood,
        tags: normalizeTags(payload.tags),
        createdAt: now,
        updatedAt: now,
        history: [{ at: now, action: 'create', changes: [] }]
      };

      if (state.mode === 'server') {
        return request('/logs', { method: 'POST', body: log }).then(function (saved) {
          state.logs.push(saved);
          sortLogs(state.logs);
          emit();
          return saved;
        });
      }
      state.logs.push(log);
      sortLogs(state.logs);
      writeLocal();
      emit();
      return Promise.resolve(log);
    },

    updateLog: function (id, payload) {
      var current = DB.getLog(id);
      if (!current) return Promise.reject({ errors: { title: '日志不存在或已被删除' } });

      var errors = validateLog(payload, id);
      if (Object.keys(errors).length) return Promise.reject({ errors: errors });

      var patch = {
        date: U.formatDate(payload.date),
        title: String(payload.title).trim(),
        content: U.sanitizeHtml(payload.content || ''),
        projectId: payload.projectId,
        mood: payload.mood,
        tags: normalizeTags(payload.tags),
        updatedAt: nowIso()
      };

      /* 记录改动明细，形成修改历史 */
      var changes = buildChanges(current, patch);
      if (changes.length) {
        patch.history = (current.history || []).concat([{
          at: patch.updatedAt,
          action: 'update',
          changes: changes
        }]);
      }

      if (state.mode === 'server') {
        return request('/logs/' + encodeURIComponent(id), { method: 'PUT', body: patch }).then(function (saved) {
          var idx = state.logs.indexOf(current);
          state.logs[idx] = saved;
          sortLogs(state.logs);
          emit();
          return saved;
        });
      }
      Object.assign(current, patch);
      sortLogs(state.logs);
      writeLocal();
      emit();
      return Promise.resolve(current);
    },

    deleteLog: function (id) {
      var current = DB.getLog(id);
      if (!current) return Promise.reject(new Error('日志不存在'));

      if (state.mode === 'server') {
        return request('/logs/' + encodeURIComponent(id), { method: 'DELETE' }).then(function () {
          state.logs = state.logs.filter(function (l) { return l.id !== id; });
          emit();
          return true;
        });
      }
      state.logs = state.logs.filter(function (l) { return l.id !== id; });
      writeLocal();
      emit();
      return Promise.resolve(true);
    },

    /* --------------------------------------------------------------- 统计 */
    stats: function () {
      var monthPrefix = U.today().slice(0, 7);
      var thisMonth = 0;
      state.logs.forEach(function (l) {
        if (String(l.date).slice(0, 7) === monthPrefix) thisMonth++;
      });

      /* 各项目日志占比 */
      var byProject = state.projects.map(function (p) {
        return { id: p.id, name: p.name, status: p.status, archived: p.archived, count: DB.countLogsOfProject(p.id) };
      }).sort(function (a, b) { return b.count - a.count; });

      var orphan = 0;
      state.logs.forEach(function (l) {
        if (!DB.getProject(l.projectId)) orphan++;
      });

      /* 情绪分布 */
      var moods = { smooth: 0, normal: 0, frustrated: 0 };
      state.logs.forEach(function (l) { if (moods[l.mood] !== undefined) moods[l.mood]++; });

      /* 连续记录天数（含今天或昨天起算） */
      var dateSet = {};
      state.logs.forEach(function (l) { dateSet[l.date] = 1; });
      var streak = 0;
      var cursor = new Date();
      if (!dateSet[U.formatDate(cursor)]) cursor.setDate(cursor.getDate() - 1);
      while (dateSet[U.formatDate(cursor)]) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
      }

      var activeProjects = state.projects.filter(function (p) { return p.status === 'active' && !p.archived; }).length;

      return {
        totalLogs: state.logs.length,
        monthLogs: thisMonth,
        totalProjects: state.projects.length,
        activeProjects: activeProjects,
        archivedProjects: state.projects.filter(function (p) { return p.archived; }).length,
        byProject: byProject,
        orphanLogs: orphan,
        moods: moods,
        streak: streak,
        avgPerWeek: (function () {
          if (!state.logs.length) return 0;
          var dates = Object.keys(dateSet).sort();
          var span = Math.max(1, U.daysBetween(dates[0], dates[dates.length - 1]) + 1);
          return Math.round((state.logs.length / span) * 7 * 10) / 10;
        })()
      };
    },

    /* --------------------------------------------------------- 校验接口透出 */
    validateLog: validateLog,
    validateProject: validateProject,
    nameExists: nameExists
  };

  global.DB = DB;
})(window);
