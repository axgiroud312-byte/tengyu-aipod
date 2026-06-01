# Spec 08 — 服务端与 Admin 后台

> 当前版本：v1
> 最后更新：2026-05-31

## 1. 职责边界

服务端是轻配置中心，不参与用户业务计算。

服务端负责：

- Admin 登录与后台页面
- 客户记录管理
- Skill 系统提示词管理与客户端派发
- 公告与客户端版本信息
- 健康检查

服务端不负责：

- 客户端授权拦截
- 生图、LLM、PS、采集、上架代理
- 用户图片、API Key、任务记录、标题文件、Workflow 文件存储
- Provider / 模型清单 / ComfyUI Workflow 云端管理

## 2. 本地开发

开发环境固定监听：

```bash
pnpm -F @tengyu-aipod/server dev
```

默认地址：

```text
http://127.0.0.1:3100
```

数据库：

```bash
docker compose -f docker-compose.dev.yml up -d
pnpm -F @tengyu-aipod/server exec prisma db push
```

健康检查：

```http
GET /api/health
```

返回 `{ ok: true, db_ok: true }` 表示服务端和数据库可用。

## 3. 数据模型

当前 Prisma schema 保留这些服务端模型：

| Model | 用途 |
|---|---|
| `Customer` | 客户记录：姓名、手机号、微信、邮箱、备注、封号状态 |
| `Skill` | 云端 Skill 系统提示词，按 `id + version` 版本化 |
| `Announcement` | 公告 |
| `ClientVersion` | 客户端版本信息 |
| `Admin` | Admin 后台账号 |
| `TelemetryError` | 可选错误上报 |

旧客户端授权表已移除。后续如果要新增登录、订阅或席位，必须另写 ADR 和新 schema。

## 4. 公共 API

### 4.1 Skill 列表

```http
GET /api/skills?module=generation&category=txt2img-local-print
```

返回启用的 Skill 摘要，不包含 `system_prompt` 全文。

同一个 `module + category` 可以有多条不同 `id` 的 Skill。提取能力使用
`module=generation&category=extract-paid-model` 这一组 Skill，Grsai 提取和
ComfyUI 提取都从这里选择；这个 category 名称是历史兼容名，不表示只给付费模型使用。

### 4.2 Skill 详情

```http
GET /api/skills/:id?version=1.0.0
```

返回单个 Skill 的完整系统提示词。未传 `version` 时返回最新启用版本。

### 4.3 公告和版本

```http
GET /api/announcements/active
GET /api/client-version/check
```

如接口尚未接入客户端，仍按服务端只存轻量配置的边界设计。

## 5. Admin API

Admin API 由后台页面调用，使用管理员 JWT。

| API | 用途 |
|---|---|
| `POST /admin/api/login` | 管理员登录 |
| `POST /admin/api/logout` | 管理员退出 |
| `GET /admin/api/customers` | 客户列表 |
| `GET /admin/api/customers/:id` | 客户详情 |
| `PATCH /admin/api/customers/:id` | 更新客户资料 |
| `POST /admin/api/customers/:id/ban` | 标记客户封号 |
| `GET /admin/api/skills` | Skill 列表 |
| `POST /admin/api/skills` | 创建 Skill |
| `PATCH /admin/api/skills/:id` | 更新 Skill |
| `GET /admin/api/skills/:id/versions` | Skill 版本列表 |

客户封号只是后台记录状态，不拦截客户端启动、拉 Skill 或业务模块运行。

## 6. Admin 页面

当前后台页面：

```text
/admin                 首页统计
/admin/login           管理员登录
/admin/customers       客户记录
/admin/customers/:id   客户详情
/admin/skills          Skill 管理
```

后台不提供 Provider、模型、Workflow 配置页面；这些全部在客户端设置页维护。

Skill 管理页面分两类：

- 固定业务槽位：文生图、图生图、侵权检测等一类只需要一个默认 Skill 的场景。
- 多条可选 Skill：提取提示词允许新增多条同分类 Skill，客户端在 Grsai 提取和 ComfyUI 提取里给用户选择。

## 7. Skill 版本策略

- `Skill.id + Skill.version` 唯一。
- 列表接口只返回每个 `id` 的最新启用版本。
- 详情接口支持指定历史版本。
- 客户端缓存路径：`.workbench/cache/skills/{skillId}/{version}.json`。
- 离线时客户端可使用缓存；服务端不可用时不阻塞已有本地流程。

## 8. 环境变量

```bash
DATABASE_URL=postgresql://dev:dev@localhost:5432/tengyu_aipod
JWT_SECRET_ADMIN=...
ADMIN_EMAIL=...
ADMIN_PASSWORD=...
```

没有客户端 JWT 密钥。客户端读取 Skill 不需要授权 header。

## 9. 验收标准

- `/api/health` 返回 `{ ok: true, db_ok: true }`
- `/api/skills` 无授权 header 也能返回启用 Skill
- Admin 可登录、查看客户、编辑客户、标记客户封号
- Admin 可创建、编辑、版本化 Skill
- Prisma schema 中不存在旧客户端授权模型
