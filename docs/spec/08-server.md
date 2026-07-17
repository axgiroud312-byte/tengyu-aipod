# Spec 08 — 服务端与 Admin 后台

> 当前版本：v1
> 最后更新：2026-06-03

## 1. 职责边界

服务端是轻配置中心和客户授权中心，不参与用户业务计算。

服务端负责：

- Admin 邮箱密码登录与后台页面
- 客户账号授权管理
- 客户授权校验
- Skill 系统提示词管理与客户端派发
- 公告与客户端版本信息
- 健康检查

服务端不负责：

- 微信扫码 OAuth 或手机号验证码登录本身（复用旧 PHP 统一登录体系）
- 生图、LLM、PS、采集、上架代理
- 用户图片、API Key、任务记录、标题文件、Workflow 文件存储
- Provider / 模型清单 / ComfyUI Workflow 云端管理
- 保存 PHP 登录返回的 `secret`

Admin 登录和客户登录必须分离：Admin 继续使用邮箱密码和管理员 JWT；客户登录使用旧 PHP `uid + secret`。

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
pnpm -F @tengyu-aipod/server prisma:generate
pnpm -F @tengyu-aipod/server exec prisma migrate deploy --schema prisma/schema.prisma
```

补充：

- server 本地开发仍监听 `http://127.0.0.1:3100`
- 客户端开发环境未显式配置 `TENGYU_SERVER_URL` 时，默认会连 `https://wechat.tengyuai.com`
- 如需联调本地 server，启动客户端前显式设置 `TENGYU_SERVER_URL=http://127.0.0.1:3100`

健康检查：

```http
GET /api/health
```

返回 `{ ok: true, db_ok: true }` 表示服务端和数据库可用。

## 3. 旧 PHP 登录体系

客户登录复用旧 PHP 统一登录体系：

```text
https://www.tengyuai.com/
```

已确认接口见 [../登录参考文档](../登录参考文档)。

关键接口：

| PHP 接口 | 用途 |
|---|---|
| `GET /api/wxlogin/get_qrcode` | 获取微信官方二维码页面 URL 和轮询 token |
| `POST /api/wxlogin/check_login` | 轮询微信扫码登录结果 |
| `POST /user/public/send_login_sms` | 发送手机号验证码 |
| `POST /user/public/login` | 手机号验证码登录 |
| `POST /user/user/info` | 校验 `uid + secret + finger` 并返回用户资料 |

当前客户端实现说明：

- 微信扫码入口直接展示 PHP 返回的微信官方 `qrcode_url`
- 短信倒计时当前由客户端本地维护 60 秒，不再依赖 PHP 倒计时接口
- 客户退出登录当前只清理本地 `uid + secret`，不额外调用 PHP 退出接口

旧 PHP 登录成功返回：

```json
{
  "uid": 123,
  "secret": "xxxxxxxx"
}
```

单点登录规则：

- 同一 `uid` 只有一个当前 `secret`。
- 新机器或旧 PHP 项目重新登录后，旧 `secret` 失效。
- PHP 返回 `nologin: 1` 时，客户端必须清空本地登录态并回登录页。

## 4. 数据模型

当前 Prisma schema 需要保留这些服务端模型：

| Model | 用途 |
|---|---|
| `CustomerAccount` | 客户账号授权：PHP uid、昵称、头像、手机号、状态、到期日、备注 |
| `Customer` | 旧客户档案表，第一版不做破坏性删除，但不再作为主客户授权入口 |
| `Skill` | 云端 Skill 系统提示词，按 `id + version` 版本化 |
| `Announcement` | 公告 |
| `ClientVersion` | 客户端版本信息 |
| `Admin` | Admin 后台账号 |
| `TelemetryError` | 可选错误上报 |

`CustomerAccount` 核心字段：

| 字段 | 说明 |
|---|---|
| `id` | 服务端主键 |
| `php_uid` | 旧 PHP 返回的 `uid`，唯一 |
| `nickname` | PHP 用户昵称 |
| `avatar_url` | PHP 头像 URL |
| `phone` | PHP `tel` |
| `account` | PHP `account` |
| `status` | `pending` / `active` / `disabled` |
| `expires_at` | 授权到期时间 |
| `notes` | 管理员备注 |
| `approved_at` | 授权时间 |
| `approved_by_admin_id` | 授权管理员 |
| `disabled_at` | 禁用时间 |
| `last_login_at` | 最后登录时间 |
| `created_at` / `updated_at` | 创建和更新时间 |

规则：

- `php_uid` 唯一。
- 首次登录的 `php_uid` 不存在时，自动创建 `status = pending`。
- `active` 状态必须有 `expires_at`。
- `expires_at` 小于当前时间时视为 `expired`。
- `expired` 是计算状态，不一定需要作为数据库 enum。
- Next 数据库不保存 PHP `secret`。

## 5. 公共 API

### 5.1 客户授权校验

```http
POST /api/customer-auth/verify
```

请求：

