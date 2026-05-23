# ADR-0007 — PS 套版 v1 只支持 Windows，Mac 上灰显

**状态**：已采纳
**日期**：2026-05-23

## 背景

Adobe Photoshop 在 Windows 和 macOS 都有版本，但**调用接口完全不同**：

- **Windows**：ActiveX COM 接口（成熟、稳定、能从 Node 直接调）
- **macOS**：AppleScript / 命令行 PS（能力有限、不稳定、调用方式复杂）

腾域客户端是 Electron 双端，但 PS 套版只能在 Windows 跑。

## 决策

**v1 PS 套版仅 Windows 支持。Mac 上 UI 灰显并提示。**

### Mac 上的 UI 处理

```tsx
function PhotoshopModulePanel() {
  if (process.platform === 'darwin') {
    return (
      <Card>
        <CardHeader>PS 套版（仅 Windows 可用）</CardHeader>
        <CardContent>
          <p>您在 Mac 上，此模块需要 Photoshop COM 接口（仅 Windows 提供）。</p>
          <p>其他模块（生图 / 检测 / 标题 / 上架）正常可用。</p>
        </CardContent>
      </Card>
    )
  }
  return <PhotoshopActualUi />
}
```

### 代码组织

```
adapters/
├─ photoshop.ts                ← 主接口，跨平台
├─ photoshop.win.ts            ← Windows: COM + JSX
└─ photoshop.mac.ts            ← Mac: throw UnsupportedError
```

## 候选方案对比

| 方案 | 优势 | 劣势 |
|---|---|---|
| **Mac 完全不支持，UI 灰显（采纳）** | 工作量小，体验明确 | Mac 用户少一个核心模块 |
| Mac 用 AppleScript 实现 | 双端可用 | AppleScript 能力差，编写 JSX 等价物极难；不稳定 |
| Mac 用 ExtendScript Toolkit / UXP | UXP 是新的官方扩展模式 | 学习成本高、Adobe 还在过渡期、需要 PS CC 2021+ |
| 不依赖 PS，自己写 PSD 解析 + 渲染 | 完全跨平台 | 工作量极大，PSD 格式复杂，效果难达专业 |

## 选择 Windows-only 的理由

### 1. 目标用户大多在 Windows

跨境电商运营**普遍用 Windows**：
- 店小秘客户端历史上以 Windows 为主
- 比特浏览器 Windows 版本更稳定
- 大部分 mockup PSD 模板都是 Windows 用户产出

Mac 用户在跨境圈占比 < 20%。

### 2. Mac 完整支持的工作量超大

如果做 Mac 套版：
- 学习 UXP 或 ExtendScript Toolkit
- 重写一套 JSX 等价物（AppleScript / UXP）
- 测试两套实现（PS COM + UXP）
- 维护成本 ×2

v1 阶段不值得。

### 3. Mac 用户仍可用其他模块

腾域 Mac 端能用 6/7 个模块：采集 / 生图 / 检测 / 标题 / 上架 / 编排（v1.5）。**只缺套版**。

Mac 用户可以：
- 在 Mac 做采集 / 生图 / 检测 / 出标题 / 上架
- 套版借助 Windows 同事 / 远程 / VM
- 等 v1.5 我们加 Mac 支持

### 4. 减少首版交付时间

v1 优先保证"Windows 全功能 + Mac 大部分可用"，比"双端都不完整"要好。

## 影响

### 正面

- v1 范围明确，能更快交付
- Windows 套版可以做到极致（专心一个平台）

### 负面

- Mac 用户体验有缺口（要灰显道歉）
- 一些纯 Mac 用户可能不愿购买

### 缓解

- 销售时坦诚说明（"v1 套版仅 Windows，Mac 可用其他 6 个模块"）
- v1.5 可以排队加 Mac UXP 支持作为 selling point

## v1.5 演进路径

```
v1.5 阶段：评估 Mac 套版的可行性
  ├─ 方案 A: UXP 实现（PS CC 2021+ 用户）
  ├─ 方案 B: 远程 Windows 渲染（macOS 客户端调用 Windows 服务器跑 PS）
  └─ 方案 C: 自建轻量 PSD 渲染器（脱离 PS 依赖）

按用户量和反馈决定哪条路。
```

## 替代决策的触发条件

提前 prioritize Mac 套版的信号：
- > 30% 用户在 Mac
- 用户强烈反馈"必须 Mac 用"
- UXP 生态变成熟且能力齐全
