/**
 * ============================================================================
 * 个人工作日志管理系统 —— 后端 API 服务（Node.js 零依赖版）
 *
 * 特点：仅使用 Node 内置模块（http / fs / path / url），无需 npm install，
 *       启动后既提供静态页面，也提供 JSON 文件的读写接口。
 *
 * 启动：
 *     node server.js            # 默认 http://localhost:3000
 *     node server.js 8080       # 指定端口
 *     set PORT=8080 && node server.js   # Windows 环境变量方式
 *
 * 数据文件：
 *     data/projects.json   { version, updatedAt, projects: [] }
 *     data/logs.json       { version, updatedAt, logs: [] }
 *
 * 接口一览：
 *     GET    /api/state                 读取全部数据（项目 + 日志）
 *     GET    /api/projects              读取项目列表
 *     POST   /api/projects              新建项目
 *     PUT    /api/projects/:id          更新项目
 *     DELETE /api/projects/:id          删除项目（不级联删除日志）
 *     GET    /api/logs                  读取日志列表
 *     POST   /api/logs                  新建日志
 *     PUT    /api/logs/:id              更新日志
 *     DELETE /api/logs/:id              删除日志
 *
 * 写入采用「临时文件 + 原子重命名」，并通过 Promise 队列串行化，
 * 避免并发写导致 JSON 文件损坏。
 * ============================================================================
 */
'use strict';

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const url = require('url');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
const PORT = Number(process.argv[2] || process.env.PORT || 3000);
const MAX_BODY = 5 * 1024 * 1024; // 5MB，富文本日志足够用

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

const STATUS_LABEL = { active: '进行中', completed: '已完成', paused: '已搁置' };
const MOODS = ['smooth', 'normal', 'frustrated'];

/* ------------------------------------------------------------------ 工具 */

function nowIso() { return new Date().toISOString(); }

function genId(prefix) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${prefix}_${Date.now().toString(36)}${out}`;
}

/** 统一响应 */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendError(res, status, message, extra) {
  sendJson(res, status, Object.assign({ error: message }, extra || {}));
}

/** 读取请求体并解析 JSON */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('请求体过大'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(Object.assign(new Error('请求体不是合法的 JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/* ------------------------------------------------------------ 数据读写层 */

/** 写队列：保证同一时刻只有一个写操作，避免文件交错损坏 */
let writeChain = Promise.resolve();

function enqueue(task) {
  const next = writeChain.then(task, task);
  writeChain = next.catch(() => {});   // 防止一次失败阻断后续写入
  return next;
}

async function readStore(file, key) {
  try {
    const raw = await fsp.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed[key])) return parsed;
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.error(`[warn] 读取 ${path.basename(file)} 失败，将重置为空数据：${e.message}`);
    }
  }
  return { version: 1, updatedAt: nowIso(), [key]: [] };
}

/** 原子写入：先写 .tmp 再 rename，避免中途崩溃导致文件损坏 */
async function writeStore(file, data) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${file}.tmp`;
  const payload = JSON.stringify(Object.assign({}, data, { updatedAt: nowIso() }), null, 2) + '\n';
  await fsp.writeFile(tmp, payload, 'utf8');
  await fsp.rename(tmp, file);
}

/* -------------------------------------------------------------- 校验逻辑 */

function sanitizeText(value, max) {
  const str = String(value === null || value === undefined ? '' : value);
  return max ? str.slice(0, max) : str;
}

/** 轻量 HTML 白名单清洗（服务端兜底，与前端保持一致的标签集合） */
const ALLOWED_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del',
  'ul', 'ol', 'li', 'p', 'br', 'div', 'span', 'h3', 'h4', 'blockquote', 'code', 'pre']);