```json
{
  "uid": 123,
  "secret": "xxxxxxxx",
  "finger": "device-fingerprint"
}
```

服务端行为：

1. 调用旧 PHP `POST /user/user/info` 校验 `uid + secret + finger`。
2. 如果 PHP 返回 `nologin: 1`，返回客户登录态失效。
3. 查找或创建 `CustomerAccount`。
4. 用 PHP 返回的头像、昵称、手机号等轻量资料更新客户账号。
5. 返回 `pending / active / disabled / expired`。
6. 不保存 `secret`。

响应示例：

```json
{
  "status": "active",
  "customer": {
    "id": "cus_123",
    "php_uid": 123,
    "nickname": "TEST",
    "avatar_url": "https://www.tengyuai.com/Uploads/...",
    "phone": "13800138000",
    "expires_at": "2026-12-31T23:59:59.000Z"
  }
}
```

客户端所有客户侧云端请求都必须从主进程统一封装，调用前确认当前授权状态为 `active`。v1 不新增客户端 JWT；`secret` 只在授权校验请求中短暂发送到 Next，不落库。

Skill 列表和详情请求继续使用 GET，但必须由主进程通过 HTTPS 携带客户凭证：

```http
Authorization: Basic base64(uid:secret)
X-Tengyu-Finger: device-fingerprint
```

服务端收到请求后重新调用 PHP 校验 `uid + secret + finger`，并确认 `CustomerAccount` 当前仍为
`active` 且未到期。Skill 定向过滤只使用校验结果中的 `php_uid`，忽略 URL 中的 `uid`；Next 不记录、
不缓存、不落库保存 `secret`。缺少或无效凭证返回 `401`，未授权、禁用或过期返回 `403`。

### 5.2 Skill 列表

```http
GET /api/skills?module=generation&category=txt2img-local-print
```

返回启用的 Skill 摘要，不包含 `system_prompt` 全文。

同一个 `module + category` 可以有多条不同 `id` 的 Skill。文生图 / 图生图提示词生成按
`txt2img-local-print`、`txt2img-full-print`、`img2img-local-reference`、
`img2img-full-reference` 四个 category 分组；客户端根据当前“能力 + 印花类型”只展示当前组合下的 Skill。

提取能力使用 `module=generation&category=extract-paid-model` 这一组 Skill，Grsai 提取和
ComfyUI 提取都从这里选择；这个 category 名称是历史兼容名，不表示只给付费模型使用。

Skill 同步必须在客户授权通过后启动。
匿名请求不能读取 Skill 摘要。

### 5.3 Skill 详情

```http
GET /api/skills/:id?version=1.0.0
```

返回单个 Skill 的完整系统提示词。未传 `version` 时返回最新启用版本。
匿名请求不能读取 Skill 详情或系统提示词全文。

### 5.4 公告和版本

```http
GET /api/announcements/active
GET /api/client-version/check
```

如接口尚未接入客户端，仍按服务端只存轻量配置的边界设计。

## 6. Admin API

Admin API 由后台页面调用，使用管理员 JWT。

管理员 JWT 的签名和有效期校验通过后，所有受保护的 `/admin/*` 请求还必须查询当前管理员账号：

- 管理员记录必须仍然存在且 `is_active = true`。
- 当前角色必须与 JWT 中的角色一致。
- 管理员被删除、禁用或角色变更后，旧 JWT 立即失效并重定向到登录页，不等待 JWT 自身过期。
- 当前账号状态无法查询时必须失败关闭并返回结构化 `503`，不能继续放行。

| API | 用途 |
|---|---|
| `POST /admin/api/login` | 管理员登录 |
| `POST /admin/api/logout` | 管理员退出 |
| `GET /admin/api/admins` | 管理员账号列表 |
| `POST /admin/api/admins` | 创建管理员账号 |
| `PATCH /admin/api/admins/:id` | 更新管理员名称、角色、启用状态 |
| `GET /admin/api/customer-accounts` | 客户账号列表 |
| `GET /admin/api/customer-accounts/:id` | 客户账号详情 |
| `POST /admin/api/customer-accounts/:id/approve` | 授权客户账号，必须填写到期日 |
| `PATCH /admin/api/customer-accounts/:id` | 更新到期日、备注等资料 |
| `POST /admin/api/customer-accounts/:id/disable` | 禁用客户账号 |
| `POST /admin/api/customer-accounts/:id/enable` | 重新启用客户账号 |
| `GET /admin/api/skills` | Skill 列表 |
| `POST /admin/api/skills` | 创建 Skill |
| `PATCH /admin/api/skills/:id` | 更新 Skill |
| `GET /admin/api/skills/:id/versions` | Skill 版本列表 |

授权 `pending -> active` 时必须填写 `expires_at`。

## 7. Admin 页面

当前后台页面：

```text
/admin                 首页统计
/admin/login           管理员登录
/admin/admins          管理员账号管理
/admin/customers       客户账号授权管理
/admin/customers/:id   客户账号详情
/admin/skills          Skill 管理
```

`/admin/admins` 页面能力：

