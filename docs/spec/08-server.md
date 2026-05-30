# Spec 08 — 服务器端

> Next.js + Postgres 单仓应用。同时承担客户端 API 和管理员后台（admin）。
> 严格遵守"不接触图片、不代理生图、不存用户 API Key"的边界。

## 1. 技术栈

| 层 | 选型 |
|---|---|
| 框架 | Next.js 15 (App Router) |
| 语言 | TypeScript 5+ strict mode |
| 数据库 | Postgres 16 |
| ORM | Prisma |
| API 验证 | zod schema |
| Admin UI | shadcn/ui + Tailwind |
| 认证（admin）| 邮箱+密码（自实现 JWT）|
| 认证（客户端）| 微信扫码登录 + 权益 JWT |
| 邮件 | Resend / 阿里云 DM（仅用于运营通知，可选）|
| 部署 | Vercel / 自托管 Docker / 2 核 2G 云服务器 |

## 2. 部署架构

### 2.1 推荐方案 B（v1）

```
[腾域客户端] ───── HTTPS ────► [Cloudflare CDN]
                                    │
                                    ▼
                            [2 核 2G 云服务器]
                            ├─ Next.js (PM2)
                            ├─ Caddy 反代 + 自动 SSL
                            └─ 系统监控
                                    │
                                    ▼
                            [Neon Postgres 免费档]
                            └─ 自动备份
```

月成本：¥30-50。

### 2.2 备选方案

- **方案 A**：完全自托管（含 Postgres 同机），¥40-70/月
- **方案 C**：Vercel + Neon 全 serverless，免费起跑（但国内访问慢）

## 3. Prisma Schema

