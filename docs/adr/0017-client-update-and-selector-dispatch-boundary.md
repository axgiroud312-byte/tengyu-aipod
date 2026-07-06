# ADR-0017 — 客户端更新与选择器热修边界

**状态**：Proposed
**日期**：2026-07-06

## 背景

P3 计划处理两个容易越界的能力：客户端自动更新，以及店小秘 selector 热修。二者都涉及云端派发内容，必须受 ADR-0003 的"云端轻配置，本地运行"边界约束。

## 决策

- 自动更新只分发版本元数据和安装包下载地址；云端不接触用户图片、API Key、任务数据、店铺数据或本地 SQLite。
- selector 热修只允许分发 JSON selector records，不允许分发可执行 JS/TS、Playwright action、workflow 代码或任意脚本。
- selector record 必须符合 ADR-0014 的 `SelectorRecord` 结构，并按平台、版本和创建时间标识。
- 客户端必须把远端 selector records 缓存在 `.workbench/cache/listing-selectors/`，并保留内置 selector 作为回退。
- 用户必须可以在设置页查看当前 selector 来源：内置 / 缓存 / 本地导入。

## 明确禁止

- 云端代理店小秘页面操作。
- 云端接收 SKU、标题、图片路径、店铺名、商品 URL 或运行证据。
- 远端 selector 包携带函数、表达式、动态 import、eval 字符串或二进制插件。
- selector 热修绕过 ADR-0004 的 selectors / page-parser / action-executor / workflow 四层结构。

## 验证

- selector 包 schema 用 zod 校验。
- 未命中远端缓存时使用内置 selector。
- 远端 selector 损坏时展示中文错误并继续使用内置 selector。
