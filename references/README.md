# References — 外部世界参考文档

腾域 aipod 对接的所有外部系统（云服务、桌面 SDK、开源项目、协议规范）的整理资料。

**这里只描述"外部世界长什么样"，不描述"我们要做什么"**。我们要做什么在 `../docs/` 下的 PRD 和 Spec。

---

## 索引

### 采集（collection/）
- _外部参考待补_ — 比特浏览器 API、Chrome DevTools Protocol 等；当前实现规则见 [采集 Spec](../docs/spec/02-collection.md) 和 [ADR-0010](../docs/adr/0010-collection-image-pool-and-runtime-logs.md)

### 生图 - ComfyUI（generation-comfyui/）
- [chenyu-cloud-api.md](./generation-comfyui/chenyu-cloud-api.md) — 晨羽智云开放接口，对接 ComfyUI 生图模块；当前主链路是"默认云机 + ComfyUI 原生 HTTP"，不是晨羽 workflow/run
- _待编写_ — ComfyUI 原生 HTTP API（/prompt、/history、/upload/image、/view）

### 生图 - 付费中转站（generation-paid/）
- [grsai-api.md](./generation-paid/grsai-api.md) — Grsai 付费 AI API 中转站；腾域当前只接入 `gpt-image-2` / `gpt-image-2-vip`，统一走原生 `/v1/api/generate`
- _待编写_ — skill 提示词设计原则、各模型对比

### 视觉/LLM 横切 provider（vision-llm-providers/）
- [aliyun-bailian-api.md](./vision-llm-providers/aliyun-bailian-api.md) — 阿里云百炼，qwen3.5-plus / qwen3.5-flash / qwen3.6-plus 文本与视觉模型、qwen3-vl-*、qwen-vl-*，OpenAI 兼容接入

### 侵权检测（detection/）业务规则
- _待编写_ — 侵权判定阈值、风险分级、skill 提示词设计

### PS 套版（photoshop/）
- [open-source-references.md](./photoshop/open-source-references.md) — 两个 GitHub 项目分析（joonaspaakko 1066 行成熟方案 + xKeNcHii 102 行极简方案），含核心 JSX Action ID 速查表、v1/v1.5 路线
- _待编写_ — PS COM 接口（Windows 注册表/进程检测）、PSD 智能对象规范（嵌套/共享/Action Descriptor 字段表）

### 标题生成（title-generation/）业务规则
- _待编写_ — 标题 prompt 设计原则、跨境电商标题规范
- 视觉/LLM provider 见 [vision-llm-providers/aliyun-bailian-api.md](./vision-llm-providers/aliyun-bailian-api.md)

### 上架（listing/）
- _待编写_ — 店小秘自动化方案（参考 `~/Desktop/一键pod/上架程序`）

### 服务器端（server/）
- _待编写_ — Wave SaaS 参考、JWT 鉴权设计、工作流/skill 版本策略

### 跨模块通用（shared/）
- _待编写_ — Electron 最佳实践、SQLite 设计模式、跨平台文件命名

### 已归档（_archive/）
- _尚无归档_

---

## 文档规范

1. **新建文档前**：先用 [TEMPLATE.md](./TEMPLATE.md) 作骨架，确保所有文档结构一致
2. **文件命名**：`{来源主体}-{用途}.md`，全小写 kebab-case，不带版本号
3. **顶部必须标抓取时间**：超过 3 个月的文档实施前必须重抓核对
4. **不重复 PRD/Spec 内容**：决策性内容（"我们决定怎么做"）放 `docs/`，这里只放事实
5. **新增文档后**：在本 README 的"索引"对应模块下加一行

---

## 维护节奏

- **抓取**：调用 `WebFetch` 或 `tavily_extract` 工具抓官方文档，整理成 markdown
- **更新**：实施过程中发现接口变更或踩坑，更新对应文档的"腾域集成要点"或新增"踩坑记录"节
- **归档**：接口确认弃用，整个文件移到 `_archive/`，**不删除**（保留历史）
- **复核**：每个 Sprint 开始前扫一遍，凡顶部"抓取时间"超过 3 个月的，全部重抓