```prisma
// prisma/schema.prisma

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

// ─── 客户、微信身份与权益 ─────────────────────────────

model Customer {
  id          String   @id @default(cuid())
  name        String
  phone       String   @unique               // 用作智能匹配
  email       String?
  wechat      String?
  notes       String?
  is_active   Boolean  @default(true)        // 客户级封号
  created_at  DateTime @default(now())

  users        CustomerWechatUser[]
  entitlements Entitlement[]
  codes        ActivationCode[]

  @@map("customers")
}

model WechatUser {
  id            String   @id @default(cuid())
  unionid       String?  @unique              // 微信开放平台跨应用唯一身份
  openid        String   @unique              // 当前扫码登录应用内身份
  nickname      String?
  avatar_url    String?
  is_active     Boolean  @default(true)       // 用户级封禁
  created_at    DateTime @default(now())
  last_login_at DateTime?

  customers     CustomerWechatUser[]
  entitlements  Entitlement[]
  sessions      ClientSession[]

  @@map("wechat_users")
}

model CustomerWechatUser {
  id             String   @id @default(cuid())
  customer_id    String
  wechat_user_id String
  role           String   @default("member")  // owner | member | operator
  created_at     DateTime @default(now())

  customer        Customer   @relation(fields: [customer_id], references: [id])
  wechat_user     WechatUser @relation(fields: [wechat_user_id], references: [id])

  @@unique([customer_id, wechat_user_id])
  @@index([wechat_user_id])
  @@map("customer_wechat_users")
}

model Entitlement {
  id             String   @id @default(cuid())
  customer_id    String?
  wechat_user_id String?
  source_code    String?                       // 来自兑换码时记录 code
  status         String   @default("active")   // active | expired | banned
  starts_at      DateTime @default(now())
  expires_at     DateTime
  seat_count     Int      @default(1)
  modules        String[]                      // generation | detection | title | listing | ...
  notes          String?
  created_at     DateTime @default(now())
  updated_at     DateTime @updatedAt

  customer       Customer?   @relation(fields: [customer_id], references: [id])
  wechat_user    WechatUser? @relation(fields: [wechat_user_id], references: [id])
  sessions       ClientSession[]

  @@index([customer_id])
  @@index([wechat_user_id])
  @@index([status, expires_at])
  @@map("entitlements")
}

model ActivationCode {
  code          String   @id                  // POD-A1B2-C3D4-E5F6
  customer_id   String?                       // null = 匿名兑换码
  batch_id      String?                       // 批量生成共享
  days_total    Int
  seat_count    Int      @default(1)
  modules       String[]
  is_active     Boolean  @default(true)       // 兑换码级封号
  redeemed_at   DateTime?
  redeemed_by   String?                       // WechatUser.id
  notes         String?
  created_at    DateTime @default(now())

  customer      Customer? @relation(fields: [customer_id], references: [id])

  @@index([customer_id])
  @@index([batch_id])
  @@map("activation_codes")
}

model ClientSession {
  id                  String   @id @default(cuid())
  wechat_user_id      String
  entitlement_id      String
  installation_label  String?                  // 用户给这次安装起名
  login_ip_hash       String?
  created_at          DateTime @default(now())
  last_active_at      DateTime @default(now())
  revoked_at          DateTime?

  wechat_user         WechatUser  @relation(fields: [wechat_user_id], references: [id])
  entitlement         Entitlement @relation(fields: [entitlement_id], references: [id])

  @@index([wechat_user_id])
  @@index([entitlement_id, revoked_at])
  @@map("client_sessions")
}

// ─── 派发资源 ─────────────────────────────────────

enum SkillModule {
  generation
  detection
  title
}

model Skill {
  id                  String   @id              // "extract-paid-model"
  module              SkillModule
  category            String?                   // 'txt2img' | 'img2img' | 'extract' | 'matting' | ...
  platform            String?                   // 仅 title skill 用
  language            String?                   // 仅 title skill 用
  version             String
  enabled             Boolean  @default(true)
  system_prompt       String                    @db.Text
  variables_json      String                    @db.Text  // JSON
  recommended_model   String?
  notes               String?
  created_at          DateTime @default(now())
  updated_at          DateTime @updatedAt
  
  @@unique([id, version])
  @@index([module, category])
  @@index([module, platform, language])
  @@map("skills")
}

model Announcement {
  id                  String   @id @default(cuid())
  title               String
  content             String                    @db.Text
  level               String                    // 'info' | 'warning' | 'critical'
  audience            String?                   // 'all' | 'specific_customers' | etc.
  start_at            DateTime
  end_at              DateTime?
  created_at          DateTime @default(now())
  
  @@index([start_at, end_at])
  @@map("announcements")
}

model ClientVersion {
  version             String   @id              // '1.3.0'
  channel             String                    // 'stable' | 'beta'
  platform            String                    // 'win' | 'mac' | 'all'
  force_upgrade       Boolean  @default(false)
  download_url_win    String?
  download_url_mac    String?
  changelog           String                    @db.Text
  published_at        DateTime @default(now())
  
  @@index([channel, published_at])
  @@map("client_versions")
}

// ─── Admin ─────────────────────────────────────

model Admin {
  id                  String   @id @default(cuid())
  email               String   @unique
  password_hash       String
  name                String
  role                String                    // 'super' | 'support'
  is_active           Boolean  @default(true)
  last_login_at       DateTime?
  created_at          DateTime @default(now())
  
  @@map("admins")
}

// ─── 遥测 ─────────────────────────────────────

model TelemetryError {
  id                  String   @id @default(cuid())
  client_version      String
  module              String
  error_code          String
  error_message       String                    @db.Text
  stack_trace         String?                   @db.Text
  client_session_id   String?                   // 可选授权会话，不含硬件指纹
  occurred_at         DateTime
  received_at         DateTime @default(now())

  @@index([error_code, occurred_at])
  @@index([module, occurred_at])
  @@map("telemetry_errors")
}
```

## 4. API 端点

所有响应统一格式：

```ts
type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } }
```

### 4.1 登录、权益与状态

```
GET /api/auth/wechat/qrcode
  response: { login_id, qrcode_url, expires_at }

GET /api/auth/wechat/poll
  query: ?login_id=...
  response: {
    status: 'pending' | 'scanned' | 'confirmed' | 'expired',
    auth_token?: JWT,
    user?: { nickname, avatar_url },
  }

POST /api/redeem-code
  header: Authorization: Bearer <auth_token>
  body: { code }
  response: { entitlement_id, expires_at, modules, seat_count }
  errors:
    - INVALID_CODE
    - CODE_BANNED
    - CODE_ALREADY_REDEEMED
    - CUSTOMER_BANNED

GET /api/status
  header: Authorization: Bearer <auth_token>
  response: {
    status: 'active' | 'expired' | 'banned' | 'no_entitlement',
    days_remaining: number,
    modules: string[],
    seat_count: number,
    customer?: { name, has_contact }
  }

POST /api/auth/refresh
  header: Authorization: Bearer <auth_token>
  response: { auth_token: new JWT }

POST /api/sessions/revoke
  header: Authorization: Bearer <auth_token>
  body: { session_id }
  response: { ok }
```

