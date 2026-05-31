# Spec 02 — 采集模块

> 浏览器辅助采集器。用户在比特浏览器里手动浏览跨境电商平台，腾域通过 CDP 扫描当前页图池、监听点击事件，并把商品图保存到本地。
> **不绕过登录、验证码、风控**。

## 1. 核心能力

| 子能力 | 说明 |
|---|---|
| **图池扫描** | 用户打开搜索页/列表页/商品详情页 → 扫描当前页可下载图片 → 进入图池 |
| **商品页主图采集** | 商品详情页只采集左侧主图/轮播图，按商品页分组保存 |
| **点击采集** | 用户点击某张图 → 保存原图到当次采集任务文件夹 |
| **滚动采集** | 用户滚动列表页 → 按规则自动保存图片到当次采集任务文件夹 |
| **平台绑定管理** | 一个采集平台关联一个比特浏览器 profile |
| **采集状态展示** | 实时显示当前页、图池数量、选择数量、扫描/下载结果 |
| **运行期日志** | 命令行式弹窗展示扫描、下载、点击采集和会话诊断日志 |
| **失败重试** | 用户从记录中触发单图重试 |
| **采集预览** | 展示最近保存图片、删除、打开所在文件夹 |

## 2. 内置采集平台

| Platform Key | 平台 | 商品 URL 规则示例 |
|---|---|---|
| `temu` | Temu | 含 `/search_result.html` 或 `-g-{goodsId}.html` |
| `ozon` | Ozon | 含 `/product/` |
| `shein` | Shein | 含 `-p-` |
| `tiktok` | TikTok Shop | 含 `/product/` |
| `shopee` | Shopee | 多区域，含 `/item/` 或 `-i.` |
| `1688` | 1688 | 含 `/offer/` |
| `mercado` | Mercado Libre | 含 `/MLB-` 或 `/p/MLB` |

各平台的 URL 规则、原图提取规则、登录辅助检测规则都由客户端本地维护，平台规则随客户端版本发布，详见 §12.1。

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
  └─ 否（列表页等）→ 落入当次采集任务文件夹 + 提示用户"未识别为商品页"
```

低打扰弹窗实现：不抢焦点，浮在右下角，2 分钟未操作折叠为 toast。

### 4.3 保存路径

```
{工作区}/01-采集工作区/{platform}-{YYYYMMDD-HHmmss}/
├─ {platform}-{YYYYMMDD-HHmmss}-001.jpg      ← 搜索页/列表页散图直接保存
├─ {platform}-{YYYYMMDD-HHmmss}-002.jpg
└─ 商品页/
    └─ {商品分组或采集货号}/
        ├─ {采集货号}-001.jpg               ← 文件名 = 货号-序号
        └─ {采集货号}-002.jpg
