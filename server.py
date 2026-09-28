# -*- coding: utf-8 -*-
"""
============================================================================
 个人工作日志管理系统 —— 后端 API 服务（Python 版）

 双栈自适应，无需任何三方库即可运行：
   1) 若环境中已安装 Flask（pip install flask），自动使用 Flask 提供路由；
   2) 若未安装 Flask，则自动降级为 Python 标准库 wsgiref 实现的 WSGI 服务，
      对外暴露的接口、行为、数据格式完全一致。

 启动：
     python server.py              # 默认 http://localhost:3000
     python server.py 8080         # 指定端口

 数据文件：
     data/projects.json   { version, updatedAt, projects: [] }
     data/logs.json       { version, updatedAt, logs: [] }

 接口一览（与 server.js 完全一致）：
     GET    /api/state                 读取全部数据（项目 + 日志）
     GET    /api/projects              读取项目列表
     POST   /api/projects              新建项目
     GET    /api/projects/<id>         读取单个项目
     PUT    /api/projects/<id>         更新项目
     DELETE /api/projects/<id>         删除项目（不级联删除日志）

     GET    /api/logs                  读取日志列表
     POST   /api/logs                  新建日志
     GET    /api/logs/<id>             读取单条日志
     PUT    /api/logs/<id>             更新日志
     DELETE /api/logs/<id>             删除日志
============================================================================
"""

import json
import os
import re
import sys
import time
import uuid
import threading
import posixpath
import mimetypes
from datetime import datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "data")
LOGS_FILE = os.path.join(DATA_DIR, "logs.json")
PROJECTS_FILE = os.path.join(DATA_DIR, "projects.json")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", 3000))
MAX_BODY = 5 * 1024 * 1024

STATUS_LABEL = {"active": "进行中", "completed": "已完成", "paused": "已搁置"}
MOODS = ("smooth", "normal", "frustrated")
TRACKED_FIELDS = ("date", "title", "content", "projectId", "mood", "tags")

_write_lock = threading.Lock()


# ------------------------------------------------------------------ 工具

def now_iso():
    return datetime.now().astimezone().isoformat(timespec="milliseconds")


def gen_id(prefix):
    return "%s_%s%s" % (prefix, format(int(time.time() * 1000), "x"), uuid.uuid4().hex[:8])


def json_default(o):
    return str(o)


# ------------------------------------------------------------ 数据读写层

def read_store(path, key):
    try:
        with open(path, "r", encoding="utf-8") as f:
            parsed = json.load(f)
        if isinstance(parsed, dict) and isinstance(parsed.get(key), list):
            return parsed
    except FileNotFoundError:
        pass
    except (ValueError, OSError) as e:
        print("[warn] 读取 %s 失败，将重置为空数据：%s" % (os.path.basename(path), e))
    return {"version": 1, "updatedAt": now_iso(), key: []}


def write_store(path, data):
    """原子写入：先写临时文件再替换，避免中途中断导致 JSON 损坏"""
    os.makedirs(DATA_DIR, exist_ok=True)
    payload = dict(data)
    payload["updatedAt"] = now_iso()
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


# -------------------------------------------------------------- 校验逻辑

ALLOWED_TAGS = {
    "b", "strong", "i", "em", "u", "s", "strike", "del",
    "ul", "ol", "li", "p", "br", "div", "span",
    "h3", "h4", "blockquote", "code", "pre",
}

_TAG_RE = re.compile(r"<(\/?)([a-zA-Z0-9]+)([^>]*)>")
_DANGER_BLOCK_RE = re.compile(
    r"<(script|style|iframe|object|embed|link|meta|form|input)\b[^>]*>[\s\S]*?</\1\s*>", re.I)
_DANGER_SELF_RE = re.compile(
    r"<(script|style|iframe|object|embed|link|meta|input)\b[^>]*/?>", re.I)
_BLOCK_END_RE = re.compile(r"</(p|div|li|h3|h4|blockquote|pre)>", re.I)
_BR_RE = re.compile(r"<br\s*/?>", re.I)
_ANY_TAG_RE = re.compile(r"<[^>]*>")
_WS_RE = re.compile(r"[ \t]+")


def sanitize_text(value, max_len=None):
    s = "" if value is None else str(value)
    return s[:max_len] if max_len else s