客户端不上传 CPU / 主板 / 网卡等硬件机器码，也不以设备指纹作为授权身份。多端控制按权益 seat 和 `ClientSession` 管理。

### 4.2 派发资源

```
GET /api/skills
  header: Bearer
  query: ?module=generation&category=txt2img-local-print
  response: SkillSummary[]  (不含 system_prompt 全文)

GET /api/skills/:id
  header: Bearer
  query: ?version=1.0.0  (optional)
  response: Skill (full)
```

Provider、百炼/Grsai 模型清单、ComfyUI Workflow、采集平台规则均由客户端本地维护，不再通过服务端 API 派发。

### 4.3 公告与版本

```
GET /api/announcements/active
  response: Announcement[]

GET /api/client-version/check
  query: ?current=1.2.0&channel=stable&platform=win
  response: {
    current_is_latest: boolean,
    latest: {
      version: '1.3.0',
      force_upgrade: false,
      download_url: '...',
      changelog: '...',
    } | null
  }
```

### 4.4 遥测

```
POST /api/telemetry/error
  header: Bearer
  body: {
    client_version, module, error_code, error_message,
    stack_trace?, client_session_id?, occurred_at,
  }
  response: { received: true }
  
  // 服务端记录，不返回任何业务信息
```

### 4.5 健康检查

```
GET /api/health
  response: { ok: true, uptime: seconds, db_ok: boolean }
```

## 5. 认证机制

### 5.1 客户端 JWT

微信登录确认后服务端签发短期 JWT，授权状态来自服务端的用户、会话和权益记录：

```ts
// JWT payload
interface ClientJwtPayload {
  sub: string                    // = "user.id"
  session_id: string             // client_sessions.id
  entitlement_id?: string        // 当前生效权益，无权益时为空
  exp: number                    // 过期时间（建议 30 天）
  iss: 'tengyu-pod-server'
  iat: number
}
```

签名用 HS256（同密钥）。客户端每次请求带 `Authorization: Bearer <jwt>`。

### 5.2 客户端验证逻辑

```ts
// Middleware: src/middleware.ts
async function verifyClientToken(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return null

  const token = auth.substring(7)
  const payload = await verifyJwt(token)
  if (!payload) return null

  const session = await prisma.clientSession.findUnique({
    where: { id: payload.session_id },
    include: {
      wechat_user: true,
      entitlement: true,
    },
  })
  if (!session || session.revoked_at) return null
  if (!session.wechat_user.is_active) return null

  const entitlement = session.entitlement
  if (!entitlement || entitlement.status !== 'active') return null
  if (entitlement.expires_at < new Date()) return null

  await prisma.clientSession.update({
    where: { id: session.id },
    data: { last_active_at: new Date() },
  })

  return { session, user: session.wechat_user, entitlement }
}
```

### 5.3 Admin 登录

```
POST /admin/api/login
  body: { email, password }
  response: { admin_token: JWT, admin: { name, role } }
  
  服务端：
  1. 查 admins 表
  2. bcrypt.compare(password, password_hash)
  3. 签发 admin JWT（payload: { sub: admin.id, role, exp }）
```

Admin JWT 用单独密钥签名。

## 6. Admin 后台页面

### 6.1 主菜单结构

```
/admin
├─ /dashboard                ← 数据概览
├─ /wechat-users             ← 微信用户列表
├─ /customers                ← 客户列表
├─ /customers/:id            ← 客户详情
├─ /entitlements             ← 权益列表（开通/续费/封禁/席位）
├─ /codes                    ← 兑换码列表
├─ /codes/new                ← 创建兑换码（单个/批量/CSV）
├─ /skills                   ← Skill 管理
├─ /skills/:id               ← Skill 编辑
├─ /announcements            ← 公告管理
├─ /client-versions          ← 客户端版本发布
├─ /telemetry/errors         ← 错误日志
└─ /admins                   ← 管理员账号管理（仅 super）
```

### 6.2 Dashboard

```
[Dashboard]
今日 / 本周 / 本月 切换

微信用户：
  总数 1,234
  今日新增 5
  本周活跃 156

权益：
  生效中 856
  即将过期（7天内）23
  今日续费 12

兑换码：
  总数 1,234
  已兑换 856
  今日新增 100

客户：
  总数 234
  本周新增 4

席位：
  当前在线 78
  已占用 156 / 300

错误日志：
  最近 24h 上报 12
  最常见错误：CHENYU_INSTANCE_DOWN (5)
  
公告：
  当前生效 2
  [+ 新公告]

客户端：
  最新版 1.3.0 (2 天前发布)
  覆盖率：72%
```

