# Spec 05 — PS 套版模块

> Windows-only。通过 COM 接口启动 Photoshop，动态生成 JSX 脚本替换 PSD 智能对象，输出按模板批次组织的成品图。
> v1 采用直接替换路径（路径 A），v1.5 加入进入 SO 编辑路径（路径 B）。

## 1. 平台约束

| 平台 | 套版可用性 | 实现方式 |
|---|---|---|
| Windows | ✅ | ActiveXObject('Photoshop.Application') COM |
| macOS | ❌ | UI 灰显，提示"PS 套版仅 Windows 可用" |

macOS 上模块面板：

```
┌─ PS 套版 ────────────────────────────────────┐
│ ⚠️ 此功能仅 Windows 可用                      │
│                                              │
│ 您在 Mac 上，请在 Windows 电脑使用此功能。     │
│ 其他模块（生图、检测、标题、上架）正常可用。   │
└─────────────────────────────────────────────┘
```

## 2. Photoshop 状态管理

### 2.1 三态检测

```ts
interface PhotoshopStatus {
  installed: boolean        // 注册表检测
  running: boolean          // 进程列表检测
  com_connected: boolean    // 试调 Application.Version
  version: string | null
  last_check_at: number
}

class PhotoshopStatusChecker {
  async check(): Promise<PhotoshopStatus> {
    const installed = await this.checkInstalled()
    const running = await this.checkRunning()
    const com_connected = running ? await this.tryConnectCom() : false
    return { installed, running, com_connected, version: ... }
  }
  
  private async checkInstalled(): Promise<boolean> {
    // Windows 注册表
    // HKLM\SOFTWARE\Adobe\Photoshop\<ver>\ApplicationPath
    // 用 registry-js 或 winreg
  }
  
  private async checkRunning(): Promise<boolean> {
    // 进程列表查 Photoshop.exe
    // 用 ps-list 或 tasklist
  }
  
  private async tryConnectCom(): Promise<boolean> {
    try {
      // 通过 winax 或 node-ffi 调 COM
      const app = new ActiveXObject('Photoshop.Application')
      const version = app.version
      return true
    } catch (e) {
      return false
    }
  }
}
```

### 2.2 UI 状态栏

```
PS 套版面板顶部：
┌────────────────────────────────────────────────────────┐
│ Photoshop 状态：● 已连接 (v2025)                        │
│ COM 连接：● 正常                                       │
│ [刷新状态] [启动 PS] [尝试修复 COM]                     │
└────────────────────────────────────────────────────────┘

不同状态：
✅ 三绿灯（已安装 + 运行中 + COM 已连）→ 允许启动套版任务
⚠️ 已安装 + 未运行 → [启动 PS] 按钮
⛔ 未安装 → 提示用户安装 Photoshop CC 2018+
⛔ 运行但 COM 失败 → [尝试修复 COM] 按钮（详见 §2.3）
```

### 2.3 COM 修复

```ts
async function tryFixCom(): Promise<boolean> {
  // 1. 检查 Photoshop 是否正确注册 ActiveX
  // 2. 尝试用 regsvr32 重新注册（需管理员权限）
  // 3. 如果失败，提示用户以管理员身份启动 PS
  
  // 简化实现：弹窗指导用户手动操作
  showDialog({
    title: 'COM 连接失败',
    message: '请关闭所有 Photoshop 实例，然后右键 Photoshop 图标 → "以管理员身份运行"。运行一次后即可恢复 COM 注册。',
    actions: [{ label: '我已按指引操作', handler: () => recheckStatus() }],
  })
}
```

## 3. PSD 模板扫描

### 3.1 扫描流程

```
用户选 PSD → 检查 hash 缓存 → 命中则用缓存，否则跑扫描 JSX
                                ↓
                              动态生成扫描 JSX：
                              - 打开 PSD
                              - 遍历图层，找智能对象
                              - 检测嵌套/共享
                              - 提取参考线
                              - 推导裁切区
                              - 写结果到临时 JSON
                              - 关闭 PSD（不保存）
                                ↓
                              主进程读 JSON → 存数据库
```

### 3.2 扫描 JSX 模板

