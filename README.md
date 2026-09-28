# 个人工作日志管理系统

> 一款跑在自己电脑上的个人工作日志系统 —— 日志记录、项目管理、数据看板三合一，零依赖、零构建、开箱即用。

***

一个自托管的个人工作日志系统。用原生 HTML5 + CSS3 + JavaScript 写成 —— 没有框架、没有构建步骤、没有 `npm install`。

它帮你把每天的工作沉淀下来：记录日志（富文本正文、项目归属、情绪标记、待办标签，并自动留存每次修改的字段级明细），按状态管理项目，再通过指标卡、项目占比环形图和交互式日历回顾自己的工作节奏。

数据以纯文本 JSON 存放在本地 —— 可读、可 diff、可直接备份。配一个零依赖的后端，数据就落成两个 JSON 文件。

## 目录

- [功能特性](#功能特性)
- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [数据存储](#数据存储)
- [后端 API](#后端-api)
- [使用要点](#使用要点)
- [常见问题](#常见问题)
- [技术栈](#技术栈)
- [许可证](#许可证)
- [English](#english)

## 功能特性

### 日志记录

- **完整字段**：日期（默认今天，可手动选择）、标题、工作内容、项目分类、今日情绪（顺利 / 一般 / 受挫）、待办标签
- **富文本编辑器**：加粗、斜体、下划线、无序 / 有序列表、引用、清除格式
- **多标签**：可添加多个待办标签（最多 12 个，单个不超过 20 字），支持逐个删除
- **修改历史**：每次编辑自动记录字段级变更（旧值 → 新值 + 时间），形成可回看的时间线，不可被篡改
- **搜索与筛选**：按日期范围、项目分类、情绪组合筛选，并对标题 / 正文 / 标签做关键词全文检索，命中文字高亮
- **删除保护**：删除前二次确认

### 项目管理

- **基本信息**：项目名称（1–50 字符，全局唯一）、项目描述（0–2000 字符）、项目状态（进行中 / 已完成 / 已搁置）
- **归档**：归档后不再出现在新建日志的项目下拉列表中，但历史日志与项目信息完整保留，可随时取消归档
- **概览视图**：按状态分组展示项目卡片，每张卡片显示项目名称、状态标签、日志数量、最近更新时间与最近日志预览
- **双向联动**：从日志可跳转到所属项目（自动滚动并高亮目标卡片），从项目卡片可直接打开最近一条日志

### 数据看板

- **关键指标**：总日志记录数、本月新增、进行中项目、连续记录天数
- **项目日志占比**：纯 SVG 手工绘制的环形图 + 交互式图例，点击图例可下钻到该项目日志列表
- **记录节奏**：今日情绪分布、项目投入 TOP 5，点击任一项跳转对应筛选
- **交互式日历**：有记录的日期高亮并显示条数与情绪圆点；点击有记录的日期就地展开当天日志列表，点击空白日期直接发起当天日志创建
- **最近日志**：快速回看最近 6 条记录

### 工程与体验

- **双模式存储**：自动探测后端，探测不到时无感降级为浏览器本地存储，不会白屏报错
- **安全**：前后端各自独立执行 HTML 白名单消毒，双重防 XSS；静态资源服务做了目录穿越防护
- **数据完整性**：后端写入采用「临时文件 + 原子重命名」并通过队列串行化，断电不会产生半截 JSON
- **界面**：深色科幻风格，玻璃拟态面板 + 霓虹光效；全响应式布局；尊重系统「减少动态效果」设置；自带打印样式

## 快速开始

### 环境要求

| 方式         | 要求             |
| ---------- | -------------- |
| Node.js 后端 | Node.js 14 及以上 |
| Python 后端  | Python 3.6 及以上 |
| 纯前端        | 任意现代浏览器        |

**两种后端都不需要安装任何三方依赖。**

### 方式一：Node.js 后端（推荐）

```bash
node server.js
```

```
  个人工作日志管理系统 —— 服务已启动
  ------------------------------------------
  访问地址 : http://localhost:3000
  数据文件 : data\logs.json / data\projects.json
  停止服务 : Ctrl + C
```

浏览器打开 <http://localhost:3000> 即可。指定端口用 `node server.js 8080`。

### 方式二：Python 后端

```bash
python server.py
```

`server.py` 会自动选择引擎：装了 Flask 就用 Flask，没装就自动降级为 Python 标准库 `wsgiref`，**对外接口与行为完全一致**。因此无需 `pip install` 也能跑。

指定端口用 `python server.py 8080`。

### 方式三：不启动后端

直接双击 `index.html`（或拖进浏览器）即可使用。此时处于**本地存储模式**，数据保存在浏览器 `localStorage` 中。

> ⚠️ 本地存储模式的数据绑定在「浏览器 + 文件路径」上。换浏览器、清理浏览器数据、移动文件夹都会导致读不到原有数据。需要长期保存请用方式一或方式二。

### 首次使用

系统默认是空数据状态，按下面的顺序开始：

1. 进入「项目管理」，创建第一个项目
2. 点击右上角「新建日志」开始记录
3. 回到「数据看板」查看自动统计的图表与日历标记

> 每条日志都必须归属到某个项目，所以需要先建项目。如果没建项目就点「新建日志」，表单会提示「请先到项目管理创建项目」并禁用保存按钮。

## 项目结构

```
.
├── index.html              单页应用入口（唯一页面）
├── css/
│   └── style.css           设计系统：全部样式、动画与响应式规则
├── js/
│   ├── utils.js            工具库：日期处理、HTML 消毒、图标、轻提示
│   ├── seed-data.js        初始数据种子（本地存储模式用，当前为空）
│   ├── data.js             数据层：server / local 双模式自动切换
│   ├── app.js              主框架：哈希路由、模态框系统、确认框
│   └── views/
│       ├── dashboard.js    数据看板：指标卡、环形图、日历
│       ├── logs.js         工作日志：筛选、列表、表单、详情、修改历史
│       └── projects.js     项目管理：分组概览、表单、归档、删除
├── data/                   数据目录（首次启动自动创建，不纳入版本控制）
│   ├── logs.json
│   └── projects.json
├── server.js               Node.js 后端（零依赖）
└── server.py               Python 后端（Flask / 标准库双引擎自适应）
```

### 架构说明

前端刻意**不使用** ES Module 与打包工具，全部通过 `<script>` 顺序加载，因此可以直接以 `file://` 协议打开，不受浏览器跨域限制影响。

数据层集中在 `js/data.js` 一个抽象里，视图层只调用 `DB.*` 接口，因此存储后端对上层完全透明 —— 这也是从 JSON 换成 SQLite 或其他存储时前端几乎无需改动的原因。

## 数据存储

### 两种模式

| 模式            | 触发条件                            | 数据位置                                      | 适用场景                    |
| ------------- | ------------------------------- | ----------------------------------------- | ----------------------- |
| **JSON 文件模式** | 通过 `server.js` / `server.py` 启动 | 项目内 `data/logs.json`、`data/projects.json` | 长期使用、需要备份与迁移            |
| **本地存储模式**    | 直接打开 `index.html`               | 浏览器 `localStorage`（key：`pwls:data:v1`）    | 临时体验、无 Node / Python 环境 |

页面右上角的徽章会显示当前模式：绿色「JSON 文件模式」或黄色「本地存储模式」。

### 数据结构

`data/projects.json`

```json
{
  "version": 1,
  "updatedAt": "2026-01-01T00:00:00.000Z",
  "projects": [
    {
      "id": "p_example01",
      "name": "示例项目",
      "description": "项目背景、目标与范围",
      "status": "active",
      "archived": false,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

`data/logs.json`

```json
{
  "version": 1,
  "updatedAt": "2026-01-01T00:00:00.000Z",
  "logs": [
    {
      "id": "l_example01",
      "date": "2026-01-01",
      "title": "日志标题",
      "content": "<p>富文本正文</p>",
      "projectId": "p_example01",
      "mood": "smooth",
      "tags": ["标签一", "标签二"],
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z",
      "history": [
        { "at": "2026-01-01T00:00:00.000Z", "action": "create", "changes": [] },
        {
          "at": "2026-01-01T01:00:00.000Z",
          "action": "update",
          "changes": [{ "field": "mood", "from": "normal", "to": "smooth" }]
        }
      ]
    }
  ]
}
```

字段说明：

| 字段          | 类型        | 说明                                                                                    |
| ----------- | --------- | ------------------------------------------------------------------------------------- |
| `id`        | string    | 唯一标识，由系统生成，不建议手工修改                                                                    |
| `date`      | string    | `YYYY-MM-DD`                                                                          |
| `content`   | string    | 富文本 HTML，仅保留安全标签（`p` / `b` / `i` / `u` / `ul` / `ol` / `li` / `blockquote` 等），所有属性被剥离 |
| `projectId` | string    | 关联项目 `id`；对应项目被删除后该日志变为「未关联」                                                          |
| `mood`      | string    | `smooth` / `normal` / `frustrated`                                                    |
| `tags`      | string\[] | 标签数组，最多 12 个                                                                          |
| `history`   | array     | 修改记录，`action` 为 `create` 或 `update`                                                   |

### 备份与迁移

- **备份**：停止服务，复制整个 `data` 文件夹
- **恢复**：把 `logs.json`、`projects.json` 覆盖回 `data` 目录，重启服务
- **换机器**：复制整个项目文件夹（含 `data`）到新机器，重新启动服务

### 关于版本控制（重要）

`data/` 里是你真实的个人工作内容。**发布或推送到公开仓库前，务必把它排除掉**，否则个人数据会永久留在 Git 历史中（删文件也没用，历史提交仍可查到）。

在仓库根目录新建 `.gitignore`：

```gitignore
# 个人数据，不入库（首次启动会自动重建）
data/*.json
!data/.gitkeep

# 运行时产物
__pycache__/
*.pyc
*.tmp
```

再建一个空的 `data/.gitkeep` 占位，保证目录结构被保留。

## 后端 API

基础地址：`http://localhost:3000/api`

| 方法     | 路径                  | 说明                             | 成功状态码 |
| ------ | ------------------- | ------------------------------ | ----- |
| GET    | `/api/state`        | 一次性读取全部数据 `{ projects, logs }` | 200   |
| GET    | `/api/projects`     | 读取项目列表                         | 200   |
| POST   | `/api/projects`     | 新建项目                           | 201   |
| GET    | `/api/projects/:id` | 读取单个项目                         | 200   |
| PUT    | `/api/projects/:id` | 更新项目                           | 200   |
| DELETE | `/api/projects/:id` | 删除项目（不级联删除日志）                  | 200   |
| GET    | `/api/logs`         | 读取日志列表                         | 200   |
| POST   | `/api/logs`         | 新建日志                           | 201   |
| GET    | `/api/logs/:id`     | 读取单条日志                         | 200   |
| PUT    | `/api/logs/:id`     | 更新日志                           | 200   |
| DELETE | `/api/logs/:id`     | 删除日志                           | 200   |

请求示例：

```bash
curl -X POST http://localhost:3000/api/logs \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-01-01","title":"接口测试","content":"<p>内容</p>","projectId":"p_example01","mood":"smooth","tags":["测试"]}'
```

字段校验失败返回 `422` 与逐字段中文提示：

```json
{
  "error": "校验失败",
  "errors": {
    "title": "标题不能为空",
    "mood": "请选择今日情绪（顺利/一般/受挫）"
  }
}
```

> 服务端会独立做一遍字段校验与 HTML 白名单清洗，因此即使绕过前端直接调用接口，也无法写入非法数据或注入脚本。

## 使用要点

- **修改历史**：在日志详情或列表点击时钟图标，可查看历次编辑的字段级差异
- **日历**：点击有记录的日期就地展开当天日志（不会跳回页面顶部）；点击空白日期直接创建当天日志
- **筛选条件会同步到地址栏**，可直接把链接存为书签
- **标签即入口**：点击日志卡片上的任一标签，即可按该标签快速筛选
- **删除项目不会删除日志**：相关日志会变为「未关联」状态，重新指定项目即可恢复关联

## 常见问题

**Q：双击** **`index.html`** **打开后数据会丢吗？**
不会，会降级为本地存储模式并写入 `localStorage`，刷新和重开都还在。但换浏览器或清理浏览器数据会丢失，长期使用请启动后端。

**Q：提示「未检测到后端服务，已切换到浏览器本地存储模式」？**
说明是以 `file://` 打开、或后端没启动。执行 `node server.js` 后改用 <http://localhost:3000> 访问。

**Q：`node server.js`** **报端口被占用？**
换端口：`node server.js 3001`。

**Q：没有 Node 环境？**
改用 Python：`python server.py`，无需安装任何三方库。

**Q：已有的日志 / 项目不见了？**

1. 看右上角徽章是不是从「JSON 文件模式」变成了「本地存储模式」（说明后端没连上，例如 URL 换了）
2. 检查 `data/logs.json`、`data/projects.json` 是否还在、内容是否正常
3. 本地存储模式下，检查是否换了浏览器或用了无痕窗口

**Q：粘贴进来的图片 / 表格为什么没保存？**
出于安全考虑，工作内容只保留纯文本样式标签（加粗、斜体、下划线、列表、引用、段落），会剥离图片、表格、脚本、样式等标签及全部内联属性。这是有意设计。

**Q：能多台电脑同时编辑吗？**
当前设计为单机单用户。多个窗口同时写入时，后端有写入队列与原子写入保护不会损坏文件，但后写入的会覆盖先写入的，不建议多人同时使用。

**Q：想清空所有数据重新开始？**
停止服务，删除 `data/` 文件夹（或把两个 JSON 文件都改成 `{ "version": 1, "updatedAt": "", "logs": [] }`），重启服务并刷新浏览器即可。注意：删完必须刷新页面，否则内存里的旧数据会被写回文件。

**Q：浏览器缓存了旧版页面？**
后端已对静态资源设置 `Cache-Control: no-cache`，一般刷新即可；必要时用 `Ctrl + F5` 强制刷新。

## 技术栈

- **前端**：原生 HTML5 + CSS3 + JavaScript，零框架、零构建、零外部 CDN
- **后端**：Node.js 内置模块（`http` / `fs` / `path` / `url`），或 Python（Flask / 标准库 `wsgiref`）
- **存储**：本地 JSON 文件；无后端时降级为浏览器 `localStorage`
- **视觉**：CSS 变量驱动的设计令牌，玻璃拟态面板 + 霓虹光效 + 网格背景
- **适配**：桌面端优先，向下适配平板与手机；支持 `prefers-reduced-motion` 与打印样式
- **安全**：前端 `DOMParser` 白名单消毒 + 后端独立二次消毒；静态资源目录穿越防护

### 浏览器支持

Chrome / Edge 90+、Firefox 88+、Safari 14+。

依赖 `fetch`、`Promise`、CSS 自定义属性、`backdrop-filter`，均为现代浏览器标准能力。

## 许可证

本项目基于 [MIT License](LICENSE) 开源。

你可以自由使用、修改、分发本项目，包括用于商业目的，只需在副本或实质性部分中保留原始版权声明与许可声明。软件按「原样」提供，不附带任何形式的担保。

```
Copyright (c) 2026 fuchenboat
```

## English

A self-hosted personal work log for your own machine. Built with vanilla HTML5, CSS3 and JavaScript — no framework, no build step, no `npm install`. Just open `index.html` and start writing.

It captures your daily work: rich-text entries tied to projects, with mood markers, todo tags, and an automatic field-level change history. Projects are tracked by status, and a dashboard turns it all into metric cards, a project-share donut chart, and an interactive calendar.

Data lives in plain-text JSON on your disk — readable, diffable, easy to back up. A zero-dependency backend persists it as two JSON files; without it, the app degrades gracefully to browser local storage.

```bash
node server.js      # Node.js 14+  →  http://localhost:3000
python server.py    # Python 3.6+  →  http://localhost:3000
```

Both backends need **zero third-party dependencies**.