```

单次采集会话会创建一个任务文件夹。搜索页/列表页散图直接保存在任务文件夹；商品详情页图片再进入 `商品页/` 下的商品分组文件夹。

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

滚动采集的图直接进入当次采集任务文件夹，文件名含平台和时间。

```
01-采集工作区/{platform}-{YYYYMMDD-HHmmss}/{platform}-{YYYYMMDD-HHmmss}-{seq}.jpg
```

后期用户在 UI 上"批量归档" → 多选 → 指定货号 → 移到当次任务下的 `商品页/{采集货号}/`。

## 6. 图池扫描采集

图池扫描是当前采集模块的主入口。用户先在比特浏览器里打开目标页面，再回到腾域点“扫描图池”。扫描结果不会立刻写文件，而是先进入前端图池，用户勾选后再下载。

### 6.1 页面分类

| 页面 | 归类 | UI 展示 | 下载目录 |
|---|---|---|---|
| 搜索页/列表页 | `bucket = loose` | 散图平铺展示 | `01-采集工作区/{platform}-{timestamp}/` |
| 商品详情页 | `bucket = product` | 商品页文件夹展示，封面取第一张主图 | `01-采集工作区/{platform}-{timestamp}/商品页/<商品分组>` |
| 其他平台页 | `bucket = loose` 或平台默认规则 | 散图平铺展示 | `01-采集工作区/{platform}-{timestamp}/` |

### 6.2 商品详情页过滤

商品详情页只采集商品本体主图区域：

- 保留左侧缩略图和主轮播大图。
- 排除评论区、推荐商品、页面底部图片、右侧 SKU/颜色选择图片。
- Temu 商品分组优先使用 URL 中的 `-g-{goodsId}`，例如 `temu-g-601101959736135`。

### 6.3 图片 URL 升级

扫描阶段会尽量把 Temu 缩略图 URL 升级为高分辨率下载 URL：

```text
...?imageView2/2/w/180/q/70/... → ...?imageView2/2/w/1300/q/90/...
```

前端展示尺寸时只显示下载预估尺寸，例如 `下载约 1300x1300`，不显示页面上 `57x57` 这类缩略图尺寸。

### 6.4 下载策略

- 下载仍采用逐张串行下载，避免过高并发触发平台/CDN 限速或风控。
- 下载成功后从图池移除对应图片。
- 下载失败保留在图池中，并在日志里显示错误原因。
- 文件保存路径由扫描时的 `bucket`、`pageKind`、`groupKey` 决定，避免保存时再重新判断页面类型。

## 7. 平台规则（客户端内置 / 本地自定义）

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

腾域客户端启动时加载内置平台规则，并读取本地 `.workbench/cache/platform-rules.json` 中的自定义覆盖项。

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

## 8. 比特浏览器集成

### 8.1 连接

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

### 8.2 CDP 连接

```ts
// adapters/cdp.ts
import { chromium } from 'playwright-extra'