```jsx
// 动态生成，关键逻辑：
function scanPsd(psdPath) {
  app.preferences.rulerUnits = Units.PIXELS
  var doc = app.open(new File(psdPath))
  var result = {
    file: psdPath,
    doc_size: { w: doc.width.value, h: doc.height.value },
    smart_objects: [],
    guides: { horizontal: [], vertical: [] },
    clip_areas: [],
  }
  
  // 递归遍历图层
  function walk(layers, path) {
    for (var i = 0; i < layers.length; i++) {
      var l = layers[i]
      if (l.typename === 'ArtLayer' && l.kind === LayerKind.SMARTOBJECT) {
        result.smart_objects.push({
          name: l.name,
          path: path + l.name,
          sort_order: i,
          is_top_level: path === '',
          bounds: [l.bounds[0].value, l.bounds[1].value, l.bounds[2].value, l.bounds[3].value],
          shared_indicator: getSmartObjectId(l),  // 用 layer id 等推断共享关系
        })
      } else if (l.typename === 'LayerSet') {
        walk(l.layers, path + l.name + '/')
      }
    }
  }
  walk(doc.layers, '')
  
  // 参考线
  for (var i = 0; i < doc.guides.length; i++) {
    var g = doc.guides[i]
    if (g.direction === Direction.HORIZONTAL) {
      result.guides.horizontal.push(g.coordinate.value)
    } else {
      result.guides.vertical.push(g.coordinate.value)
    }
  }
  
  // 推导裁切区（按参考线划分网格）
  result.clip_areas = deriveClipAreasFromGuides(result.guides, result.doc_size)
  
  // 写结果到临时 JSON
  var f = new File($.resultFilePath)
  f.open('w')
  f.write(JSON.stringify(result))
  f.close()
  
  doc.close(SaveOptions.DONOTSAVECHANGES)
}

try { scanPsd($.psdPath) } catch (e) {
  var f = new File($.resultFilePath)
  f.open('w')
  f.write(JSON.stringify({ error: e.message }))
  f.close()
}
```

### 3.3 共享智能对象的判断

PS 中两个 SO 图层可能指向同一个外部源（链接的智能对象）或同一个嵌入源。判断方式：

```jsx
function getSmartObjectId(layer) {
  // 用 Action Manager 读 layer 的 placedLayerOrigin 或 linkedFileID
  // 简化：用 layer.bounds + name 哈希做粗略判断
  // 精确判断 v1.5 再做
}
```

v1 简化：**bounds 完全一致** + **图层名相同（去尾号）** → 视为共享。复杂场景在 UI 上提示用户"此模板含可能的共享 SO，建议人工确认"。

### 3.4 智能对象模式识别

```ts
type SmartObjectMode = 'single' | 'shared' | 'independent' | 'none'

function detectMode(smartObjects: SmartObject[]): SmartObjectMode {
  if (smartObjects.length === 0) return 'none'
  if (smartObjects.length === 1) return 'single'
  
  const sharedIds = new Set(smartObjects.map(so => so.shared_indicator))
  if (sharedIds.size < smartObjects.length) return 'shared'
  
  return 'independent'
}
```

### 3.5 代表智能对象数

```ts
function representativeSoCount(scanResult: ScanResult, range: 'auto' | 'top' | 'all'): number {
  const tops = scanResult.smart_objects.filter(so => so.is_top_level)
  
  if (range === 'top') return tops.length
  if (range === 'all') {
    // 去重（共享 SO 算一个）
    const uniqueIds = new Set(scanResult.smart_objects.map(so => so.shared_indicator))
    return uniqueIds.size
  }
  // auto
  if (tops.length > 0) return tops.length
  const uniqueIds = new Set(scanResult.smart_objects.map(so => so.shared_indicator))
  return uniqueIds.size
}
```

## 4. 替换范围 / 适配 / 裁切

### 4.1 替换范围

| 选项 | 行为 |
|---|---|
| `auto` | 优先用顶层 SO，否则用全部 |
| `top` | 仅顶层 SO |
| `all` | 全部 SO（含嵌套）|

### 4.2 适配方式

| 选项 | 行为 |
|---|---|
| `fill` | 输入图铺满 SO 边界（可能裁切）|
| `fit` | 输入图完整显示在 SO 内（可能留白）|
| `center` | 输入图按原大小居中（不缩放）|

实现：用路径 A 的 `placedLayerReplaceContents` 时，PS 默认行为是按 SO 原变换（一般是 fit）。要精确控制需要路径 B（v1.5）。

**v1 限制**：仅 `fit`（PS 默认行为）。`fill` 和 `center` 在 v1.5 路径 B 中实现。

