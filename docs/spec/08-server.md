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
| 认证（客户端）| 激活码 + JWT |
| 邮件 | Resend / 阿里云 DM（仅发激活码邮件，可选）|
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

// ─── 客户与激活 ─────────────────────────────────────

model Customer {
  id          String   @id @default(cuid())
  name        String
  phone       String   @unique               // 用作智能匹配
  email       String?
  wechat      String?
  notes       String?
  is_active   Boolean  @default(true)        // 客户级封号
  created_at  DateTime @default(now())
  
  codes       ActivationCode[]
  
  @@map("customers")
}

model ActivationCode {
  code          String   @id                  // POD-A1B2-C3D4-E5F6
  customer_id   String?                       // null = 匿名码
  batch_id      String?                       // 批量生成共享
  days_total    Int
  max_devices   Int
  is_active     Boolean  @default(true)       // 码级封号
  expires_at    DateTime?                     // 激活后开始算
  activated_at  DateTime?                     // 首次激活时间
  notes         String?
  created_at    DateTime @default(now())
  
  customer      Customer?           @relation(fields: [customer_id], references: [id])
  devices       DeviceActivation[]
  
  @@index([customer_id])
  @@index([batch_id])
  @@map("activation_codes")
}

model DeviceActivation {
  id                  String   @id @default(cuid())
  code_id             String                   // = ActivationCode.code
  device_fingerprint  String                   // SHA256
  device_name         String?                  // 用户起名
  activated_at        DateTime @default(now())
  last_active_at      DateTime @default(now())
  
  code                ActivationCode @relation(fields: [code_id], references: [code])
  
  @@unique([code_id, device_fingerprint])     // 同码同设备只能激活一次
  @@index([device_fingerprint])
  @@map("device_activations")
}

// ─── 派发资源 ─────────────────────────────────────

enum SkillModule {
  generation
  detection
  title
}

