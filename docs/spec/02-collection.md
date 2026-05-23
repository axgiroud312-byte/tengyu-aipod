# Spec 02 — 采集模块

> 浏览器辅助采集器。用户在比特浏览器里手动浏览跨境电商平台，腾域监听点击/滚动事件，保存商品图到本地。
> **不绕过登录、验证码、风控**。

## 1. 核心能力

| 子能力 | 说明 |
|---|---|
| **点击采集** | 用户点击某张图 → 保存原图到对应商品文件夹 |
| **滚动采集** | 用户滚动列表页 → 按规则自动保存图片到散图池 |
| **平台绑定管理** | 一个采集平台关联一个比特浏览器 profile |
| **采集会话状态展示** | 实时显示模式、数量、保存位置 |
| **失败重试** | 用户从记录中触发单图重试 |
| **采集预览** | 展示最近保存图片、删除、打开所在文件夹 |

## 2. 内置采集平台

| Platform Key | 平台 | 商品 URL 规则示例 |
|---|---|---|
| `temu` | Temu | 含 `/goods/` 或 `/goods.html` |
| `ozon` | Ozon | 含 `/product/` |
| `shein` | Shein | 含 `-p-` |
| `tiktok` | TikTok Shop | 含 `/product/` |
| `shopee` | Shopee | 多区域，含 `/item/` 或 `-i.` |
| `1688` | 1688 | 含 `/offer/` |
| `mercado` | Mercado Libre | 含 `/MLB-` 或 `/p/MLB` |

各平台的 URL 规则、原图提取规则、登录辅助检测规则在云端 Skill / Provider 之外，**单独有一个 platform-rules 配置**也由云端派发，详见 §11。

## 3. 采集会话生命周期

```
状态机：

  idle (no session)
    │
    ▶ 用户点"开始采集会话"
    │ 选 platform + browser profile + 模式
    │
    ▼
  starting
    │
    ▶ 主进程检查 profile 是否被锁
    │ 通过 CDP 连接 profile
    │ 注入采集脚本（监听 click / scroll）
    │
    ▼
  active                        ← 用户在浏览器自由操作
    │
    ├─▶ 用户离开 platform 允许域 → paused (manual_intervention)
    ├─▶ 浏览器 profile 关闭 → paused (browser_closed)
    ├─▶ 主窗口关闭 → paused (window_closed)
    ├─▶ 用户点"停止" → stopping
    │
    ▼
  stopping
    │
    ▶ 导出采集清单
    │ 释放 profile 锁
    │ session.status = completed
    │
    ▼
  completed
```

**关键约束**：
- 同一时刻 workbench 内最多 1 个 active 采集会话
- 同一时刻一个 browser profile 最多被一个模块占用（详见 spec/01）

## 4. 点击采集

### 4.1 触发

CDP 监听 `Runtime.bindingCalled` 或注入 Mutation Observer，捕获用户点击图片元素。

```ts
// 注入到页面的脚本
document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement
  if (target.tagName === 'IMG') {
    const img = target as HTMLImageElement
    const goodsLink = findNearestGoodsLink(img)  // 找最近的商品卡片链接
    const originalUrl = resolveOriginalImage(img.src, platform)
    sendToHost({ kind: 'click', img: originalUrl, goodsLink, page: location.href })
  }
})
```

### 4.2 货号填写流程

```
用户点击图片
  ↓
主进程检查：是否在商品页（page_url 匹配 商品 URL 规则）？
  ├─ 是 + 该商品已采集过 → 自动归到现有商品文件夹
  ├─ 是 + 该商品首次采集 → 低打扰弹窗"请填写货号 [____]"
  │      ↓
  │      用户填写后保存
  │
  └─ 否（列表页等）→ 落入散图池 + 提示用户"未识别为商品页"
```

低打扰弹窗实现：不抢焦点，浮在右下角，2 分钟未操作折叠为 toast。

### 4.3 保存路径

```
{素材总目录}/01-采集/
├─ {采集组ID}/              ← 一个商品页一个文件夹
│   ├─ {采集货号}-001.jpg   ← 文件名 = 货号-序号
│   ├─ {采集货号}-002.jpg
│   └─ ...
└─ 散图池/
    └─ {platform}-{timestamp}-{seq}.jpg
```

**采集组 ID** ≠ 货号；采集组是一次点击会话产生的临时分组，货号是用户主动填写的业务标识。

## 5. 滚动采集

### 5.1 触发

CDP 监听滚动事件 + 图片加载，自动判断符合条件的图。

### 5.2 过滤规则（用户在 UI 配置）

```
滚动采集设置：
  关键词过滤：[输入] [+添加]   ← 图所属链接匹配则丢弃
  关键词选择：[输入] [+添加]   ← 图所属链接匹配则保留
  图片尺寸：宽 [最小___]~[最大___]，高 [最小___]~[最大___]（0=不限制）
  原文件名前缀：[platform-timestamp]
```