### 6.3 兑换码列表（推广 / 试用 / 人工发码）

```
[兑换码列表]
搜索 [____]   筛选：● 全部  ○ 未兑换  ○ 已兑换  ○ 已作废
批次：[全部 ▼]

| 码 | 客户 | 天数 | 席位 | 模块 | 兑换人 | 批次 | 状态 | 操作 |
| POD-A1B2-... | 张三 | 365 | 3 | 全模块 | wx_张三 | - | ✅ 已兑换 | [详情][作废] |
| POD-C3D4-... | (匿名) | 7 | 1 | 全模块 | - | 春节推广批次 | ✅ 未兑换 | [关联客户][作废] |
| POD-E5F6-... | 李四 | 30 | 1 | 标题+检测 | wx_李四 | - | ⏹️ 已作废 | [恢复] |
...

[批量生成兑换码 ▼]
[导出 CSV] [批量作废]
```

### 6.4 创建兑换码 / 开通权益（3 种模式）

```
[+ 新建兑换码 / 开通权益]

模式：
  ● 直接开通权益（绑定微信用户或客户）
  ○ 生成单个兑换码
  ○ 批量兑换码（试用/推广/CSV）

直接开通权益：
  绑定对象：
    微信用户：[搜索 unionid/openid/昵称]
    客户：[张三 13800138000]（可选）
  权益：
    天数：[365]
    席位数：[3]
    模块：[全选 / 生图 / 检测 / 标题 / 上架]
    备注：[年费]
  [开通权益]

生成单个兑换码：
  客户：[可选]
  天数：[365]   席位数：[3]
  模块：[全选]
  [生成兑换码]

批量兑换码：
  天数：[7]   席位数：[1]
  数量：[100]
  批次备注：[2026春节试用]
  [生成 100 个码 → 下载 CSV]
```

### 6.5 客户列表

```
[客户列表]
| 客户 | 手机 | 微信备注 | 微信用户数 | 生效权益 | 席位占用 | 最近活跃 | 状态 | 操作 |
| 张三 | 138... | wx1 | 2 | 222 天 | 2/3 | 2 分钟前 | ✅ | [详情] |
| 李四 | 139... | wx2 | 1 | 5 天 | 1/1 | 5 天前 | ✅ | [详情] |
| 王五 | 137... | wx3 | 1 | 已过期 | 0/2 | 30 天前 | ✅ | [详情] |

搜索按 姓名 / 手机 / 微信备注 / unionid
[+ 新建客户]
```

### 6.6 客户详情

```
[客户详情：张三]

基本信息：
  姓名：张三  手机：138...  微信备注：wx1
  备注：2026 春节正式购买
  状态：● 正常
  创建：2026-01-15
  [编辑] [封禁该客户关联权益]

[+ 绑定微信用户]
[+ 直接开通权益]
[+ 生成兑换码]

微信用户（2 个）：
  | 昵称 | unionid/openid | 角色 | 最近登录 | 状态 | 操作 |
  | 张三 | u_xxx | owner | 2 分钟前 | ✅ | [解绑] |
  | 员工A | u_yyy | member | 5 天前 | ✅ | [解绑] |

权益（2 个）：
  | 来源 | 天数/到期 | 席位 | 已占用 | 模块 | 状态 | 操作 |
  | 人工开通 | 222 天 | 3 | 2/3 | 全模块 | ✅ | [+30天][改席位][封禁] |
  | POD-X5Y6 | 已过期 | 1 | 0/1 | 标题+检测 | ⏹️ | [+30天] |

当前会话 / 席位：
  | 微信用户 | 安装备注 | 登录时间 | 最近活跃 | 操作 |
  | 张三 | 工作电脑 | 2026-01-15 | 5 分钟前 | [解绑席位] |
  | 员工A | 家用电脑 | 2026-02-01 | 5 天前 | [解绑席位] |
```

### 6.7 Skill 管理