UI 上标注："v1 仅支持 fit 模式，fill/center 在 v1.5 推出"。

### 4.3 裁切模式

| 选项 | 行为 |
|---|---|
| `none` | 整张导出 |
| `auto` | 按参考线自动推导裁切区 |
| `guides` | 强制按参考线裁切 |

`auto` 规则：
1. 优先用 PSD 参考线推导
2. 没有参考线 → 用智能对象祖先分组的 bounds 推导
3. 都没有 → 退化为 `none`

```ts
function deriveClipAreas(scanResult: ScanResult, mode: ClipMode): ClipArea[] {
  if (mode === 'none') return [{ x: 0, y: 0, w: scanResult.doc_size.w, h: scanResult.doc_size.h }]
  if (mode === 'guides' || mode === 'auto') {
    const grid = buildGridFromGuides(scanResult.guides, scanResult.doc_size)
    if (grid.length > 0) return grid
  }
  if (mode === 'auto') {
    return deriveFromSoBounds(scanResult.smart_objects)
  }
  return [{ x: 0, y: 0, w: scanResult.doc_size.w, h: scanResult.doc_size.h }]
}
```

## 5. 任务分组

```
代表 SO 数 = N
输入印花数 = M

分组规则：
  - N = 1 → 每张图独立一组（M 组）
  - N > 1 → 按 N 张图一组（ceil(M/N) 组），最后一组可能不足 N 张
  
  v1 分组顺序：按印花文件名字典序自然排序
  v1.5 支持手动拖拽分组
```

### 5.1 自然排序

```ts
function sortAlphaNum(a: string, b: string): number {
  // 让 "img2" 排在 "img10" 前
  const aChunks = a.split(/(\d+)/)
  const bChunks = b.split(/(\d+)/)
  for (let i = 0; i < Math.min(aChunks.length, bChunks.length); i++) {
    const aNum = parseInt(aChunks[i], 10)
    const bNum = parseInt(bChunks[i], 10)
    if (!isNaN(aNum) && !isNaN(bNum)) {
      if (aNum !== bNum) return aNum - bNum
    } else {
      const cmp = aChunks[i].localeCompare(bChunks[i])
      if (cmp !== 0) return cmp
    }
  }
  return aChunks.length - bChunks.length
}
```

## 6. 多模板批次

### 6.1 输入

```
用户选印花文件夹（如 02-印花工作区/）
  + 选 N 个 PSD 模板（多选）
  + 配置（适配/裁切/格式/重试）
  + 点开始
```

### 6.2 输出

```
04-上架工作区/
├─ {模板1名}/                       ← 每个模板一个一级目录（"模板批次"）
│   ├─ {印花1名}/                   ← 货号文件夹
│   │   ├─ 01.jpg
│   │   ├─ 02.jpg                  ← 多裁切区域时多张
│   │   └─ ...
│   ├─ {印花2名}/
│   └─ titles.xlsx                  ← 标题模块写入
├─ {模板2名}/
│   ├─ {印花1名}/
│   └─ ...
└─ ...
```

### 6.3 模板名清洗

```ts
function sanitizeTemplateName(psdFilename: string): string {
  // mockup-white-tshirt-front.psd → mockup-white-tshirt-front
  return path.basename(psdFilename, path.extname(psdFilename))
    .replace(/[<>:"/\\|?*]/g, '_')
    .trim()
    .substring(0, 60)
}
```

## 7. JSX 动态生成（路径 A，v1）