**优先级**：关键词过滤 > 关键词选择 > 尺寸过滤

### 5.3 保存路径

滚动采集的图都进散图池，文件名含平台和时间。

```
散图池/{platform}-{YYYYMMDD-HHmmss}-{seq}.jpg
```

后期用户在 UI 上"批量归档" → 多选 → 指定货号 → 移到 `01-采集/{采集货号}/`。

## 6. 平台规则（云端可派发）

```ts
interface PlatformRule {
  key: string                    // "temu" | "ozon" | ...
  name: string                   // 显示名
  allowed_domains: string[]      // ["temu.com", "*.temu.com"]
  entry_url: string              // 打开时默认入口
  goods_url_patterns: RegExp[]   // 商品页 URL 判断
  login_check: {
    indicators: string[]         // 登录页特征文本
    inverse?: string[]           // 已登录的特征
  }
  original_image_resolver: {
    type: 'src_replace' | 'data_attr' | 'srcset_largest'
    config: Record<string, unknown>
  }
}
```

腾域客户端启动时从云端拉取最新 platform-rules，缓存到 `.workbench/cache/platform-rules.json`。

**用户也可创建自定义采集平台**：
```ts
{
  key: 'my-shop',
  name: '我的店',
  entry_url: 'https://mystore.com',
  goods_url_patterns: [/\/product\//],
  login_check: { indicators: ['请登录'] },
  original_image_resolver: { type: 'src_replace', config: { from: '_thumb', to: '_original' }}
}
```

自定义规则存本地数据库，不与云端同步。

## 7. 比特浏览器集成

### 7.1 连接

```ts
// adapters/bit-browser.ts
class BitBrowserClient {
  private baseUrl = 'http://127.0.0.1:54345'

  async listProfiles(): Promise<Profile[]> {
    return await fetch(`${this.baseUrl}/browser/list`).then(r => r.json())
  }

  async openProfile(profileId: string): Promise<{ http: string; ws: string }> {
    // 比特浏览器 API 返回 CDP 端点
    return await fetch(`${this.baseUrl}/browser/open`, {
      method: 'POST',
      body: JSON.stringify({ id: profileId }),
    }).then(r => r.json())
  }

  async closeProfile(profileId: string): Promise<void> { ... }
}
```

### 7.2 CDP 连接

```ts
// adapters/cdp.ts
import { chromium } from 'playwright-extra'

async function connectToProfile(profileId: string) {
  const { http } = await bitBrowser.openProfile(profileId)
  const browser = await chromium.connectOverCDP(http)
  return browser
}
```

### 7.3 注入采集脚本

```ts
async function injectCollectionScript(page: Page, platformRule: PlatformRule) {
  await page.addInitScript({
    path: path.join(__dirname, 'inject', 'collection-script.js'),
  })

  await page.exposeBinding('__poseidonSendToHost', (source, data) => {
    handleCollectionEvent(data)
  })
}
```

## 8. UI 设计

### 8.1 模块面板（启动会话前）

```
┌─ 采集 ──────────────────────────────────────────┐
│                                                │
│ 当前无活动会话                                  │
│                                                │
│ 1. 选择采集平台                                 │
│    ● Temu  ○ Ozon  ○ Shein ...                  │
│    [+ 自定义平台]                               │
│                                                │
│ 2. 选择比特浏览器环境                           │
│    ☑ profile-001（Temu 主店）● 已登录            │
│    ☐ profile-002（备店）⚠ 未登录                │
│    [刷新比特浏览器列表]                          │
│                                                │
│ 3. 采集模式                                     │
│    ● 点击采集（推荐，按商品归档）                │
│    ○ 滚动采集（瀑布式批量保存）                  │
│                                                │
│ 4. 输出目录                                     │
│    /Users/.../素材总目录/01-采集/               │
│                                                │
│ [开始采集会话]                                  │
└────────────────────────────────────────────────┘
```

### 8.2 模块面板（会话激活后 - 低打扰）

```
┌─ 采集中 ─────────────────────────────────────┐
│ ● Temu · 点击模式 · profile-001              │
│                                              │
│ 已采集：12 张 / 3 个商品                      │
│ 失败：1                                       │
│ 当前页面：https://temu.com/goods/123456      │
│                                              │
│ 最近保存：                                    │
│   📷 sku-001-003.jpg (3 秒前)                │
│   📷 sku-001-002.jpg (8 秒前)                │
│   📷 sku-001-001.jpg (15 秒前)               │
│                                              │
│ [停止会话]  [查看清单]  [查看失败]            │
└─────────────────────────────────────────────┘
```

**关键 UX**：会话进行中**不抢焦点、不弹模态对话框**，全部用 toast / 卡片 / 浮窗。

### 8.3 低打扰提示场景