function sanitizeHtml(html) {
  const raw = String(html === null || html === undefined ? '' : html);
  if (!/<[a-z!/]/i.test(raw)) return raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // 去掉脚本/样式等危险块及其内容
  let out = raw.replace(/<(script|style|iframe|object|embed|link|meta|form|input)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  out = out.replace(/<(script|style|iframe|object|embed|link|meta|input)\b[^>]*\/?>/gi, '');
  // 逐标签保留白名单，剥离全部属性
  out = out.replace(/<(\/?)([a-zA-Z0-9]+)([^>]*)>/g, (match, slash, tag) => {
    if (!ALLOWED_TAGS.has(tag.toLowerCase())) return '';
    return `<${slash}${tag.toLowerCase()}>`;
  });
  return out;
}

function htmlToText(html) {
  return sanitizeHtml(html)
    .replace(/<\/(p|div|li|h3|h4|blockquote|pre)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function normalizeTags(tags) {
  const list = [];
  const seen = new Set();
  (Array.isArray(tags) ? tags : []).forEach((t) => {
    let v = sanitizeText(t, 20).trim();
    if (!v) return;
    const key = v.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    list.push(v);
  });
  return list.slice(0, 12);
}

function isDateString(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')); }

function validateLog(payload, projects, excludeId) {
  const errors = {};
  const date = String(payload.date || '');
  const title = sanitizeText(payload.title, 200).trim();
  const content = sanitizeHtml(payload.content || '');
  const text = htmlToText(content);

  if (!date || !isDateString(date)) errors.date = '日期格式应为 YYYY-MM-DD';
  if (!title) errors.title = '标题不能为空';
  else if (title.length > 80) errors.title = '标题不超过 80 个字符';
  if (!text) errors.content = '工作内容不能为空';
  if (!payload.projectId) errors.projectId = '请选择所属项目';
  else if (!projects.some((p) => p.id === payload.projectId)) errors.projectId = '所选项目不存在';
  if (MOODS.indexOf(payload.mood) === -1) errors.mood = '请选择今日情绪（顺利/一般/受挫）';
  return errors;
}

function validateProject(payload, projects, excludeId) {
  const errors = {};
  const name = sanitizeText(payload.name, 200).trim();
  const description = sanitizeText(payload.description, 4000).trim();

  if (!name) errors.name = '项目名称不能为空';
  else if (name.length > 50) errors.name = '项目名称不超过 50 个字符';
  else if (projects.some((p) => p.id !== excludeId && p.name.trim().toLowerCase() === name.toLowerCase())) {
    errors.name = '项目名称已存在，请更换';
  }
  if (description.length > 2000) errors.description = '项目描述不超过 2000 个字符';
  if (!STATUS_LABEL[payload.status]) errors.status = '项目状态不合法';
  return errors;
}

function hasErrors(errors) { return Object.keys(errors).length > 0; }

/* ------------------------------------------------------------ 业务处理函数 */

async function getState() {
  const [logsData, projectsData] = await Promise.all([
    readStore(LOGS_FILE, 'logs'),
    readStore(PROJECTS_FILE, 'projects')
  ]);
  return { projects: projectsData.projects, logs: logsData.logs };
}

/** POST /api/projects */
function createProject(payload) {
  return enqueue(async () => {
    const data = await readStore(PROJECTS_FILE, 'projects');
    const errors = validateProject(payload, data.projects, null);
    if (hasErrors(errors)) throw Object.assign(new Error('校验失败'), { status: 422, errors });

    const ts = nowIso();
    const project = {
      id: genId('p'),
      name: sanitizeText(payload.name, 50).trim(),
      description: sanitizeText(payload.description, 2000).trim(),
      status: payload.status,
      archived: !!payload.archived,
      createdAt: ts,
      updatedAt: ts
    };
    data.projects.push(project);
    await writeStore(PROJECTS_FILE, data);
    return project;
  });
}

/** PUT /api/projects/:id */
function updateProject(id, payload) {
  return enqueue(async () => {
    const data = await readStore(PROJECTS_FILE, 'projects');
    const idx = data.projects.findIndex((p) => p.id === id);
    if (idx === -1) throw Object.assign(new Error('项目不存在'), { status: 404 });

    const errors = validateProject(payload, data.projects, id);
    if (hasErrors(errors)) throw Object.assign(new Error('校验失败'), { status: 422, errors });

    const current = data.projects[idx];
    const updated = Object.assign({}, current, {
      name: sanitizeText(payload.name, 50).trim(),
      description: sanitizeText(payload.description, 2000).trim(),
      status: payload.status,
      archived: payload.archived === undefined ? !!current.archived : !!payload.archived,
      updatedAt: nowIso()
    });
    data.projects[idx] = updated;
    await writeStore(PROJECTS_FILE, data);
    return updated;
  });
}

/** DELETE /api/projects/:id —— 不级联删除日志，日志变为「未关联」 */
function deleteProject(id) {
  return enqueue(async () => {
    const data = await readStore(PROJECTS_FILE, 'projects');
    const idx = data.projects.findIndex((p) => p.id === id);
    if (idx === -1) throw Object.assign(new Error('项目不存在'), { status: 404 });

    data.projects.splice(idx, 1);
    await writeStore(PROJECTS_FILE, data);

    const logsData = await readStore(LOGS_FILE, 'logs');
    const related = logsData.logs.filter((l) => l.projectId === id).length;
    return { ok: true, removedLogs: related };
  });
}

/** POST /api/logs */
function createLog(payload) {
  return enqueue(async () => {
    const [logsData, projectsData] = await Promise.all([
      readStore(LOGS_FILE, 'logs'),
      readStore(PROJECTS_FILE, 'projects')
    ]);
    const errors = validateLog(payload, projectsData.projects, null);
    if (hasErrors(errors)) throw Object.assign(new Error('校验失败'), { status: 422, errors });

    const ts = nowIso();
    const log = {
      id: genId('l'),
      date: payload.date,
      title: sanitizeText(payload.title, 80).trim(),
      content: sanitizeHtml(payload.content || ''),
      projectId: payload.projectId,
      mood: payload.mood,
      tags: normalizeTags(payload.tags),
      createdAt: ts,
      updatedAt: ts,
      history: [{ at: ts, action: 'create', changes: [] }]
    };
    logsData.logs.push(log);
    await writeStore(LOGS_FILE, logsData);
    return log;
  });
}

/** PUT /api/logs/:id —— 由服务端统一生成修改记录，避免被篡改 */
const TRACKED_FIELDS = ['date', 'title', 'content', 'projectId', 'mood', 'tags'];

function buildChanges(before, after) {
  const changes = [];
  TRACKED_FIELDS.forEach((field) => {
    let a = before[field];
    let b = after[field];
    if (field === 'tags') { a = (a || []).join(', '); b = (b || []).join(', '); }
    if (field === 'content') { a = htmlToText(a || '').slice(0, 60); b = htmlToText(b || '').slice(0, 60); }
    if (String(a === undefined ? '' : a) !== String(b === undefined ? '' : b)) {
      changes.push({ field, from: a === undefined ? '' : a, to: b === undefined ? '' : b });
    }
  });
  return changes;
}

function updateLog(id, payload) {
  return enqueue(async () => {
    const [logsData, projectsData] = await Promise.all([
      readStore(LOGS_FILE, 'logs'),
      readStore(PROJECTS_FILE, 'projects')
    ]);
    const idx = logsData.logs.findIndex((l) => l.id === id);
    if (idx === -1) throw Object.assign(new Error('日志不存在'), { status: 404 });

    const errors = validateLog(payload, projectsData.projects, id);
    if (hasErrors(errors)) throw Object.assign(new Error('校验失败'), { status: 422, errors });

    const current = logsData.logs[idx];
    const ts = nowIso();
    const updated = Object.assign({}, current, {
      date: payload.date,
      title: sanitizeText(payload.title, 80).trim(),
      content: sanitizeHtml(payload.content || ''),
      projectId: payload.projectId,
      mood: payload.mood,
      tags: normalizeTags(payload.tags),
      updatedAt: ts
    });

    const changes = buildChanges(current, updated);
    if (changes.length) {
      updated.history = (current.history || []).concat([{ at: ts, action: 'update', changes }]);
    }
    logsData.logs[idx] = updated;
    await writeStore(LOGS_FILE, logsData);
    return updated;
  });
}

/** DELETE /api/logs/:id */
function deleteLog(id) {
  return enqueue(async () => {
    const data = await readStore(LOGS_FILE, 'logs');
    const idx = data.logs.findIndex((l) => l.id === id);
    if (idx === -1) throw Object.assign(new Error('日志不存在'), { status: 404 });
    data.logs.splice(idx, 1);
    await writeStore(LOGS_FILE, data);
    return { ok: true };
  });
}

/* -------------------------------------------------------------- 静态文件 */

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';

  // 防目录穿越
  const target = path.normalize(path.join(ROOT, rel));
  if (!target.startsWith(ROOT)) return sendError(res, 403, '禁止访问');

  let stat;
  try {
    stat = await fsp.stat(target);
  } catch (e) {
    return sendError(res, 404, '文件不存在: ' + rel);
  }
  if (stat.isDirectory()) {
    return serveStatic(req, res, path.posix.join(rel, 'index.html'));
  }

  const ext = path.extname(target).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache'
  });
  fs.createReadStream(target).pipe(res);
}

/* ------------------------------------------------------------------ 路由 */

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || '/';
  const method = req.method.toUpperCase();

  // 允许本地调试时跨端口访问
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (pathname.indexOf('/api/') !== 0) {
    if (method !== 'GET' && method !== 'HEAD') return sendError(res, 405, '不支持的方法');
    return serveStatic(req, res, pathname);
  }

  try {
    // GET /api/state
    if (pathname === '/api/state' && method === 'GET') {
      return sendJson(res, 200, await getState());
    }

    // /api/projects
    if (pathname === '/api/projects') {
      if (method === 'GET') return sendJson(res, 200, (await readStore(PROJECTS_FILE, 'projects')).projects);
      if (method === 'POST') return sendJson(res, 201, await createProject(await readJsonBody(req)));
      return sendError(res, 405, '不支持的方法');
    }

    // /api/logs
    if (pathname === '/api/logs') {
      if (method === 'GET') return sendJson(res, 200, (await readStore(LOGS_FILE, 'logs')).logs);
      if (method === 'POST') return sendJson(res, 201, await createLog(await readJsonBody(req)));
      return sendError(res, 405, '不支持的方法');
    }

    // /api/projects/:id
    let m = /^\/api\/projects\/([^/]+)$/.exec(pathname);
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (method === 'GET') {
        const found = (await readStore(PROJECTS_FILE, 'projects')).projects.find((p) => p.id === id);
        return found ? sendJson(res, 200, found) : sendError(res, 404, '项目不存在');
      }
      if (method === 'PUT') return sendJson(res, 200, await updateProject(id, await readJsonBody(req)));
      if (method === 'DELETE') return sendJson(res, 200, await deleteProject(id));
      return sendError(res, 405, '不支持的方法');
    }

    // /api/logs/:id
    m = /^\/api\/logs\/([^/]+)$/.exec(pathname);
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (method === 'GET') {
        const found = (await readStore(LOGS_FILE, 'logs')).logs.find((l) => l.id === id);
        return found ? sendJson(res, 200, found) : sendError(res, 404, '日志不存在');
      }
      if (method === 'PUT') return sendJson(res, 200, await updateLog(id, await readJsonBody(req)));
      if (method === 'DELETE') return sendJson(res, 200, await deleteLog(id));
      return sendError(res, 405, '不支持的方法');
    }

    return sendError(res, 404, '接口不存在: ' + pathname);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[error]', err);
    return sendError(res, status, err.message || '服务器内部错误', err.errors ? { errors: err.errors } : null);
  }
});

/* ------------------------------------------------------------------ 启动 */

(async function bootstrap() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  for (const [file, key] of [[LOGS_FILE, 'logs'], [PROJECTS_FILE, 'projects']]) {
    try {
      await fsp.access(file);
    } catch (e) {
      await writeStore(file, { version: 1, updatedAt: nowIso(), [key]: [] });
      console.log(`[init] 已创建数据文件 ${path.relative(ROOT, file)}`);
    }
  }

  server.listen(PORT, () => {
    console.log('');
    console.log('  个人工作日志管理系统 —— 服务已启动');
    console.log('  ------------------------------------------');
    console.log(`  访问地址 : http://localhost:${PORT}`);
    console.log(`  数据文件 : ${path.relative(ROOT, LOGS_FILE)} / ${path.relative(ROOT, PROJECTS_FILE)}`);
    console.log('  停止服务 : Ctrl + C');
    console.log('');
  });
})();

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[错误] 端口 ${PORT} 已被占用，请换一个端口：node server.js 3001\n`);
  } else {
    console.error('\n[错误]', err.message, '\n');
  }
  process.exit(1);
});