```jsx
// 动态生成的套版 JSX 模板
$.config = ${JSON.stringify(jobConfig)}
$.resultFilePath = "${escapeJsxPath(resultFilePath)}"

function runJob() {
  app.preferences.rulerUnits = Units.PIXELS
  var result = { stages: [] }
  
  try {
    // 1. 打开 PSD
    var mockup = app.open(new File($.config.mockup_path))
    result.stages.push({ stage: 'open_mockup', ok: true })
    
    // 2. 对每个 SO 替换
    for (var i = 0; i < $.config.so_replacements.length; i++) {
      var rep = $.config.so_replacements[i]
      var layer = findLayerByPath(mockup, rep.layer_path)
      if (!layer) {
        result.stages.push({ stage: 'find_layer', ok: false, layer: rep.layer_path })
        continue
      }
      
      mockup.activeLayer = layer
      
      // 路径 A：直接替换
      var desc = new ActionDescriptor()
      desc.putPath(charIDToTypeID('null'), new File(rep.input_image))
      executeAction(stringIDToTypeID('placedLayerReplaceContents'), desc, DialogModes.NO)
      
      result.stages.push({ stage: 'replace_so', ok: true, layer: rep.layer_path, input: rep.input_image })
    }
    
    // 3. 导出
    if ($.config.clip_areas.length === 1 && $.config.clip_areas[0].is_full) {
      // 整张导出
      saveAs(mockup, $.config.output_paths[0], $.config.format, $.config.jpg_quality)
    } else {
      // 多裁切区域：复制 → 裁切 → 导出
      for (var j = 0; j < $.config.clip_areas.length; j++) {
        var area = $.config.clip_areas[j]
        var dup = mockup.duplicate()
        dup.crop([area.x, area.y, area.x + area.w, area.y + area.h])
        saveAs(dup, $.config.output_paths[j], $.config.format, $.config.jpg_quality)
        dup.close(SaveOptions.DONOTSAVECHANGES)
      }
    }
    
    result.stages.push({ stage: 'export', ok: true })
    mockup.close(SaveOptions.DONOTSAVECHANGES)
    result.ok = true
  } catch (e) {
    result.ok = false
    result.error = e.toString()
    try { app.activeDocument.close(SaveOptions.DONOTSAVECHANGES) } catch (e2) {}
  }
  
  // 写结果回主进程
  var f = new File($.resultFilePath)
  f.open('w')
  f.write(JSON.stringify(result))
  f.close()
}

function findLayerByPath(doc, layerPath) {
  var parts = layerPath.split('/')
  var current = doc
  for (var i = 0; i < parts.length; i++) {
    var name = parts[i]
    if (i === parts.length - 1) {
      try { return current.artLayers.getByName(name) } catch (e) {}
      try { return current.layerSets.getByName(name) } catch (e) {}
      return null
    } else {
      try { current = current.layerSets.getByName(name) } catch (e) { return null }
    }
  }
  return null
}

function saveAs(doc, outputPath, format, jpgQuality) {
  // 确保父目录存在
  // ... 创建目录代码
  if (format === 'jpg') {
    var opts = new JPEGSaveOptions()
    opts.quality = jpgQuality || 10
    doc.saveAs(new File(outputPath), opts, true, Extension.LOWERCASE)
  } else if (format === 'png') {
    var opts = new PNGSaveOptions()
    doc.saveAs(new File(outputPath), opts, true, Extension.LOWERCASE)
  }
}

runJob()
```

## 8. 主进程调度

```ts
// adapters/photoshop.ts
class PhotoshopAdapter {
  private mutex = new Mutex()  // PS 串行
  
  async runJob(job: PhotoshopJob): Promise<JobResult> {
    return await this.mutex.runExclusive(async () => {
      // 1. 准备临时目录
      const tempDir = await tempFileManager.createTaskDir('photoshop', job.task_id)
      const jsxPath = path.join(tempDir, `job-${job.group_index}.jsx`)
      const resultPath = path.join(tempDir, `job-${job.group_index}-result.json`)
      
      // 2. 生成 JSX
      const jsxContent = renderJsxTemplate({
        mockup_path: job.mockup_path,
        so_replacements: job.so_replacements,
        clip_areas: job.clip_areas,
        output_paths: job.output_paths,
        format: job.format,
        jpg_quality: job.jpg_quality,
      })
      await fs.writeFile(jsxPath, jsxContent, 'utf-8')
      
      // 3. 调用 PS COM
      const psApp = this.getActiveXObject('Photoshop.Application')
      psApp.DoJavaScriptFile(jsxPath, undefined, undefined)
      
      // 4. 读结果
      const resultJson = await fs.readFile(resultPath, 'utf-8')
      const result = JSON.parse(resultJson)
      
      // 5. 校验输出文件存在
      const outputsExist = await Promise.all(
        job.output_paths.map(p => fs.access(p).then(() => true).catch(() => false))
      )
      
      if (result.ok && outputsExist.every(Boolean)) {
        return { ok: true, outputs: job.output_paths }
      } else {
        throw new AppError({
          code: 'JSX_EXEC_FAILED',
          message: result.error ?? '导出文件缺失',
          details: result,
        })
      }
    })
  }
}
```