def escape_html(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def sanitize_html(html):
    """轻量白名单清洗：只保留安全标签，剥离全部属性（与前端保持一致）"""
    raw = "" if html is None else str(html)
    if not re.search(r"<[a-z!/]", raw, re.I):
        return escape_html(raw)

    out = _DANGER_BLOCK_RE.sub("", raw)
    out = _DANGER_SELF_RE.sub("", out)

    def _keep(m):
        slash, tag = m.group(1), m.group(2)
        return "<%s%s>" % (slash, tag.lower()) if tag.lower() in ALLOWED_TAGS else ""

    return _TAG_RE.sub(_keep, out)


def html_to_text(html):
    s = _BLOCK_END_RE.sub("\n", sanitize_html(html))
    s = _BR_RE.sub("\n", s)
    s = _ANY_TAG_RE.sub("", s)
    for a, b in (("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"),
                 ("&gt;", ">"), ("&#39;", "'"), ("&quot;", '"')):
        s = s.replace(a, b)
    return _WS_RE.sub(" ", s).strip()


def normalize_tags(tags):
    out, seen = [], set()
    for t in (tags if isinstance(tags, list) else []):
        v = sanitize_text(t, 20).strip()
        if not v:
            continue
        k = v.lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(v)
    return out[:12]


def validate_log(payload, projects):
    errors = {}
    date = str(payload.get("date") or "")
    title = sanitize_text(payload.get("title"), 200).strip()
    content = sanitize_html(payload.get("content") or "")

    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
        errors["date"] = "日期格式应为 YYYY-MM-DD"
    if not title:
        errors["title"] = "标题不能为空"
    elif len(title) > 80:
        errors["title"] = "标题不超过 80 个字符"
    if not html_to_text(content):
        errors["content"] = "工作内容不能为空"

    pid = payload.get("projectId")
    if not pid:
        errors["projectId"] = "请选择所属项目"
    elif not any(p.get("id") == pid for p in projects):
        errors["projectId"] = "所选项目不存在"

    if payload.get("mood") not in MOODS:
        errors["mood"] = "请选择今日情绪（顺利/一般/受挫）"
    return errors


def validate_project(payload, projects, exclude_id=None):
    errors = {}
    name = sanitize_text(payload.get("name"), 200).strip()
    desc = sanitize_text(payload.get("description"), 4000).strip()

    if not name:
        errors["name"] = "项目名称不能为空"
    elif len(name) > 50:
        errors["name"] = "项目名称不超过 50 个字符"
    elif any(p.get("id") != exclude_id and str(p.get("name", "")).strip().lower() == name.lower()
             for p in projects):
        errors["name"] = "项目名称已存在，请更换"

    if len(desc) > 2000:
        errors["description"] = "项目描述不超过 2000 个字符"
    if payload.get("status") not in STATUS_LABEL:
        errors["status"] = "项目状态不合法"
    return errors


class ApiError(Exception):
    def __init__(self, status, message, errors=None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.errors = errors


# ------------------------------------------------------------ 业务处理函数

def api_get_state():
    return 200, {
        "projects": read_store(PROJECTS_FILE, "projects")["projects"],
        "logs": read_store(LOGS_FILE, "logs")["logs"],
    }


def api_list_projects():
    return 200, read_store(PROJECTS_FILE, "projects")["projects"]


def api_get_project(pid):
    found = next((p for p in read_store(PROJECTS_FILE, "projects")["projects"] if p["id"] == pid), None)
    if not found:
        raise ApiError(404, "项目不存在")
    return 200, found


def api_create_project(payload):
    with _write_lock:
        data = read_store(PROJECTS_FILE, "projects")
        errors = validate_project(payload, data["projects"])
        if errors:
            raise ApiError(422, "校验失败", errors)

        ts = now_iso()
        project = {
            "id": gen_id("p"),
            "name": sanitize_text(payload.get("name"), 50).strip(),
            "description": sanitize_text(payload.get("description"), 2000).strip(),
            "status": payload["status"],
            "archived": bool(payload.get("archived")),
            "createdAt": ts,
            "updatedAt": ts,
        }
        data["projects"].append(project)
        write_store(PROJECTS_FILE, data)
        return 201, project


def api_update_project(pid, payload):
    with _write_lock:
        data = read_store(PROJECTS_FILE, "projects")
        idx = next((i for i, p in enumerate(data["projects"]) if p["id"] == pid), None)
        if idx is None:
            raise ApiError(404, "项目不存在")

        errors = validate_project(payload, data["projects"], exclude_id=pid)
        if errors:
            raise ApiError(422, "校验失败", errors)

        current = data["projects"][idx]
        updated = dict(current)
        updated.update({
            "name": sanitize_text(payload.get("name"), 50).strip(),
            "description": sanitize_text(payload.get("description"), 2000).strip(),
            "status": payload["status"],
            "archived": bool(current.get("archived")) if payload.get("archived") is None
                        else bool(payload.get("archived")),
            "updatedAt": now_iso(),
        })
        data["projects"][idx] = updated
        write_store(PROJECTS_FILE, data)
        return 200, updated


def api_delete_project(pid):
    with _write_lock:
        data = read_store(PROJECTS_FILE, "projects")
        idx = next((i for i, p in enumerate(data["projects"]) if p["id"] == pid), None)
        if idx is None:
            raise ApiError(404, "项目不存在")

        data["projects"].pop(idx)
        write_store(PROJECTS_FILE, data)

        logs = read_store(LOGS_FILE, "logs")["logs"]
        related = sum(1 for l in logs if l.get("projectId") == pid)
        return 200, {"ok": True, "removedLogs": related}


def api_list_logs():
    return 200, read_store(LOGS_FILE, "logs")["logs"]


def api_get_log(lid):
    found = next((l for l in read_store(LOGS_FILE, "logs")["logs"] if l["id"] == lid), None)
    if not found:
        raise ApiError(404, "日志不存在")
    return 200, found


def api_create_log(payload):
    with _write_lock:
        logs_data = read_store(LOGS_FILE, "logs")
        projects = read_store(PROJECTS_FILE, "projects")["projects"]
        errors = validate_log(payload, projects)
        if errors:
            raise ApiError(422, "校验失败", errors)

        ts = now_iso()
        log = {
            "id": gen_id("l"),
            "date": payload["date"],
            "title": sanitize_text(payload.get("title"), 80).strip(),
            "content": sanitize_html(payload.get("content") or ""),
            "projectId": payload["projectId"],
            "mood": payload["mood"],
            "tags": normalize_tags(payload.get("tags")),
            "createdAt": ts,
            "updatedAt": ts,
            "history": [{"at": ts, "action": "create", "changes": []}],
        }
        logs_data["logs"].append(log)
        write_store(LOGS_FILE, logs_data)
        return 201, log


def build_changes(before, after):
    changes = []
    for field in TRACKED_FIELDS:
        a, b = before.get(field), after.get(field)
        if field == "tags":
            a = ", ".join(a or [])
            b = ", ".join(b or [])
        if field == "content":
            a = html_to_text(a or "")[:60]
            b = html_to_text(b or "")[:60]
        if str(a if a is not None else "") != str(b if b is not None else ""):
            changes.append({"field": field,
                            "from": a if a is not None else "",
                            "to": b if b is not None else ""})
    return changes


def api_update_log(lid, payload):
    with _write_lock:
        logs_data = read_store(LOGS_FILE, "logs")
        projects = read_store(PROJECTS_FILE, "projects")["projects"]
        idx = next((i for i, l in enumerate(logs_data["logs"]) if l["id"] == lid), None)
        if idx is None:
            raise ApiError(404, "日志不存在")

        errors = validate_log(payload, projects)
        if errors:
            raise ApiError(422, "校验失败", errors)

        current = logs_data["logs"][idx]
        ts = now_iso()
        updated = dict(current)
        updated.update({
            "date": payload["date"],
            "title": sanitize_text(payload.get("title"), 80).strip(),
            "content": sanitize_html(payload.get("content") or ""),
            "projectId": payload["projectId"],
            "mood": payload["mood"],
            "tags": normalize_tags(payload.get("tags")),
            "updatedAt": ts,
        })

        changes = build_changes(current, updated)
        if changes:
            updated["history"] = list(current.get("history") or []) + [
                {"at": ts, "action": "update", "changes": changes}
            ]
        logs_data["logs"][idx] = updated
        write_store(LOGS_FILE, logs_data)
        return 200, updated


def api_delete_log(lid):
    with _write_lock:
        data = read_store(LOGS_FILE, "logs")
        idx = next((i for i, l in enumerate(data["logs"]) if l["id"] == lid), None)
        if idx is None:
            raise ApiError(404, "日志不存在")
        data["logs"].pop(idx)
        write_store(LOGS_FILE, data)
        return 200, {"ok": True}


# ------------------------------------------------------------------ 路由表
# (method, 路径模板, 处理函数, 是否带请求体)
ROUTES = [
    ("GET",    "/api/state",            lambda body, **kw: api_get_state(),                     False),
    ("GET",    "/api/projects",         lambda body, **kw: api_list_projects(),                 False),
    ("POST",   "/api/projects",         lambda body, **kw: api_create_project(body),            True),
    ("GET",    "/api/projects/{id}",    lambda body, **kw: api_get_project(kw["id"]),           False),
    ("PUT",    "/api/projects/{id}",    lambda body, **kw: api_update_project(kw["id"], body),  True),
    ("DELETE", "/api/projects/{id}",    lambda body, **kw: api_delete_project(kw["id"]),        False),
    ("GET",    "/api/logs",             lambda body, **kw: api_list_logs(),                     False),
    ("POST",   "/api/logs",             lambda body, **kw: api_create_log(body),                True),
    ("GET",    "/api/logs/{id}",        lambda body, **kw: api_get_log(kw["id"]),               False),
    ("PUT",    "/api/logs/{id}",        lambda body, **kw: api_update_log(kw["id"], body),      True),
    ("DELETE", "/api/logs/{id}",        lambda body, **kw: api_delete_log(kw["id"]),            False),
]


def _compile(template):
    pattern = re.sub(r"\{(\w+)\}", r"(?P<\1>[^/]+)", template)
    return re.compile("^%s$" % pattern)


_COMPILED = [(m, _compile(t), fn, need_body) for (m, t, fn, need_body) in ROUTES]


def dispatch(method, path, body_parser):
    """返回 (status, payload)。静态资源请求返回 None 交由外层处理。"""
    if not path.startswith("/api/"):
        return None
    for m, pattern, fn, need_body in _COMPILED:
        if m != method:
            continue
        match = pattern.match(path)
        if not match:
            continue
        body = body_parser() if need_body else {}
        return fn(body, **match.groupdict())
    raise ApiError(404, "接口不存在: %s" % path)


# -------------------------------------------------------------- 静态资源

def resolve_static(path):
    rel = path or "/"
    if rel in ("/", ""):
        rel = "/index.html"
    safe = posixpath.normpath(rel).lstrip("/")
    target = os.path.normpath(os.path.join(ROOT, safe))
    if not target.startswith(ROOT):
        return None
    if os.path.isdir(target):
        target = os.path.join(target, "index.html")
    return target if os.path.isfile(target) else None


def guess_mime(path):
    ext = os.path.splitext(path)[1].lower()
    overrides = {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml",
        ".txt": "text/plain; charset=utf-8",
        ".md": "text/markdown; charset=utf-8",
    }
    if ext in overrides:
        return overrides[ext]
    return mimetypes.guess_type(path)[0] or "application/octet-stream"


# ------------------------------------------------------------------ 入口

def ensure_data_files():
    os.makedirs(DATA_DIR, exist_ok=True)
    for path, key in ((LOGS_FILE, "logs"), (PROJECTS_FILE, "projects")):
        if not os.path.exists(path):
            write_store(path, {"version": 1, "updatedAt": now_iso(), key: []})
            print("[init] 已创建数据文件 %s" % os.path.relpath(path, ROOT))


def print_banner(engine):
    print("")
    print("  个人工作日志管理系统 —— 服务已启动（%s）" % engine)
    print("  ------------------------------------------")
    print("  访问地址 : http://localhost:%d" % PORT)
    print("  数据文件 : data/logs.json / data/projects.json")
    print("  停止服务 : Ctrl + C")
    print("")


# ---- 引擎一：Flask ----
def run_with_flask():
    from flask import Flask, request, Response, send_file

    app = Flask(__name__, static_folder=None)

    @app.after_request
    def _cors(resp):
        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Access-Control-Allow-Methods"] = "GET,POST,PUT,DELETE,OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
        return resp

    def _parse_body():
        if not request.data:
            return {}
        try:
            return json.loads(request.get_data(as_text=True))
        except ValueError:
            raise ApiError(400, "请求体不是合法的 JSON")

    @app.route("/api/<path:_sub>", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])
    def _api(_sub):
        if request.method == "OPTIONS":
            return Response(status=204)
        try:
            result = dispatch(request.method, request.path, _parse_body)
        except ApiError as e:
            payload = {"error": e.message}
            if e.errors:
                payload["errors"] = e.errors
            return Response(json.dumps(payload, ensure_ascii=False),
                            status=e.status, mimetype="application/json")
        except Exception as e:                                  # noqa: BLE001
            print("[error]", e)
            return Response(json.dumps({"error": str(e)}, ensure_ascii=False),
                            status=500, mimetype="application/json")
        status, payload = result
        return Response(json.dumps(payload, ensure_ascii=False, default=json_default),
                        status=status, mimetype="application/json")

    @app.route("/", defaults={"_path": ""})
    @app.route("/<path:_path>")
    def _static(_path):
        target = resolve_static("/" + _path)
        if not target:
            return Response("文件不存在", status=404, mimetype="text/plain; charset=utf-8")
        return send_file(target, mimetype=guess_mime(target))

    print_banner("Flask")
    app.run(host="127.0.0.1", port=PORT, debug=False, threaded=True)


# ---- 引擎二：标准库 wsgiref（零依赖兜底）----
def run_with_stdlib():
    from wsgiref.simple_server import make_server, WSGIRequestHandler

    class QuietHandler(WSGIRequestHandler):
        def log_message(self, fmt, *args):
            pass

    def application(environ, start_response):
        method = environ.get("REQUEST_METHOD", "GET").upper()
        path = environ.get("PATH_INFO", "/")

        def _parse_body():
            try:
                length = int(environ.get("CONTENT_LENGTH") or 0)
            except ValueError:
                length = 0
            raw = environ["wsgi.input"].read(length) if length else b""
            if not raw:
                return {}
            try:
                return json.loads(raw.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                raise ApiError(400, "请求体不是合法的 JSON")

        def respond(status, body, content_type):
            data = body if isinstance(body, bytes) else body.encode("utf-8")
            start_response(status, [
                ("Content-Type", content_type),
                ("Content-Length", str(len(data))),
                ("Cache-Control", "no-cache"),
                ("Access-Control-Allow-Origin", "*"),
                ("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS"),
                ("Access-Control-Allow-Headers", "Content-Type"),
            ])
            return [data]

        if method == "OPTIONS":
            start_response("204 No Content", [("Content-Length", "0")])
            return [b""]

        try:
            result = dispatch(method, path, _parse_body)

            if result is None:                                   # 静态资源
                if method not in ("GET", "HEAD"):
                    return respond("405 Method Not Allowed",
                                   json.dumps({"error": "不支持的方法"}),
                                   "application/json; charset=utf-8")
                target = resolve_static(path)
                if not target:
                    return respond("404 Not Found",
                                   json.dumps({"error": "文件不存在: %s" % path}, ensure_ascii=False),
                                   "application/json; charset=utf-8")
                with open(target, "rb") as f:
                    return respond("200 OK", f.read(), guess_mime(target))

            status, payload = result
            text = json.dumps(payload, ensure_ascii=False, default=json_default)
            reason = {200: "OK", 201: "Created", 404: "Not Found"}.get(status, "OK")
            return respond("%d %s" % (status, reason), text, "application/json; charset=utf-8")

        except ApiError as e:
            payload = {"error": e.message}
            if e.errors:
                payload["errors"] = e.errors
            return respond("%d Error" % e.status,
                           json.dumps(payload, ensure_ascii=False),
                           "application/json; charset=utf-8")
        except Exception as e:                                   # noqa: BLE001
            print("[error]", e)
            return respond("500 Internal Server Error",
                           json.dumps({"error": str(e)}, ensure_ascii=False),
                           "application/json; charset=utf-8")

    print_banner("Python 标准库 wsgiref，零依赖")
    with make_server("127.0.0.1", PORT, application, handler_class=QuietHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n服务已停止。")


def main():
    ensure_data_files()
    try:
        import flask  # noqa: F401
        has_flask = True
    except ImportError:
        has_flask = False

    try:
        if has_flask:
            run_with_flask()
        else:
            print("[info] 未检测到 Flask，已自动使用标准库 wsgiref 启动（功能完全一致）")
            print("[info] 如需使用 Flask：pip install flask")
            run_with_stdlib()
    except OSError as e:
        print("\n[错误] 启动失败：%s" % e)
        print("[提示] 端口 %d 可能已被占用，可换端口：python server.py 3001\n" % PORT)
        sys.exit(1)


if __name__ == "__main__":
    main()