| 场景 | 提示 |
|---|---|
| 用户离开 platform 允许域 | toast "已暂停监听，回到 Temu 自动恢复" |
| 浏览器 profile 关闭 | toast "比特浏览器已关闭，会话暂停" |
| 主进程窗口关闭 | 会话标记为 paused，下次启动询问恢复 |
| 商品页未识别 | toast "当前不是商品页，图保存到散图池" |
| 货号填写中 | 右下角浮窗，2 分钟未操作折叠 |

## 9. 采集记录与清单

### 9.1 数据库

```sql
CREATE TABLE collection_sessions (
  id              TEXT PRIMARY KEY,
  platform        TEXT NOT NULL,
  profile_id      TEXT NOT NULL,
  mode            TEXT NOT NULL,                   -- "click" | "scroll"
  status          TEXT NOT NULL,                   -- "active" | "paused" | "completed"
  output_dir      TEXT NOT NULL,
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER,
  task_id         TEXT REFERENCES tasks(id)       -- 关联轻量任务
);

CREATE TABLE collection_records (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES collection_sessions(id),
  sku_code        TEXT,                            -- 货号（点击+商品页）
  source_url      TEXT NOT NULL,                   -- 图片原 URL
  goods_link      TEXT,                            -- 所属商品链接
  page_url        TEXT NOT NULL,                   -- 触发页面
  saved_path      TEXT,                            -- 保存路径，可能空（失败时）
  status          TEXT NOT NULL,                   -- "success" | "skipped" | "failed"
  reason          TEXT,                            -- 跳过/失败原因
  file_size       INTEGER,
  created_at      INTEGER NOT NULL
);

CREATE INDEX idx_records_session ON collection_records(session_id);
CREATE INDEX idx_records_status ON collection_records(status);
```

### 9.2 导出清单

会话结束时自动导出 CSV 到 `01-采集/{session_id}-manifest.csv`：

```csv
sku_code,saved_path,source_url,goods_link,status,file_size,created_at
sku-001,01-采集/sku-001/sku-001-001.jpg,https://...,https://...,success,234567,1716480000000
sku-001,01-采集/sku-001/sku-001-002.jpg,...
...
```

## 10. 失败重试

UI 上有"查看失败"按钮 → 列出本次会话失败的图片：

```
| 图片 | 原因 | 商品链接 | 操作 |
| sku-001-003.jpg | HTTP 404 | https://... | [重试][删除] |
| sku-002-001.jpg | 文件大小为 0 | https://... | [重试][删除] |
```

重试逻辑：
- 简单重试：再次下载 source_url
- 多次失败：保存为 0-byte 占位，标记永久失败

## 11. 云端派发的资源

### 11.1 Platform Rules

`GET /api/platform-rules`

```json
{
  "version": "20260520-01",
  "rules": [
    { "key": "temu", "name": "Temu", "allowed_domains": [...], ... },
    ...
  ]
}
```

客户端按 version 比较，新版才更新本地。

### 11.2 不派发的

- 用户的 platform 自定义规则：仅本地
- 平台账号：永远不上传

## 12. 安全和敏感数据

**不保存**：
- 平台账号密码
- Cookie
- 订单/支付/聊天等业务数据

**保存**：
- 商品图片
- 商品链接（仅作为素材追溯）
- 采集货号

**审计**：
- 所有采集记录留 30 天本地日志
- 用户可主动清理

## 13. IPC 接口

```ts
'collection:list-platforms'           → PlatformRule[]
'collection:list-profiles'            → BitBrowserProfile[]
'collection:start-session'            → { platform, profile_id, mode, output_dir }
'collection:stop-session'             → { session_id }
'collection:get-active-session'       → CollectionSession | null
'collection:export-manifest'          → { session_id, format: 'csv' | 'json' }
'collection:retry-record'             → { record_id }
'collection:delete-record'            → { record_id }

// 事件
'collection:event'                    → { type, record? }
                                        // type: 'image-saved' | 'session-paused' | 'session-resumed' | 'manual-intervention'
```

## 14. 错误处理

| 错误码 | 触发 | 处理 |
|---|---|---|
| `BROWSER_NOT_CONNECTED` | 比特浏览器未启动 | UI 提示用户启动 |
| `PROFILE_LOCKED` | profile 被其他模块（上架）占用 | UI 提示用户先停掉冲突任务 |
| `LOGIN_REQUIRED` | 平台需要登录 | UI 提示用户在比特浏览器手动登录 |
| `PLATFORM_RULE_NOT_FOUND` | 平台规则缺失 | UI 提示等待云端派发或创建自定义 |
| `OUTPUT_DIR_NOT_WRITABLE` | 输出目录权限问题 | UI 提示用户检查权限 |

## 15. 测试

- 各平台的 URL 规则识别（mock 页面）
- 点击事件的 CDP 监听
- 浏览器关闭/网络断的会话暂停
- 同 profile 锁竞争