## 9. 跳过已完成

```ts
async function shouldSkipJob(job: PhotoshopJob): Promise<boolean> {
  // 1. 数据库查 task + step 是否已完成
  const existing = await db.workflow_steps.findFirst({
    where: {
      module: 'photoshop',
      status: 'completed',
      // metadata 里有 job_signature
    },
  })
  if (!existing) return false
  
  // 2. 检查物理文件存在
  const allExist = await Promise.all(
    job.output_paths.map(p => fs.access(p).then(() => true).catch(() => false))
  )
  if (!allExist.every(Boolean)) return false
  
  // 3. 检查文件 hash（防止意外修改）
  const expectedHashes = await db.artifacts.findMany({
    where: { file_path: { in: job.output_paths }},
  })
  for (const hash of expectedHashes) {
    const actual = await hashFile(hash.file_path)
    if (actual !== hash.file_hash) return false
  }
  
  return true
}
```

UI 上 [跳过已完成] toggle，默认开。

## 10. 失败重试

```ts
async function runJobWithRetry(job: PhotoshopJob, maxRetries: number) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await photoshopAdapter.runJob(job)
      await db.workflow_steps.update({
        id: job.step_id,
        status: 'completed',
        attempt,
      })
      return result
    } catch (e) {
      const error = classifyError(e)
      if (!error.retryable || attempt === maxRetries) {
        await db.workflow_steps.update({
          id: job.step_id,
          status: 'failed',
          attempt,
          error_json: JSON.stringify(error),
        })
        throw e
      }
      // 指数退避
      await sleep(2 ** attempt * 1000)
    }
  }
}
```

按失败类型重试策略：

| 错误类型 | 可重试 | 备注 |
|---|---|---|
| COM 断连 | ✅ | 重连 PS |
| JSX 报错（语法/逻辑）| ❌ | 代码 bug，需修复 |
| SO 不存在 | ❌ | 模板配置错，提示用户 |
| 文件 IO 失败 | ✅ | 重试 |
| 输出校验失败 | ✅ | 重试 |
| PS 无响应（超时）| ✅ | 杀进程重启 |

## 11. 进度与日志

### 11.1 进度面板

```
[执行进度]
┌──────────────────────────────────────────────┐
│ 模板：mockup_white_tshirt.psd                │
│ 总分组：30                                    │
│ 完成：15  失败：1  跳过：2                     │
│ 当前：处理 "印花A.png" (5/8)                  │
│ 进度：50%                                     │
│ 已验证输出：47 / 90                           │
│ 预计剩余：3 分钟                              │
│                                              │
│ [暂停] [取消] [查看日志]                      │
└──────────────────────────────────────────────┘
```

### 11.2 结构化日志

```
.workbench/logs/photoshop-{taskId}.log

{"ts":1716480000000,"level":"info","stage":"task_start","group":1,"inputs":["印花A.png"],"template":"mockup_v1.psd"}
{"ts":1716480001000,"level":"debug","stage":"jsx_generate","ok":true,"path":"/tmp/job-01.jsx"}
{"ts":1716480007000,"level":"info","stage":"jsx_exec","ok":true,"exit":0,"duration_ms":6200}
{"ts":1716480008000,"level":"info","stage":"output_verify","ok":true,"files":3}
{"ts":1716480008500,"level":"info","stage":"group_complete","group":1}
```

字段：`ts, level, stage, group, input, attempt, output_file, error, duration_ms`

## 12. 预览

任务完成后右侧面板：

```
完成 ✅ 28 / 30
失败 ⛔ 1 / 30  [查看失败]
跳过 ⏭️ 1 / 30

[缩略图网格 - 按货号]
┌─────┐ ┌─────┐ ┌─────┐
│SKU1 │ │SKU2 │ │SKU3 │  ...
│ 3张 │ │ 3张 │ │ 3张 │
└─────┘ └─────┘ └─────┘

点击货号卡片 → 弹出该货号所有图片
双击图片 → 系统默认应用打开
```

## 13. 数据库