```
[Skill 列表]
模块：[全部 ▼] / generation / detection / title

| ID | 模块 | 分类 | 平台/语言 | 当前版本 | 推荐模型 | 启用 | 操作 |
| extract-paid-model | generation | extract-paid-model | - | 1.0.0 | qwen3-vl-plus | ✅ | [编辑] |
| extract-comfyui-workflow | generation | extract-comfyui-workflow | - | 1.0.0 | - | ✅ | [编辑] |
| infringement-detection | detection | infringement | - | 1.0.0 | qwen3-vl-flash | ✅ | [编辑] |
| title-temu-en-v3 | title | - | temu_pop / en | 3.0 | qwen3-vl-plus | ✅ | [编辑] |

[+ 新建 Skill]

[编辑 Skill]
ID：[extract-paid-model]（不可改）
模块：[generation ▼]
分类：[extract ▼]
版本：[3.0.2]（自动 +0.0.1，可改）
推荐模型：[qwen3.6-plus]

System Prompt（支持 markdown 预览）：
[textarea，大字段]
You are an expert at... output JSON array...

变量定义（JSON）：
[textarea]
[
  { "key": "printMode", "label": "印花类型", "type": "select", 
    "options": [...] },
  ...
]

启用：[ on / off ]

[保存为新版本] [覆盖当前版本] [取消]
```

### 6.8 本地生成配置

Provider、ComfyUI Workflow 和平台规则都不在服务端后台管理。用户在客户端设置页本地维护 Grsai、百炼和本地 Workflow；服务端只保存 Skill 系统提示词、客户、权益和登录态相关数据。

### 6.10 公告管理

```
[公告列表]
| 标题 | 等级 | 起 | 止 | 受众 | 操作 |
| 春节维护通知 | info | 2026-02-09 | 2026-02-15 | all | [编辑][结束] |
| 客户端 v1.3.0 发布 | info | 2026-03-01 | 2026-03-30 | all | [...] |
| 紧急 - 店小秘改版 | critical | 2026-04-01 | 2026-04-03 | all | [...] |

[+ 新建公告]
  标题、内容（markdown）、等级（info/warning/critical）、起止时间、受众
```

### 6.11 客户端版本管理

```
[版本列表]
| 版本 | 通道 | 平台 | 强制升级 | 发布时间 | 操作 |
| 1.3.0 | stable | all | ❌ | 2026-04-15 | [编辑][禁用] |
| 1.4.0-beta | beta | all | ❌ | 2026-05-01 | [...] |

[+ 发布新版本]
  版本：[1.4.0]
  通道：[stable ▼]
  平台：[all / win / mac]
  强制升级：[ on / off ]
  下载 URL Win：[输入]
  下载 URL Mac：[输入]
  Changelog (markdown)：[textarea]
  [发布]
```

### 6.12 错误日志（遥测）

```
[错误聚合]
最近：[7 天 ▼]
模块：[全部 ▼]

按错误码聚合：
| 错误码 | 模块 | 次数 | 影响会话数 | 客户端版本分布 |
| CHENYU_INSTANCE_DOWN | generation | 87 | 23 | v1.2.x: 50, v1.3.0: 37 |
| SELECTOR_NOT_FOUND | listing | 34 | 12 | v1.2.x: 30, v1.3.0: 4 |
| PROMPT_PARSE_FAILED | detection | 12 | 8 | v1.3.0: 12 |

点 [详情] → 列出每条错误的会话、时间、堆栈
```

## 7. 路由保护

```ts
// middleware.ts
export function middleware(req: NextRequest) {
  const url = req.nextUrl.pathname
  
  // /admin/* 需要 admin token
  if (url.startsWith('/admin') && url !== '/admin/login') {
    const token = req.cookies.get('admin_token')?.value
    if (!verifyAdminToken(token)) {
      return NextResponse.redirect(new URL('/admin/login', req.url))
    }
  }
  
  // /api/* 大部分需要 client token（除了微信登录轮询、健康检查等）
  const PUBLIC_API = ['/api/auth/wechat/qrcode', '/api/auth/wechat/poll', '/api/health']
  if (url.startsWith('/api/') && !PUBLIC_API.includes(url)) {
    const auth = req.headers.get('authorization')
    if (!auth) {
      return NextResponse.json({ ok: false, error: { code: 'UNAUTHORIZED' }}, { status: 401 })
    }
    // JWT 验签在各 route 内做（要查 DB，middleware 不适合）
  }
}
```

## 8. 风控与监控（v1.5+）

### 8.1 异常登录 / 兑换检测