async function connectToProfile(profileId: string) {
  const { http } = await bitBrowser.openProfile(profileId)
  const browser = await chromium.connectOverCDP(http)
  return browser
}
```

### 8.3 注入采集脚本

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

## 9. UI 设计

### 9.1 图池采集面板

```
┌─ 图池采集 ──────────────────────────────────────┐
│ 搜索关键词 [米老鼠________] [打开搜索页]        │
│ 平台 [Temu]  浏览器环境 [1111]  任务目录 [自动创建] │
│ 当前页：搜索结果页 / 商品详情页 / 等待页面       │
│                                                │
│ [日志 12] [扫描图池] [全选] [取消选择] [清空]   │
│ [下载选中 8] [下载全部 42]                      │
│                                                │
│ 图池列表：                                      │
│ - 商品页：按文件夹展示，封面取第一张主图         │
│ - 散图：直接平铺展示图片                        │
└────────────────────────────────────────────────┘
```

### 9.2 运行期日志弹窗

```
┌─ 采集日志 ─────────────────────────────────────┐
│ [10:37:56.123] [INFO] [扫描] 开始扫描图池       │
│ [10:38:01.201] [INFO] [下载] 第 3/20 张成功     │
│                          · 420 KB · 1.2s        │
│ [10:38:07.901] [ERROR] [下载] 第 8/20 张失败    │
│                          · HTTP 403             │
│                                      [清空]     │
└────────────────────────────────────────────────┘
```

日志只保存在当前应用运行期间，不落盘；最多保留最近 `1000` 条。扫描日志显示页面级进度，下载日志显示逐张进度、文件大小、耗时、保存路径或错误原因。

### 9.3 低打扰提示场景

| 场景 | 提示 |
|---|---|
| 用户离开 platform 允许域 | toast "已暂停监听，回到 Temu 自动恢复" |
| 浏览器 profile 关闭 | toast "比特浏览器已关闭，会话暂停" |
| 主进程窗口关闭 | 会话标记为 paused，下次启动询问恢复 |
| 商品页未识别 | toast "当前不是商品页，图保存到本次采集任务文件夹" |
| 货号填写中 | 右下角浮窗，2 分钟未操作折叠 |

## 10. 采集记录与清单

### 10.1 数据库

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

### 10.2 导出清单

会话结束时自动导出 CSV 到当次采集任务文件夹：

```csv
sku_code,saved_path,source_url,goods_link,status,file_size,created_at
sku-001,01-采集工作区/temu-20260531-120000/商品页/sku-001/sku-001-001.jpg,https://...,https://...,success,234567,1716480000000
sku-001,01-采集工作区/temu-20260531-120000/商品页/sku-001/sku-001-002.jpg,...
...
```

## 11. 失败重试

UI 上有"查看失败"按钮 → 列出本次会话失败的图片：

```
| 图片 | 原因 | 商品链接 | 操作 |
| sku-001-003.jpg | HTTP 404 | https://... | [重试][删除] |
| sku-002-001.jpg | 文件大小为 0 | https://... | [重试][删除] |
```

重试逻辑：
- 简单重试：再次下载 source_url
- 多次失败：保存为 0-byte 占位，标记永久失败

## 12. 平台规则

采集平台规则当前由客户端内置维护。规则更新需要随客户端版本发布，避免规则和本地采集脚本版本错配。

后续如果要重新引入云端规则包，必须同时版本化采集脚本、平台规则和选择器 contract。

客户端按 version 比较，新版才更新本地。

### 12.2 不派发的

- 用户的 platform 自定义规则：仅本地
- 平台账号：永远不上传

## 13. 安全和敏感数据

**不保存**：
- 平台账号密码
- Cookie
- 订单/支付/聊天等业务数据

**保存**：
- 商品图片
- 商品链接（仅作为素材追溯）
- 采集货号

**审计**：
- 采集记录和 manifest 按本地保留策略保存
- 采集运行期日志只保存在前端内存中，不作为审计日志
- 用户可主动清理

## 14. IPC 接口

```ts
'collection:list-platforms'           → PlatformRule[]
'collection:list-profiles'            → BitBrowserProfile[]
'collection:get-current-page'         → { platform, profile_id } → CurrentPage
'collection:open-page'                → { platform, profile_id, page_url } → CurrentPage
'collection:start-session'            → { platform, profile_id, mode }
'collection:stop-session'             → { session_id }
'collection:get-active-session'       → CollectionSession | null
'collection:export-manifest'          → { session_id, format: 'csv' | 'json' }
'collection:retry-record'             → { record_id }
'collection:delete-record'            → { record_id }
'collection:scan-image-index'         → { platform, profile_id, page_url?, limit? } → ScanResult
'collection:probe-image-index-click'  → { platform, profile_id, page_url? } → ClickProbeResult
'collection:download-image-index-sample' → { platform, profile_id, page_url?, limit? } → DownloadResult
'collection:download-image-index-items'  → { platform, profile_id, items[] } → DownloadResult

// 事件
'collection:event'                    → { type, record?, entry? }
                                        // type: 'image-saved' | 'session-paused' | 'session-resumed' | 'debug-log'
```

## 15. 错误处理

| 错误码 | 触发 | 处理 |
|---|---|---|
| `BROWSER_NOT_CONNECTED` | 比特浏览器未启动 | UI 提示用户启动 |
| `PROFILE_LOCKED` | profile 被其他模块（上架）占用 | UI 提示用户先停掉冲突任务 |
| `LOGIN_REQUIRED` | 平台需要登录 | UI 提示用户在比特浏览器手动登录 |
| `PLATFORM_RULE_NOT_FOUND` | 平台规则缺失 | UI 提示检查本地规则版本或创建自定义 |
| `HTTP_4XX` | 未选择工作区，无法创建采集任务目录 | UI 提示用户先到设置页选择工作区 |

## 16. 测试

- 各平台的 URL 规则识别（mock 页面）
- 点击事件的 CDP 监听
- 浏览器关闭/网络断的会话暂停
- 同 profile 锁竞争
- 图池扫描：搜索页散图、商品详情页主图分组、Temu URL 高分辨率升级
- 图池下载：逐张成功/失败日志、保存目录区分、失败保留在图池