```sql
CREATE TABLE psd_templates (
  id              TEXT PRIMARY KEY,
  file_path       TEXT NOT NULL,
  file_hash       TEXT NOT NULL,
  doc_size_w      INTEGER NOT NULL,
  doc_size_h      INTEGER NOT NULL,
  smart_objects   TEXT NOT NULL,                   -- JSON
  guides          TEXT NOT NULL,                   -- JSON
  clip_areas      TEXT NOT NULL,                   -- JSON
  mode            TEXT NOT NULL,                   -- 'single' | 'shared' | 'independent' | 'none'
  representative_so_count INTEGER NOT NULL,
  scanned_at      INTEGER NOT NULL,
  UNIQUE(file_hash)
);

-- photoshop 任务的 artifacts 行
-- step = 'mockup'
-- provider = 'photoshop'
-- model_or_workflow = '{template_filename}'
-- params_snapshot = JSON: { template_id, mode, format, clip_mode, ... }
```

## 14. IPC 接口

```ts
'photoshop:get-status'                → PhotoshopStatus
'photoshop:fix-com'                   → { ok: boolean; message?: string }
'photoshop:launch-app'                → void
'photoshop:scan-template'             → { psd_path } → PsdTemplate
'photoshop:list-cached-templates'     → PsdTemplate[]
'photoshop:run-job'                   → {
                                          input_dir: string,
                                          templates: string[],
                                          replace_range: 'auto' | 'top' | 'all',
                                          adapt_mode: 'fill' | 'fit' | 'center',
                                          format: 'jpg' | 'png',
                                          jpg_quality: number,
                                          clip_mode: 'none' | 'auto' | 'guides',
                                          skip_completed: boolean,
                                          max_retries: number,
                                          output_root: string,                  // 默认 04-上架工作区
                                        } → TaskId

'photoshop:get-progress'              → { task_id } → ProgressInfo
'photoshop:pause'                     → { task_id } → void
'photoshop:cancel'                    → { task_id } → void
'photoshop:export-logs'               → { task_id } → { zip_path }
```

## 15. 错误处理

| 错误码 | 触发 | UI 处理 |
|---|---|---|
| `PS_NOT_INSTALLED` | 注册表未找到 | 提示用户安装 PS CC 2018+ |
| `PS_NOT_RUNNING` | 进程不存在 | [启动 PS] 按钮 |
| `PS_COM_FAILED` | COM 注册问题 | [尝试修复 COM] 指引 |
| `TEMPLATE_NESTED_SO_UNSUPPORTED` | v1 检测到嵌套 SO | UI 提示"v1 不完整支持，预期 v1.5"，继续跑但标黄 |
| `JSX_EXEC_FAILED` | JSX 报错 | 看错误详情，分类重试或放弃 |
| `OUTPUT_VERIFY_FAILED` | 文件缺失或 hash 不对 | 重试 |
| `TEMPLATE_SCAN_FAILED` | PSD 损坏或解析失败 | 提示用户检查模板 |

## 16. 性能预算

| 操作 | 预算 |
|---|---|
| PSD 模板扫描（首次）| < 10 秒 |
| PSD 模板扫描（缓存命中）| < 100 ms |
| 单个任务组（1 个 SO 替换 + JPG 导出）| < 30 秒 |
| 批量 30 个货号 | < 15 分钟 |

## 17. v1 → v1.5 演进

| 项 | v1 | v1.5 |
|---|---|---|
| SO 替换 | 路径 A（placedLayerReplaceContents）| + 路径 B（placedLayerEditContents + Plc）|
| 适配模式 | 仅 fit | + fill / center |
| 嵌套 SO | 检测到提示，效果有限 | 递归处理 |
| 共享 SO | 检测到提示 | 单次替换全部生效 |
| 任务分组 | 字典序自动 | + 手动拖拽 |
| 输出格式 | JPG / PNG | + TIF / PSD / PDF |

## 18. 借鉴的开源项目

详见 [../../references/photoshop/open-source-references.md](../../references/photoshop/open-source-references.md)：

- **xKeNcHii/Mockup-Automation-Script** (102 行) — 路径 A 的极简实现，v1 直接借鉴
- **joonaspaakko/Batch-Mockup-Smart-Object-Replacement** (1066 行) — 路径 B 的完整实现，v1.5 借鉴

不直接 port 代码，但抄关键 Action ID 和算法。

## 19. 测试

- PSD 模板扫描各种情况（嵌套/共享/无 SO/含 3D）
- COM 启动失败的修复流程
- JSX 生成的语法正确性
- 输出文件名清洗（中文、特殊字符）
- 多裁切区域的复制 + crop 流程
- 大批量任务的内存稳定性（连续跑 100 个货号）