```ts
// 每次微信登录、兑换码兑换或新会话创建后跑：
async function detectSuspiciousUsage(user: WechatUser) {
  // 1. 同一微信用户短时间多地理位置登录
  const recentSessions = await prisma.clientSession.findMany({
    where: {
      wechat_user_id: user.id,
      created_at: { gte: subHours(new Date(), 24) },
    },
  })

  // 用 IP hash / 粗粒度地理识别异常，不采集硬件机器码
  if (uniqueGeoCountries(recentSessions) > 2) {
    await alertAdmin(user, '同一微信用户 24h 内登录地理跨国家')
  }

  // 2. 同一兑换码批次短时间异常高兑换
  const burstRedeems = await prisma.activationCode.findMany({
    where: {
      batch_id: user.latestBatchId,
      redeemed_at: { gte: subHours(new Date(), 1) },
    },
  })
  if (burstRedeems.length > 50) {
    await alertAdmin(user, '同批次兑换码 1h 内兑换异常')
  }
}
```

### 8.2 告警渠道

- 飞书机器人 / 钉钉机器人 webhook
- 邮件
- admin 后台高亮显示

## 9. 部署细节

### 9.1 环境变量

```bash
# .env
DATABASE_URL=postgres://...
JWT_SECRET_CLIENT=...          # 客户端 JWT 签名密钥
JWT_SECRET_ADMIN=...           # admin JWT
ADMIN_INITIAL_EMAIL=you@...
ADMIN_INITIAL_PASSWORD=...
TELEMETRY_ENABLED=true
FEISHU_WEBHOOK=...             # 告警
```

### 9.2 Docker

```dockerfile
FROM node:20-alpine AS base
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

FROM base AS build
COPY . .
RUN pnpm prisma generate && pnpm build

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/public ./public
ENV NODE_ENV=production
CMD ["pnpm", "start"]
```

### 9.3 Caddy 配置

```caddy
api.tengyu-aipod.com {
  reverse_proxy localhost:3000
  encode gzip
  
  log {
    output file /var/log/caddy/api.log
  }
}
```

### 9.4 PM2 配置

```js
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'tengyu-aipod-server',
    script: 'pnpm',
    args: 'start',
    cwd: '/app',
    instances: 1,
    autorestart: true,
    max_memory_restart: '500M',
    env: {
      PORT: 3000,
    },
  }],
}
```

### 9.5 备份策略

```bash
# 每天凌晨 3 点
0 3 * * * pg_dump $DATABASE_URL | gzip > /backups/db_$(date +\%Y\%m\%d).sql.gz && \
          rclone copy /backups/db_$(date +\%Y\%m\%d).sql.gz aliyun-oss:tengyu-backups/ && \
          find /backups -name "db_*.sql.gz" -mtime +30 -delete
```

## 10. 性能预算

| 指标 | 预算 |
|---|---|
| 单次 API 响应时间（P95）| < 200ms |
| /api/status QPS | < 10（启动突发可达 100）|
| Postgres 连接池 | 10-20 |
| 数据库总大小（5000 用户）| < 100MB |

## 11. 安全

- 所有 password_hash 用 bcrypt（cost=12）
- API Key 风格：`tk_live_xxx`（如果未来引入服务端 token）
- 不接受跨域请求（CORS 只允许客户端 user-agent 模式 + admin 域名）
- Rate limit：`/api/auth/wechat/*` 同 IP 每分钟 10 次；`/api/redeem-code` 同用户每分钟 5 次；`/api/status` 同 token 每分钟 60 次
- 输入校验：所有 API 用 zod schema 校验

## 12. v1 → v1.5 演进

| 项 | v1 | v1.5 |
|---|---|---|
| 风控 | 仅 admin 手动看 | 自动检测异常登录 / 兑换 + 飞书告警 |
| 批次转化率 | 仅看兑换数 | 完整漏斗（登录 → 兑换 → 转付费）|
| 自助续费 | ❌ | 仍 ❌（v2 才上）|
| 多管理员 | 单管理员 | 多 admin + 角色 |
| 平台规则 / 选择器 | 客户端内置 | 客户端本地自定义 / 随客户端版本更新 |
| Provider / Workflow 本地化 | ✅ | ✅ |

## 13. 测试

- API 端到端测试（Playwright API mode）
- Prisma 迁移测试
- JWT 签名验证
- 微信扫码登录 → 刷新 token → 登出 / 解绑会话流程
- 兑换码兑换 → 权益开通流程
- 批量生成兑换码的 CSV 导入
- 异常登录 / 兑换检测
