# ADR-0001 — 用 Electron + React + TypeScript 作为客户端技术栈

**状态**：已采纳
**日期**：2026-05-23
**决策者**：腾域 aipod 项目

## 背景

腾域 aipod 是一个跨境电商运营桌面工作台，需要完成的工作包括：

- 操作本地文件系统（图片、PSD、JSX）
- 通过 COM 调用 Photoshop（Windows）
- 通过 CDP 操作比特浏览器（采集 + 上架）
- 长时间运行的批量任务 + 进度反馈
- 加密存储用户的 API Key（OS keychain）
- 同时支持 Windows 和 macOS

旧的尝试（`腾域aipod开发/`）已经选过 Electron 栈但项目被废弃，此次重新开始。

## 候选方案

| 方案 | 优势 | 劣势 |
|---|---|---|
| **Electron + React + TS** | 跨平台、生态成熟、React 开发体验好、能直接调 Node 原生模块（COM/CDP/sharp）| 包体大（~80MB），内存占用高 |
| Tauri + Rust + 前端 | 包体极小（< 10MB），内存低 | Rust 学习曲线陡，团队上手慢；调 PS COM 需要 Rust FFI 比 Node 复杂 |
| Native（C++/Swift 各平台）| 性能最好 | 两套代码维护，工作量大；UI 不一致 |
| Web（PWA + 桌面）| 跨平台最好 | 无法调 PS COM、无法访问本地文件系统（除非 File System Access API）|

## 决策

**采纳 Electron + React + TypeScript + Vite + Tailwind + shadcn/ui**。

理由：

1. **能力齐全**：Electron 主进程能自由调 Node 模块（winax 调 COM、Playwright 操作浏览器、sharp 图像处理、Electron 内置 `node:sqlite` 本地数据库；SQLite 访问约束见 ADR-0009）。这些是腾域的核心能力。

2. **跨平台**：Windows + macOS 双端打包，electron-builder 一行配置搞定。

3. **生态成熟**：React + TS 是当前最广泛的桌面前端组合，shadcn/ui 提供高质量 UI 组件，开发速度快。

4. **延续旧项目积累**：旧 `腾域aipod开发/` 虽然废弃，但选 Electron 栈被验证可行；这次重新开始仍延续这个底层选择，可以借鉴外部参考的 PoD 开源工具（`xiaoluobo-pod-studio` 也是 Electron）。

5. **包体可接受**：80MB 包体对桌面 toC 软件不构成关键阻碍（用户目标是商家，不是普通消费者）。

## 影响

- 客户端会有一定的资源占用（启动后 ~400MB 内存）；预算见 spec/00-overview §11。
- 安装包不签名时 SmartScreen/Gatekeeper 会警告（详见 spec/09-cross-cutting §10）。
- Mac 上 PS 套版不可用（COM 是 Windows 限定）；这是栈选择的天然限制，不是 Electron 的问题。
- 团队学习曲线低（React + TS 是现代主流栈）。

## 替代决策的触发条件

如果出现以下情况，可以重新评估栈选择：

- Electron 进程在用户机器上频繁崩溃且无法排查
- 内存占用持续超过 2GB（v1.5 之后）
- 用户群体开始要求轻量化（< 30MB）