- 创建管理员账号
- 查看管理员邮箱、名称、角色、启用状态、最后登录时间
- 编辑管理员名称和角色
- 启用 / 禁用管理员账号
- 不允许禁用当前登录的管理员自己

`/admin/customers` 页面展示：

- PHP uid
- 头像
- 昵称
- 手机号
- 授权状态
- 到期日
- 最后登录时间
- 备注

页面能力：

- 搜索 `uid / 昵称 / 手机号`
- 授权 `pending` 账号并设置到期日
- 修改到期日
- 禁用账号
- 重新启用账号
- 填写备注

后台不提供 Provider、模型、Workflow 配置页面；这些全部在客户端设置页维护。

Skill 管理页面分两类：

- 默认业务槽位：文生图 / 图生图四个提示词组合和侵权检测都有默认 Skill，保持旧配置兼容。
- 多条可选 Skill：文生图 / 图生图四个提示词组合、提取提示词都允许新增多条同分类 Skill；客户端只展示当前组合下的可用项。

## 8. Skill 版本策略

- `Skill.id + Skill.version` 唯一。
- 列表接口只返回每个 `id` 的最新启用版本。
- 详情接口支持指定历史版本。
- 客户端缓存路径：`.workbench/cache/skills/{skillId}/{version}.json`。
- 离线时客户端可使用缓存；但首次进入 Workbench 必须先完成客户授权校验。

## 9. 环境变量

```bash
DATABASE_URL=postgresql://dev:dev@localhost:5432/tengyu_aipod
JWT_SECRET_ADMIN=...
NEXT_PUBLIC_APP_NAME="腾域 aipod"
PHP_AUTH_BASE_URL=https://www.tengyuai.com
ADMIN_INITIAL_EMAIL=...
ADMIN_INITIAL_PASSWORD=...
```

没有客户端 JWT 密钥。客户端授权校验使用旧 PHP `uid + secret`，Next 不落库保存 `secret`。

`ADMIN_INITIAL_EMAIL` / `ADMIN_INITIAL_PASSWORD` 只用于执行 `pnpm -F @tengyu-aipod/server prisma-seed`
时创建或重置初始管理员，不是 Admin 登录接口的运行期校验变量。

## 10. 生产部署

当前仓库提供两套生产 Compose：

- `docker-compose.server.yml`：服务器拉源码，本机构建 `packages/server/Dockerfile`
- `docker-compose.image.yml`：服务器只拉镜像，不在服务器上构建源码

镜像部署依赖 `.env.server`，模板见 `.env.server.example`。其中 `SERVER_IMAGE` 由镜像方案使用。

镜像部署最小流程：

```bash
docker compose --env-file .env.server -f docker-compose.image.yml pull server
docker compose --env-file .env.server -f docker-compose.image.yml up -d postgres
docker compose --env-file .env.server -f docker-compose.image.yml run --rm server prisma migrate deploy --schema packages/server/prisma/schema.prisma
docker compose --env-file .env.server -f docker-compose.image.yml run --rm server tsx packages/server/prisma/seed.ts
docker compose --env-file .env.server -f docker-compose.image.yml up -d server
```

源码构建部署最小流程：

```bash
docker compose --env-file .env.server -f docker-compose.server.yml up -d postgres
docker compose --env-file .env.server -f docker-compose.server.yml run --rm server prisma migrate deploy --schema packages/server/prisma/schema.prisma
docker compose --env-file .env.server -f docker-compose.server.yml run --rm server tsx packages/server/prisma/seed.ts
docker compose --env-file .env.server -f docker-compose.server.yml up -d server
```

## 11. 容量假设

v1 按以下规模设计：

- 100-500 同时在线客户
- 2 核 2G 服务器
- Next + Postgres + Nginx / Caddy 同机

500 在线客户每 5 分钟复查一次，约 1.7 rps，属于轻量 JSON 请求。

超过 2000 同时在线后，再评估：

- 升配服务器
- 拆分 Postgres
- 调整复查间隔
- 优化连接池

## 12. 验收标准

- `/api/health` 返回 `{ ok: true, db_ok: true }`
- `POST /api/customer-auth/verify` 会调用 PHP `/user/user/info` 校验登录态
- 首次登录的 `php_uid` 会自动创建 `pending` 客户账号
- `pending` 客户不能进入 Workbench
- Admin 可查看 `pending` 客户账号
- Admin 授权客户账号时必须填写到期日
- 客户端处于 `pending` 登录页时会自动复查授权，Admin 授权后无需用户手动重新校验即可进入
- `active` 且未到期客户可以进入 Workbench
- `disabled` 客户不能进入 Workbench
- 到期客户不能进入 Workbench
- 同一账号在另一台机器登录后，旧机器 5 分钟内发现失效并回登录页
- Admin 邮箱密码登录不受客户登录影响
- Admin 可直接在后台创建新的管理员账号
- Skill 同步不会在客户授权前启动
- Next 数据库不保存 PHP `secret`
- 服务端不接触图片、API Key、任务数据
