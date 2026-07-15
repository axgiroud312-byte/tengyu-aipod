# PS 智能对象替换 - 开源项目参考（腾域 aipod 集成版）

> 抓取自 GitHub 于 2026-05-23。
> 本文档分析两个成熟开源 JSX 项目，提取**腾域 PS 套版模块的核心实现路径**。

## 参考项目

| 项目 | Stars | 行数 | 成熟度 | 链接 |
|---|---|---|---|---|
| **joonaspaakko/Batch-Mockup-Smart-Object-Replacement** | 122 | 1066 行 | 高（处理嵌套 SO、共享 SO、对齐、缩放、多格式输出）| [GitHub](https://github.com/joonaspaakko/Batch-Mockup-Smart-Object-Replacement-photoshop-script) [文档站](https://joonaspaakko.gitbook.io/batch-mockup-smart-object-replacement-jsx-photosho/) |
| **xKeNcHii/Mockup-Automation-Script** | 36 | 102 行 | 极简（单 SO 直接替换，带 ScriptUI 对话框）| [GitHub](https://github.com/xKeNcHii/Mockup-Automation-Script) |

---

## 1. 两种 SO 替换的核心 JSX 模式

PS 替换智能对象有**两条技术路径**，两个开源项目刚好各代表一条：

### 路径 A：直接替换内容（xKeNcHii 用的，最简）

```jsx
// 选中 SO 图层后：
var idplacedLayerReplaceContents = stringIDToTypeID("placedLayerReplaceContents");
var desc = new ActionDescriptor();
desc.putPath(charIDToTypeID("null"), new File(imageFilePath));
executeAction(idplacedLayerReplaceContents, desc, DialogModes.NO);
```

- ✅ 简单：一个 action 搞定
- ✅ 保留原 SO 的变换（旋转、透视、缩放）
- ❌ 无法控制图像在 SO 内的位置和大小（用啥就是啥）
- ❌ 不能拍平原内容

**适合场景**：标准 mockup（白T 印花、马克杯印花），输入图正常即可。

### 路径 B：进入 SO 编辑（joonaspaakko 用的，复杂）

```jsx
// 1. 链接 SO 转嵌入式（防止链接外部文件丢失）
executeAction(stringIDToTypeID("placedLayerConvertToEmbedded"), undefined, DialogModes.NO);

// 2. 进入 SO 编辑（打开 SO 内部为新文档）
executeAction(stringIDToTypeID("placedLayerEditContents"), new ActionDescriptor(), DialogModes.NO);

// 3. 拍平 SO 内的原内容
executeAction(stringIDToTypeID("flattenImage"), undefined, DialogModes.NO);

// 4. 用 Plc 置入新图（带对齐/抗锯齿/链接属性）
var idPlc = charIDToTypeID("Plc ");
var desc = new ActionDescriptor();
desc.putInteger(charIDToTypeID("Idnt"), 9999);
desc.putPath(charIDToTypeID("null"), new File(imageFilePath));
// 设置偏移、抗锯齿、链接等
desc.putBoolean(charIDToTypeID("AntA"), true);
desc.putBoolean(charIDToTypeID("Lnkd"), true);
executeAction(idPlc, desc, DialogModes.NO);

// 5. 保存关闭 SO 文档（回到主文档）
soDoc.close(SaveOptions.SAVECHANGES);
```

- ✅ 完全控制 SO 内部内容（拍平 + 置入 + 缩放 + 对齐）
- ✅ 处理嵌套 SO（SO 内套 SO）
- ✅ 处理透明边缘（trimTransparency 选项）
- ❌ 复杂、易出错（多次 enter/exit SO 编辑）

**适合场景**：复杂 mockup（嵌套智能对象、共享 SO、需精确控制图像填充方式）。

### 腾域决策：**v1 默认路径 A，可选基础路径 B**

- **v1**：mockup 默认走 `placedLayerReplaceContents`；300dpi 链接智能对象模板可显式选择基础路径 B，支持内部置入和 fill/fit
- **当检测到 SO 嵌套或共享时**：UI 仍提示高级处理尚未支持
- **v1.5**：增加嵌套递归、共享源去重和 center 对齐等高级能力

该时间安排已由 ADR-0018 更新；本文的外部实现调研结论不变。

---

## 2. 关键 Action ID 速查表

腾域生成 JSX 时常用的 Action：

| 用途 | Action ID | 类型 |
|---|---|---|
| 链接 SO 转嵌入 | `placedLayerConvertToEmbedded` | string |
| 直接替换 SO 内容 ⭐ | `placedLayerReplaceContents` | string |
| 进入 SO 编辑 | `placedLayerEditContents` | string |
| 退出 SO 编辑 | （关闭 SO 文档自动） | - |
| 拍平所有图层 | `flattenImage` | string |
| 置入图像 | `Plc ` | charID（4 字符带空格）|
| 选中所有图层 | `selectAllLayers` | string |
| 新建 SO | `newPlacedLayer` | string |
| 修剪透明边 | `trim` | string |

### Action 描述符常用键

| 键 | charID | 用途 |
|---|---|---|
| 路径 | `null` | 文件路径（File 对象）|
| 标识 | `Idnt` | 数字标识 |
| 水平偏移 | `Hrzn` | 像素 |
| 垂直偏移 | `Vrtc` | 像素 |
| 像素单位 | `#Pxl` | 单位类型 |
| 抗锯齿 | `AntA` | bool |
| 链接 | `Lnkd` | bool（true = 作为智能对象） |
| 自由变换 | `FTcs` | enum |
| 偏移 | `Ofst` | object（含 Hrzn/Vrtc）|

---

## 3. joonaspaakko 项目的高级模式（v1.5 可借鉴）

### 3.1 数据驱动批量配置

```jsx
mockups([
  {
    output: { path: '$/_output', format: 'jpg', jpgQuality: 12 },
    mockupPath: '$/mockup/file.psd',           // 或文件夹（处理所有 PSD）
    mockupNested: false,                       // 是否处理子文件夹
    showLayers: ['有印花的'],                  // 显示某些图层
    hideLayers: ['示意水印'],                  // 隐藏某些图层
    input: '$/shared-input',                   // 整个 mockup 的共享输入池
    inputNested: false,
    smartObjects: [
      {
        target: 'SO图层名',                    // 或图层路径
        input: '$/input',                       // 每 SO 独立输入序列
        trimTransparency: true,                // 处理透明
        align: 'middle-center',                // 对齐
        resize: 'fit',                          // 缩放：fit/fill/none
        nestedTarget: '嵌套SO图层名'           // 嵌套 SO 支持
      }
    ]
  }
]);
```

腾域可以**对这套配置 JSON 化**，让主进程动态生成 JSX 而不需要用户写 JSX。

### 3.2 输出命名占位符

joonaspaakko 用 `@input` 和 `@mockup` 占位符：
```
filename: '@input'                           // → 用输入图文件名
filename: '@mockup - @input'                 // → "mockup名 - 输入名"
filename: '@input/@mockup - @input'          // → 创建文件夹结构
```

腾域可借鉴：货号文件夹命名用 `{input}`，文件命名用 `{seq}.{ext}`。

### 3.3 文件名自然排序（CS6 兼容）

```jsx
function sortAlphaNum(a, b) {
  // 把 "img2" 排在 "img10" 前面（自然排序）
  // 完整实现见 joonaspaakko 项目第 334 行
}
```

腾域可直接抄过来（Node.js 端也要做这个排序）。

### 3.4 智能对象嵌套递归

joonaspaakko 用 `nestedTarget` 处理"SO 内套 SO"的复杂情况：
- 进入外层 SO → 找内层 SO → 再进入 → 替换 → 一层层退出保存

腾域 v1 不做这层，**让 PSD 扫描时检测到嵌套 SO 直接标记"v1 不支持"**，用户用别的模板。

### 3.5 align + resize 实现

joonaspaakko 用 `placedLayerEditContents` 进入 SO 后：
1. 量出 SO 内文档尺寸
2. 对比输入图原尺寸
3. 用 `calculateNewSize` 算缩放百分比
4. 应用 transform

腾域 v1 的基础路径 B 已借鉴该思路实现 fill/fit；center 和更复杂的对齐参数仍留在 v1.5。

---

## 4. xKeNcHii 项目的极简模式（v1 直接借鉴）

xKeNcHii 整个 JSX 102 行的核心逻辑：

```jsx
function processImage(imageFile, mockupFile, outputFolder) {
  var mockup = app.open(mockupFile);                    // 1. 打开 PSD
  
  // 2. 替换当前 active SO 的内容（注意：脚本前提是 PSD 打开时 active layer 是目标 SO）
  var idReplace = stringIDToTypeID("placedLayerReplaceContents");
  var desc = new ActionDescriptor();
  desc.putPath(charIDToTypeID("null"), new File(imageFile));
  executeAction(idReplace, desc, DialogModes.NO);
  
  // 3. 保存为 JPG
  var outputFile = new File(outputFolder + "/" + mockupFile.displayName.replace(/\.psd$/i, "") + "_" + Date.now() + "_" + imageFile.name);
  var opts = new JPEGSaveOptions();
  opts.quality = 12;
  mockup.saveAs(outputFile, opts, true, Extension.LOWERCASE);
  
  // 4. 关闭不保存
  mockup.close(SaveOptions.DONOTSAVECHANGES);
}
```

**腾域 v1 抄这个核心**，但要增强：
- 多个 SO：先选中具体 SO（按图层名找）再 replaceContents
- 多个 mockup × 多个输入图的笛卡尔积循环
- 输出文件名按腾域命名规范（不带 timestamp）
- 调用前关掉 PS 的"Maximize PSD Compatibility"对话框

---

## 5. 腾域集成要点

### 5.1 在哪个模块使用
`pod-workbench/src/modules/photoshop/`

### 5.2 JSX 生成策略

**主进程动态生成 JSX**（不内嵌固定脚本），每个任务组生成一份独立 JSX：

```ts
// TypeScript 主进程伪代码
function generateJsx(group: TaskGroup): string {
  return `
    // 自动生成 by 腾域 aipod 于 ${new Date()}
    try {
      var mockup = app.open(new File("${group.mockupPath}"));
      ${group.smartObjects.map(so => `
        // 替换 SO: ${so.name}
        var layer = findLayerByName("${so.name}");
        if (layer) {
          app.activeDocument.activeLayer = layer;
          var d = new ActionDescriptor();
          d.putPath(charIDToTypeID("null"), new File("${so.inputImagePath}"));
          executeAction(stringIDToTypeID("placedLayerReplaceContents"), d, DialogModes.NO);
        }
      `).join('\n')}
      
      // 导出
      var saveOpts = new JPEGSaveOptions(); saveOpts.quality = 12;
      mockup.saveAs(new File("${group.outputPath}"), saveOpts, true, Extension.LOWERCASE);
      
      // 写结果文件回传
      writeResult({ status: "ok", output: "${group.outputPath}" });
      mockup.close(SaveOptions.DONOTSAVECHANGES);
    } catch(e) {
      writeResult({ status: "fail", error: e.message });
    }
    
    function writeResult(obj) {
      var f = new File("${group.resultFilePath}");
      f.open("w"); f.write(JSON.stringify(obj)); f.close();
    }
    
    function findLayerByName(name) { /* 递归找图层 */ }
  `;
}
```

### 5.3 调用流程

```
1. 加载 PSD 模板 → 扫描智能对象（记录图层路径、名称、是否嵌套/共享）
2. 用户在 UI 上选印花目录 + 模板 + 适配/裁切配置
3. 任务编排：按代表 SO 数把印花分组
4. 对每个组：
   a. 主进程生成 JSX → 落到 .workbench/tmp/photoshop/{taskId}/job-N.jsx
   b. 调用 PS COM: app.DoJavaScriptFile(jsxPath, "", false)
   c. JSX 执行完写结果到 .workbench/tmp/photoshop/{taskId}/job-N-result.json
   d. 主进程读结果 → 数据库登记 + 进度更新
5. 全部完成 → 临时 JSX 文件清理
```

### 5.4 PSD 扫描脚本

也是动态 JSX，扫描后写结果到临时文件：

```jsx
function scanSmartObjects(doc) {
  var result = [];
  function walk(layers, path) {
    for (var i=0; i<layers.length; i++) {
      var l = layers[i];
      if (l.kind === LayerKind.SMARTOBJECT) {
        result.push({
          name: l.name,
          path: path + l.name,
          is_top_level: path === "",
          // 检测共享：kind/size 等指纹
          shared_indicator: getShared(l)
        });
      } else if (l.typename === "LayerSet") {
        walk(l.layers, path + l.name + "/");
      }
    }
  }
  walk(doc.layers, "");
  // 参考线
  var guides = [];
  for (var i=0; i<doc.guides.length; i++) {
    guides.push({direction: doc.guides[i].direction, coord: doc.guides[i].coordinate.value});
  }
  return { smart_objects: result, guides: guides, doc_size: {w: doc.width.value, h: doc.height.value} };
}
```

### 5.5 v1 限制和路线图

| 能力 | v1 | v1.5 |
|---|---|---|
| 单 SO 替换（顶层）| ✅ 路径 A | - |
| 多 SO 替换（顶层）| ✅ 路径 A 循环 | - |
| 嵌套 SO（SO 内套 SO）| ⚠️ 检测后提示不支持 | ✅ 路径 B 递归 |
| 共享 SO（多个 SO 指向同源）| ⚠️ 检测后提示 | ✅ 路径 B + 单次替换全部生效 |
| 基础内部置入 + fill/fit | ✅ 可选基础路径 B | - |
| 高级对齐控制 | ❌ | ✅ center 等对齐参数 |
| 裁切模式（none/auto/guides）| ✅ | - |
| 多输出格式（JPG/PNG）| ✅ | + TIF/PSD/PDF |

---

## 6. 踩坑记录（实施过程中追加）

- 暂无

---

## 7. 已知不确定项（待实施验证）

- [ ] `placedLayerReplaceContents` 在 PS CC 2025+ 是否仍可用（最低支持版本）
- [ ] 中文图层名称在 JSX 里的编码问题（UTF-8 vs GBK）
- [ ] PSB 文件（> 2GB）的处理是否一致
- [ ] PS 在批量长任务中是否会因内存堆积变慢（要不要每 N 次重启 PS）
- [ ] PSD 文件 hash 缓存的失效场景（手动编辑 PSD 后是否需要强制重扫）
- [ ] JSX 调用是否会触发 PS 的"另存为"对话框（需用 `DialogModes.NO`）
- [ ] 多个 PS 实例并发（v1 假定单实例，但用户可能开了两个 PS）
- [ ] PSD 含视频图层、3D 图层时扫描会不会卡死

实施前先用 v1 路径 A + xKeNcHii 极简模式跑通最简 mockup（1 个 PSD + 1 个 SO），再扩展到多 SO 多 mockup 批量。