model Skill {
  id                  String   @id              // "extract-prompt-v3"
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

model Provider {
  id                  String   @id              // "grsai" | "aliyun-bailian"
  name                String
  type                String                    // 'paid-generation' | 'comfyui-cloud' | 'vision-llm'
  base_url            String
  fallback_url        String?
  api_style           String                    // 'grsai-native' | 'openai-images' | 'openai-chat' | 'dashscope-native'
  endpoints_json      String                    @db.Text  // JSON
  model_options_json  String                    @db.Text  // JSON
  default_params_json String                    @db.Text  // JSON
  capabilities        String[]                  // ['txt2img', 'img2img', ...]
  enabled             Boolean  @default(true)
  sort_order          Int      @default(0)
  notes               String?
  updated_at          DateTime @updatedAt
  
  @@map("providers")
}

model ComfyuiWorkflow {
  id                  String   @id              // 'extract-v3'
  category            String                    // 'extract' | 'img2img' | 'matting'
  version             String
  workflow_json       String                    @db.Text  // ComfyUI 原生 workflow JSON
  input_slots_json    String                    @db.Text
  output_slots_json   String                    @db.Text
  required_models     String[]
  recommended_pod_keywords String[]
  min_vram_gb         Int      @default(8)
  enabled             Boolean  @default(true)
  notes               String?
  updated_at          DateTime @updatedAt
  
  @@unique([id, version])
  @@index([category, enabled])
  @@map("comfyui_workflows")
}

model PlatformRule {
  key                 String   @id              // 'temu' | 'shein' | ...
  name                String
  category            String                    // 'collection' | 'listing'
  rules_json          String                    @db.Text
  enabled             Boolean  @default(true)
  version             String
  updated_at          DateTime @updatedAt
  
  @@map("platform_rules")
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
  device_fingerprint  String                    // 关联设备（不关联用户）
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

### 4.1 激活与状态

```
POST /api/activate
  body: { code, device_fingerprint, device_name? }
  response: { activation_token: JWT, expires_at, max_devices, used_devices }
  errors: 
    - INVALID_CODE
    - CODE_BANNED
    - DEVICE_LIMIT_REACHED
    - CUSTOMER_BANNED
    - ALREADY_ACTIVATED_BY_OTHER (this fingerprint registered with different code)

GET /api/status
  header: Authorization: Bearer <activation_token>
  response: {
    status: 'active' | 'expired' | 'banned',
    days_remaining: number,
    max_devices: number,
    used_devices: number,
    device_name: string,
    customer?: { name, has_contact } // 仅有 customer 时返回部分信息
  }

POST /api/auth/refresh
  body: { activation_token }
  response: { activation_token: new JWT }

POST /api/deactivate-device     // 用户自助解绑（每月限制 1 次）
  header: Bearer
  body: { device_fingerprint }
  response: { ok }
  errors:
    - SELF_DEACTIVATION_RATE_LIMITED (30 天内已用过)
```

### 4.2 派发资源

```
GET /api/skills
  header: Bearer
  query: ?module=generation&category=txt2img&platform=temu&language=en
  response: SkillSummary[]  (不含 system_prompt 全文)

GET /api/skills/:id
  header: Bearer
  query: ?version=3.0.1  (optional)
  response: Skill (full)

GET /api/providers
  query: ?type=paid-generation
  response: Provider[]

GET /api/comfyui-workflows
  query: ?category=extract
  response: ComfyuiWorkflowSummary[]

GET /api/comfyui-workflows/:id/content
  query: ?version=3.0.1
  response: ComfyuiWorkflow (full)

GET /api/platform-rules
  query: ?category=collection
  response: PlatformRule[]
```

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
    stack_trace?, device_fingerprint, occurred_at,
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

激活成功后服务端签发 JWT：

```ts
// JWT payload
interface ClientJwtPayload {
  sub: string                    // = "device_activation.id"
  code: string                   // activation code
  device_fp: string              // device fingerprint
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
  
  // 进一步查数据库：device 是否还在、码是否还激活
  const device = await prisma.deviceActivation.findUnique({
    where: { id: payload.sub },
    include: { code: { include: { customer: true } } },
  })
  if (!device) return null
  if (!device.code.is_active) return null
  if (device.code.customer && !device.code.customer.is_active) return null
  
  // 更新 last_active_at
  await prisma.deviceActivation.update({
    where: { id: device.id },
    data: { last_active_at: new Date() },
  })
  
  return { device, code: device.code }
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
├─ /codes                    ← 激活码列表（最常用）
├─ /codes/new                ← 创建激活码（单/批量匿名/CSV）
├─ /customers                ← 客户列表
├─ /customers/:id            ← 客户详情
├─ /skills                   ← Skill 管理
├─ /skills/:id               ← Skill 编辑
├─ /providers                ← Provider 管理
├─ /comfyui-workflows        ← 工作流管理（含上传 JSON）
├─ /platform-rules           ← 平台规则（采集/上架）
├─ /announcements            ← 公告管理
├─ /client-versions          ← 客户端版本发布
├─ /telemetry/errors         ← 错误日志
└─ /admins                   ← 管理员账号管理（仅 super）
```

### 6.2 Dashboard

```
[Dashboard]
今日 / 本周 / 本月 切换

激活码：
  总数 1,234
  已激活 856
  即将过期（7天内）23
  今日新增 5

客户：
  总数 234
  本周新增 4

设备：
  当前在线 78
  本周活跃 156

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

### 6.3 激活码列表（最常用）

```
[激活码列表]
搜索 [____]   筛选：● 全部  ○ 已激活  ○ 未激活  ○ 即将过期  ○ 已封号  
批次：[全部 ▼]   平台：[全部 ▼]

| 码 | 客户 | 联系方式 | 天数 | 设备 | 已激活 | 剩余天 | 批次 | 状态 | 操作 |
| POD-A1B2-... | 张三 | 138... | 365 | 3 | 2/3 | 222 | -            | ✅ | [详情][+30天][改设备][封号] |
| POD-C3D4-... | (匿名) | -    | 7   | 1 | 1/1 | 3 ⚠ | 春节推广批次 | ✅ | [关联客户][封号] |
| POD-E5F6-... | 李四 | 139... | 30  | 1 | 1/1 | 已过期 | -          | ⏹️ | [+30天][封号] |
...

[批量生成激活码 ▼]
[导出 CSV] [批量+30天] [批量封号]
```

### 6.4 创建激活码（3 种模式）

```
[+ 新建激活码]

模式：
  ● 单个创建（绑客户）
  ○ 批量匿名（试用/推广）
  ○ 批量预绑客户（CSV）

单个创建：
  客户信息：
    姓名：[张三]
    手机：[13800138000]
    微信：[zhangsan]（可选）
    备注：[2026 春节正式购买]
  
  智能匹配：已找到客户「张三 138...」
    ● 给该客户新增激活码
    ○ 新建客户
  
  激活码：
    天数：[365]
    设备数：[3]
    备注：[年费]
  
  [生成激活码]

批量匿名：
  天数：[7]   设备数：[1]
  数量：[100]
  批次备注：[2026春节试用]
  [生成 100 个码 → 下载 CSV]

批量预绑客户：
  天数：[30]   设备数：[1]
  上传 CSV：[选择文件] customers.csv
    格式：name, phone, email?, wechat?, notes?
  [预览] 50 行
    ☑ 同手机号已存在 → 复用客户记录（4 个）
    ☐ 全部新建客户
  [生成 50 个码 → 下载 CSV: 客户 | 手机 | 码]
```

### 6.5 客户列表

```
[客户列表]
| 客户 | 手机 | 微信 | 激活码数 | 最长剩余天 | 总设备 | 最近活跃 | 状态 | 操作 |
| 张三 | 138... | wx1 | 3 | 222 天 | 5/9 | 2 分钟前 | ✅ | [详情] |
| 李四 | 139... | wx2 | 1 | 5 天 | 1/1 | 5 天前 | ✅ | [详情] |
| 王五 | 137... | wx3 | 2 | 已过期 | 0/2 | 30 天前 | ✅ | [详情] |

搜索按 姓名 / 手机 / 微信
[+ 新建客户]
```

### 6.6 客户详情

```
[客户详情：张三]

基本信息：
  姓名：张三  手机：138...  微信：wx1  
  备注：2026 春节正式购买
  状态：● 激活
  创建：2026-01-15
  [编辑] [封号该客户（影响所有码）]

[+ 给该客户发新激活码]

激活码（3 个）：
  | 码 | 天数 | 设备 | 已激活 | 剩余 | 状态 | 操作 |
  | POD-A1B2 | 365 | 3 | 2/3 | 222 | ✅ | [+30天][改设备数][解绑设备][封号] |
  | POD-X5Y6 | 30  | 1 | 1/1 | 已过期 | ⏹️ | [+30天] [封号] |
  | POD-Z9W8 | 90  | 1 | 0/1 | 未激活 | ✅ | [作废] |

所有设备（3 台）：
  | 码 | 设备名 | 指纹 | 激活 | 最近活跃 | 操作 |
  | POD-A1B2 | 工作电脑 | abc... | 2026-01-15 | 5 分钟前 | [解绑] |
  | POD-A1B2 | 家用电脑 | def... | 2026-02-01 | 5 天前 | [解绑] |
```

### 6.7 Skill 管理

```
[Skill 列表]
模块：[全部 ▼] / generation / detection / title

| ID | 模块 | 分类 | 平台/语言 | 当前版本 | 推荐模型 | 启用 | 操作 |
| extract-prompt-v3 | generation | extract | - | 3.0.1 | qwen3.6-plus | ✅ | [编辑][版本历史][禁用] |
| infringement-v2 | detection | - | - | 2.1 | qwen3-vl-flash | ✅ | [编辑] |
| title-temu-en-v3 | title | - | temu_pop / en | 3.0 | qwen3-vl-plus | ✅ | [编辑] |

[+ 新建 Skill]

[编辑 Skill]
ID：[extract-prompt-v3]（不可改）
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

### 6.8 Provider 管理

```
[Provider 列表]
类型：[全部 ▼] / paid-generation / comfyui-cloud / vision-llm

| ID | 名称 | 类型 | API Style | Base URL | 启用 | 操作 |
| grsai | Grsai 付费生图 | paid-generation | grsai-native | https://grsai... | ✅ | [编辑] |
| aliyun-bailian | 阿里云百炼 | vision-llm | openai-chat | https://dashscope... | ✅ | [编辑] |
| chenyu | 晨羽智云 ComfyUI | comfyui-cloud | (n/a) | https://chenyu.cn... | ✅ | [编辑] |

[+ 新建 Provider]

[编辑 Provider]
ID / 名称 / 类型 / Base URL / Fallback URL / API Style /
端点（JSON）/ 模型选项（JSON）/ 默认参数（JSON）/ 能力（多选）/
启用 / 排序
```

### 6.9 ComfyUI 工作流管理

```
[工作流列表]
分类：[全部 ▼]

| ID | 分类 | 版本 | 推荐 Pod 关键词 | 最小显存 | 启用 | 操作 |
| extract-v3 | extract | 3.0.1 | ComfyUI Default | 12GB | ✅ | [编辑][下载 JSON] |
| matting-v2 | matting | 2.0 | ComfyUI Default | 8GB | ✅ | [编辑] |

[+ 上传新工作流]
  ID：[matting-v3]
  分类：[matting ▼]
  版本：[3.0]
  上传 workflow.json：[选择文件]
  Input slots：[手填或自动识别 image 节点]
  Output slots：[手填或自动识别 output 节点]
  推荐 Pod 关键词：[ComfyUI Default, Stable Diffusion]
  最小显存：[8]GB
  必需模型：[输入]
  [保存]
```

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
| 错误码 | 模块 | 次数 | 影响设备数 | 客户端版本分布 |
| CHENYU_INSTANCE_DOWN | generation | 87 | 23 | v1.2.x: 50, v1.3.0: 37 |
| SELECTOR_NOT_FOUND | listing | 34 | 12 | v1.2.x: 30, v1.3.0: 4 |
| PROMPT_PARSE_FAILED | detection | 12 | 8 | v1.3.0: 12 |

点 [详情] → 列出每条错误的设备指纹、时间、堆栈
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
  
  // /api/* 大部分需要 client token（除了 /api/activate 等）
  const PUBLIC_API = ['/api/activate', '/api/health']
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

### 8.1 异常激活检测

```ts
// 每次 /api/activate 后跑：
async function detectSuspiciousActivation(code: ActivationCode) {
  // 1. 同码多地理位置同时激活
  const last24hActivations = await prisma.deviceActivation.findMany({
    where: {
      code_id: code.code,
      activated_at: { gte: subHours(new Date(), 24) },
    },
  })
  
  // 用 IP 推地理（v1.5 加 ip 字段）
  if (uniqueGeoCountries(last24hActivations) > 2) {
    await alertAdmin(code, '同码 24h 内激活地理跨国家')
  }
  
  // 2. 同 device_fingerprint 短时间用不同码
  const sameFingerprint = await prisma.deviceActivation.findMany({
    where: {
      device_fingerprint: ...,
      activated_at: { gte: subDays(new Date(), 7) },
    },
  })
  if (sameFingerprint.length > 3) {
    await alertAdmin(code, '同设备 7 天内用了 ' + sameFingerprint.length + ' 个码')
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
- Rate limit：`/api/activate` 同 IP 每分钟 10 次；`/api/status` 同 token 每分钟 60 次
- 输入校验：所有 API 用 zod schema 校验

## 12. v1 → v1.5 演进

| 项 | v1 | v1.5 |
|---|---|---|
| 风控 | 仅 admin 手动看 | 自动检测异常激活 + 飞书告警 |
| 批次转化率 | 仅看激活数 | 完整漏斗（激活 → 转付费）|
| 自助续费 | ❌ | 仍 ❌（v2 才上）|
| 多管理员 | 单管理员 | 多 admin + 角色 |
| 选择器派发 | ❌（写死客户端）| ✅ 上架选择器云端版本化 |
| 自定义 Provider | 仅你管理员加 | ❌（继续）|

## 13. 测试

- API 端到端测试（Playwright API mode）
- Prisma 迁移测试
- JWT 签名验证
- 激活码激活 → 解绑 → 重激活流程
- 批量生成激活码的 CSV 导入
- 异常激活检测
