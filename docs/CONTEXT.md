# 腾域 aipod — Context

这里定义腾域 aipod 项目的统一领域语言。所有 PRD、Spec、ADR、代码命名、UI 文案都必须遵守这套术语，避免不同人/不同 AI 用不同的词说同一个东西。

---

## Language

### 任务与业务标识

**Workbench**：
腾域 aipod 桌面客户端的整体称呼。
_Avoid_: 软件、客户端、App、Electron 应用

**货号 / SKU**：
一个最终在跨境电商平台上架的商品标识；同时是该商品在文件系统中的文件夹名。一个货号 = 一条 listing。
_Avoid_: 商品 ID、产品 ID、任务 ID

**任务 / Task**：
一个货号在一次端到端或局部流程中的工作执行单元。任务记录尝试次数、失败原因、产物路径等。
_Avoid_: Job、Process、Workflow Run（Workflow Run 是 ComfyUI 内部概念，不混用）

**完整任务**：
跨多个模块顺序执行的任务。当前 v1 首版是内置固定流程：
来源准备 → 提取/生图 → 可选抠图 → 可选侵权检测 → PS 套版 → 标题生成。
首版不包含上架，不是自由流程编辑器。
_Avoid_: 大任务、串联任务（"串联"是动词，不做名词）

**轻量任务 / Lightweight Task**：
单个模块独立运行产生的任务，只有一个 Workflow Step。所有独立模块运行都会创建轻量任务用于追踪。
_Avoid_: 测试运行、临时任务、未跟踪运行

**Workflow Step**：
任务内的一个阶段，对应某个模块的执行。状态：未开始 / 进行中 / 等待人工 / 完成 / 失败 / 跳过。
_Avoid_: Stage、Phase、子任务

### 印花和产物

**印花 / Print**：
一张可以被套版的图，可能来自提取、文生图、图生图。在数据库里有唯一印花 ID（`pri_xxx`）。
_Avoid_: 设计图、图案、Pattern

**印花 ID**：
全局唯一的印花标识，跨 provider 共享同一 ID 空间。
_Avoid_: print_uuid、design_id

**原图**：
`01-采集工作区` 下的产品图，由用户从跨境电商平台采集而来。原图不是印花，必须经过"提取"才能成为印花。
_Avoid_: source、原始素材

**成品图 / Product Image**：
`04-上架工作区` 下、套版完成后的最终展示图，会送上架程序。
_Avoid_: 输出图、上架图、模特图

**Artifact**：
任何由模块产生的本地文件（图片、JSX、临时遮罩、xlsx 等）。每个 artifact 在数据库里登记血缘。
_Avoid_: 输出文件、结果

### 模块

**模块 / Module**：
腾域 workbench 内的一个业务单元，拥有独立面板，可单独使用。
_Avoid_: 功能、组件、Plugin

**生图模块**：
负责产生印花的统一模块；当前 UI 按 5 个入口组织（文生图 / 图生图 / 提取 / 抠图 / 提取后抠图）。文生图是统一页并在右侧选择 Grsai 或 ComfyUI 工作流；图生图、提取、抠图保留各自路径交互。
_Avoid_: ComfyUI 模块、付费生图模块（不分两个模块，分两个 Tab 内的实现方式）

**生图能力**：
文生图、图生图、提取、抠图，以及 ComfyUI-only 的提取后抠图组合入口。业务入口与具体 provider 解耦。
_Avoid_: 子模块、子能力（指代时用"能力"或"子工具"，不混用）

**Provider / 服务商**：
某个生图能力的实现源。`comfyui-chenyu`（晨羽智云 ComfyUI）、`grsai`（付费生图）、`aliyun-bailian`（视觉/LLM）。
_Avoid_: Backend、Vendor、引擎

**Adapter / 适配器**：
腾域客户端连接外部 provider 的代码层。每种 API 风格（grsai-native / openai-images / openai-chat / dashscope-native）一个 adapter。
_Avoid_: Client、SDK 封装

**Skill**：
云端服务器派发的提示词模板，用于指导 LLM 完成具体业务（生图提示词生成、侵权判定、标题写作）。一个 skill 包含 systemPrompt、用户在 UI 填的变量定义、推荐模型。
_Avoid_: Prompt 模板、规则、System Message

**ComfyUI 工作流包 / Workflow Pack**：
客户端本地导入的 ComfyUI 工作流定义，含 workflow_json、输入槽、输出槽、依赖模型。客户端读取本地缓存后注入素材图调用。
_Avoid_: Pipeline、Graph

**默认云机 / Default Cloud Machine**：
设置页中用户选定的一台晨羽 ComfyUI 实例，是运行云机选择的默认候选。生图页 ComfyUI 路径展示运行中云机列表，用户为本次任务选择运行云机；开机、关机、设为默认仍在设置页处理，不在生图页开关机。
_Avoid_: 活跃实例（代码里可保留 current/active 命名，UI 用默认云机或运行云机）

**生图运行期日志 / Generation Runtime Log**：
生图页内存日志，只用于当场排查提示词生成、任务提交、模型调用进度、完成/失败和保存路径。最多保留最近 `1000` 条，应用重启后消失；不包含 API Key 或 base64 图片。
_Avoid_: 审计日志（常规运行期日志不是长期审计）

**诊断日志 / Diagnostic Log**：
生图、侵权检测、标题生成共用的落盘排障 JSONL。写在 `.workbench/logs/diagnostics/{generation|detection|title}/{taskIdOrRunId}.jsonl`，默认开启，用于查看本次发送给 LLM / provider 的完整参数、原始返回、轮询/重试次数、解析失败和跳过决策。API Key、authorization、token、secret、password 永远脱敏；base64 / data URL / Buffer 图片内容只记录 mime、字节数、sha256、长度等元信息。默认保留 7 天，总量上限 1GB，启动和每 24 小时自动清理。
_Avoid_: 审计日志、业务产物、长期用户数据备份

### 编排

**编排引擎 / Orchestrator**：
驱动多种流程模板、资源队列、暂停恢复和失败策略的通用调度器。
v1 只包含内置固定 **完整任务** 服务；通用编排引擎仍留 v1.5。
_Avoid_: 调度器、工作流引擎（这两个词指代 ComfyUI 内部）

**流程模板 / Pipeline Template**：
编排引擎用的内置模板。v1 只有一个固定完整任务路径；
v1.5 再扩展完整链路 / 从印花开始 / 套版加上架 / 标题加上架等多模板。
_Avoid_: 流水线、Workflow

**模板批次 / Batch**：
PS 套版输出域 `04-上架工作区/` 下的一级目录，对应一个 PSD 模板的输出。一个上架批次 = 一个模板批次。上架程序的扫描单位。
_Avoid_: 批次、Output Folder

### 采集

**采集会话 / Collection Session**：
用户明确开始的一次采集过程；监听比特浏览器中的图片下载和点击。同一时刻 workbench 内最多一个采集会话。
_Avoid_: 爬虫任务、Spider Job

**图池 / Image Pool**：
当前采集页内存中的待下载图片集合。扫描搜索页、列表页、商品详情页后，图片先进入图池，由用户勾选后下载。
_Avoid_: 下载队列（图池包含已扫描但未必会下载的候选图）

**散图 / Loose Image**：
无法归属到某个商品详情主图组的图片，通常来自搜索页/列表页商品卡片。下载时直接进入当次采集任务目录 `01-采集工作区/{平台-时间}/`。
_Avoid_: 杂图（带负面语义）

**商品页分组 / Product Group**：
商品详情页左侧主图/轮播图形成的一组图片。UI 以文件夹展示，下载时进入当次采集任务目录下的 `商品页/<商品分组>`。
_Avoid_: 货号文件夹（采集图不是最终货号）

**采集运行期日志 / Collection Runtime Log**：
采集页内存日志，只用于当场排查扫描、下载、点击采集和会话状态。最多保留最近 `1000` 条，应用重启后消失。
_Avoid_: 审计日志、落盘日志

**浏览器环境 / Browser Profile**：
比特浏览器中的一个独立 profile（含登录态、cookie、代理、指纹）。腾域通过 CDP 连接。
_Avoid_: 浏览器实例、账号

**比特浏览器适配器 / BitBrowser Adapter**：
工作台级别的共享适配器（adapters/bit-browser.ts），采集和上架模块都通过它连接 profile。
_Avoid_: 比特客户端

**Profile 锁**：
跨模块互斥机制。同一个浏览器 profile 同时只能被一个模块占用（采集或上架），由 BrowserProfileLock 协调。

### 套版

**模板 / Mockup**：
PSD 或 PSB 文件，包含智能对象图层，用于套印花。
_Avoid_: Template（与"流程模板"冲突）、PSD 文件（指文件类型时可用）

**智能对象 / Smart Object / SO**：
PSD 中可被替换内容的特殊图层。
_Avoid_: 替换图层

**代表智能对象数**：
PSD 模板中决定"一组任务需要消耗多少张印花"的数字。`independent`、`shared` 等模式由扫描结果决定。
_Avoid_: SO 数量

**裁切区域 / Clip Area**：
模板自动识别或由参考线推导出的导出区域。一个模板可能输出多张裁切图。
_Avoid_: 切片、Crop Region

### 检测

**风险值 / Risk Score**：
侵权检测模型输出的 0-100 数值。
_Avoid_: 分数、得分

**风险等级 / Risk Level**：
按风险值划分的三档：`pass`（低）/ `review`（中）/ `block`（高）。
_Avoid_: 通过/复核/拦截（用英文等级名作为 enum 值，UI 上展示中文）

### 上架

**上架程序 / Listing Bot**：
腾域中的店小秘自动化模块；通过 Playwright + 比特浏览器 CDP 操作店小秘网页后台。
_Avoid_: 上架机器人、爬虫

**草稿模板 ID / Draft Template ID**：
店小秘后台预先创建的"草稿模板"的唯一标识；模板里预存价格、类目、规格、运费等字段。腾域只覆写标题、SKU、图片。
_Avoid_: 模板（与 Mockup 冲突）、Template

**店铺环境 / Shop Environment**：
一个店铺账号对应的比特浏览器 profile；多个店铺环境可跨账号并行上架。
_Avoid_: 工作区（工作区指本地文件根目录）、Profile（Profile 指代浏览器环境而非店铺）

**Listing 状态 / Listing Status**：
单个 SKU 在上架流程中的状态：`pending` / `uploading` / `success` / `failed`。用于断点续传。
_Avoid_: Upload Status

### 客户与云端配置

**客户 / Customer**：
实际使用 Workbench 的客户账号。客户通过旧 PHP 统一登录体系完成微信扫码或手机号验证码登录，Next 按 PHP `uid` 管理授权、到期日、禁用状态和备注。
_Avoid_: 用户（"用户"只泛指操作软件的人）、设备账户

**客户账号 / Customer Account**：
Next 服务端中的授权管理对象，对应 `CustomerAccount` 模型。唯一标识是旧 PHP 返回的 `php_uid`；首次登录自动创建为 `pending`，管理员授权后变为 `active`。
_Avoid_: 客户记录（指旧后台档案视角）、本地授权码、设备授权

### 服务器与配置

**云端 / Server**：
腾域的中央服务器（Next.js + Postgres）。**只管理客户账号授权、Skill 系统提示词、公告和版本，不接触图片、不代理生图、不存用户 API Key 或业务数据，也不保存 PHP `secret`**。
_Avoid_: 后端、Cloud

**本地模型配置 / Local Model Config**：
客户端本地维护的 Grsai、百炼、晨羽模型清单、节点、并发、重试和 API Key 绑定。API Key 存 OS keychain，配置不上传云端。
_Avoid_: Provider Registry、云端服务商配置

**Admin 后台 / Admin**：
管理员浏览器界面（Next.js 中的 /admin），用于管理管理员账号、客户账号授权、Skill 系统提示词、公告、版本。Admin 登录使用邮箱密码和管理员 JWT，不接微信登录。
_Avoid_: Dashboard、CMS

### 文件与目录

**工作区 / Workbench Root**：
用户在设置页指定的本地根目录，腾域在其下创建采集、印花、检测、上架 4 个业务工作区和 `.workbench/` 黑盒。
_Avoid_: 素材总目录、工作目录、Output Folder

**临时文件管理器 / TempFileManager**：
全局单例，管理 `.workbench/tmp/{module}/{taskId}/` 下的临时文件生命周期。任务完成自动清理、启动清理 24h+ 孤儿。
_Avoid_: 缓存管理器

---

## Relationships

### 业务对象

- 一个 **货号** 对应一条上架 listing。
- 一个 **货号** 可能有多个历史 **任务**（重做、补做）；同时刻只有一个"进行中"任务。
- 一个 **任务** 包含一个或多个 **Workflow Step**（轻量任务只含一个）。
- 一个 **任务** 始终绑定唯一货号；一个 **轻量任务** 可能由独立模块运行创建。
- 一个 **印花** 在不同 **模板** 下套版后生成多个 **货号**（分散在多个**模板批次**目录里）。
- 一个 **原图** 经"提取"产生一个或多个 **印花**；原图不是印花。
- 一个 **印花** 可用于多个货号（跨模板）。

### 模块和运行路径

- **生图模块** 提供 5 个入口（文生图 / 图生图 / 提取 / 抠图 / 提取后抠图）。
- 文生图是统一页，右侧“生图路径”选择 grsai 或 comfyui-chenyu；图生图保持两条原入口，不合并。
- 提取可通过 grsai 或 comfyui-chenyu 实现；抠图没有纯 grsai 路径；提取后抠图只走 comfyui-chenyu。
- `comfyui-chenyu` 在生图页选择运行中云机后调用 ComfyUI 原生 HTTP API；设置页的 **默认云机** 只是默认候选。
- **侵权检测模块** 和 **标题生成模块** 共享 **aliyun-bailian** provider。
- **抠图能力** 没有"纯付费"路径；只能 comfyui 工作流 或 "付费生黑白图 + comfyui 转遮罩+混合" 的混合路径。
- **完整任务** 复用已有模块 runner，不模拟 UI 点击；来源支持采集目录、文生图、图生图和已有印花。
- **完整任务** 的检测策略是 `block` 拦截，`pass` / `review` 放行，并记录 review 数量。
- **完整任务** 当前固定以标题生成结束；上架仍由上架模块单独读取 `04-上架工作区`。
- 同一时刻一个 **浏览器 profile** 只能被一个模块占用（采集 或 上架）。

### 服务器边界

- **云端 / Server** 管理：客户账号授权 / Skill 系统提示词 / 公告 / 版本。
- **云端 / Server** 不负责：微信扫码 OAuth、手机号验证码登录本身；这些复用旧 PHP 统一登录体系。
- **云端 / Server** 不接触：用户图片、生图调用、LLM 调用、用户 API Key、任务记录、货号、标题。
- **云端 / Server** 不保存：旧 PHP 登录返回的 `secret`。
- 客户端用用户**本地存的 API Key** 直连晨羽、Grsai、阿里云百炼；模型清单和 Workflow 均本地管理，云端不代理。

### 文件系统

- **工作区** 下固定创建 `01-采集工作区/`、`02-印花工作区/`、`03-检测工作区/`、`04-上架工作区/` 和 `.workbench/`。
- `02-印花工作区` 下固定分 4 个能力目录：`文生图` / `图生图` / `提取` / `抠图`。每次生图操作在能力目录下创建 `{任务名}` 结果文件夹；提取后抠图归入 `抠图` 目录，默认“能力-时间”，前端可自定义。
- `03-检测工作区/{任务名}` 下固定分 `无风险` / `疑似` / `高风险` 三个分类目录。
- 业务工作区目录里**只放业务图片**；唯一例外是 `04-上架工作区/{模板批次}/` 下的标题 xlsx。元数据、血缘、状态和套版候选清单全部在 `.workbench/workbench.db`。
- **04-上架工作区** 下按 **模板批次** 分一级目录，每个批次内按 **货号** 分二级目录，含成品图 + 标题 xlsx（当前标题模块默认 `标题.xlsx`，上架扫描优先读 `标题.xlsx`，兼容旧 `titles.xlsx`）。
- **04-上架工作区 是上架程序唯一读取域**；采集、生图、检测模块不能直接写入上架批次。

### 客户账号授权

- 一个 **客户账号** 对应唯一 `php_uid`。
- 客户首次登录后，如果 `php_uid` 不存在，Next 自动创建 `pending` 客户账号。
- 客户账号状态为 `active` 且未到期时，客户才能进入 Workbench。
- `pending`、`disabled`、`expired` 都不能进入 Workbench。
- `expired` 是 `active` 且 `expires_at` 已过期的计算状态，不一定作为数据库 enum。
- 同一 `php_uid` 沿用旧 PHP 单点登录机制；新登录会让旧 `secret` 失效。

---

## Example dialogue

> **产品经理**：用户在生图模块的"图生图" Tab 选了 comfyui 实现，他点开始后会发生什么？
> **架构师**：系统先创建一个**轻量任务**（绑定临时货号），编排到 **comfyui-chenyu provider** 的 adapter。用户在生图页选择一台运行中云机；如果没有运行中云机，提示去设置页开机。客户端拉取最新 ComfyUI **工作流包**（图生图类别），按 input_slots 注入用户的源印花，提交到所选运行云机的 ComfyUI HTTP API。完成的印花产物落到 `02-印花工作区/图生图/{任务名}` 下，**印花 ID** 写数据库。

> **产品经理**：用户把同一批印花套到 3 个 PSD 模板上，会产生几个货号？
> **架构师**：3 个模板批次，每个批次内每个印花一个货号。所以 N 个印花 × 3 模板 = 3N 个 listing。每个 **模板批次** 是一个独立的上架批次，对应一份标题 xlsx。

> **产品经理**：客户首次登录后能直接用 Workbench 吗？
> **架构师**：不能。旧 PHP 登录成功只说明身份有效；Next 会按 `php_uid` 创建或读取**客户账号**。如果状态是 `pending`、`disabled` 或已到期，客户端只能展示对应提示。只有 `active` 且未到期时，才进入首次设置或 Workbench。

---

## Flagged ambiguities

- "中转站"曾指代 LLM 和生图两类服务商；现在明确**只指代付费生图（Grsai）**，**视觉/LLM 走阿里云百炼**，两者归属不同 provider 类目。
- "图生图"曾被理解为"参考图一定喂给生图模型作为种子图"；现在明确 Grsai 图生图中“生图时带参考图”是用户开关，默认关闭。关闭时参考图只给视觉 LLM 看；开启时参考图也发给 Grsai 生图接口。
- "提取"共用同一套**提取 Skill**。付费模型路径和 comfyui 路径都是一张源图对应一次运行，差异只在执行渠道：Grsai 走图生图接口，comfyui 走提取工作流。
- "模板"在不同上下文有不同含义：PSD 模板（Mockup）、流程模板（Pipeline Template）、店小秘草稿模板（Draft Template）；行文必须明确前缀。
- "用户"曾混指购买方和软件使用者；明确登录和授权对象叫**客户 / Customer**，泛指操作软件的人才叫用户。
- "任务"曾混指模块面板单次操作和跨模块串联运行；明确两层抽象：**轻量任务**（独立模块运行）和**完整任务**（当前由内置固定流程服务驱动，未来可由通用编排引擎接管）。
- "Skill"在云端服务器上下文指代"模块提示词模板"；不与开源项目中"Claude Skill"等其他概念混用。
- "Provider"在 Q8 重新定义后仅指代外部 API 提供方（晨羽 / Grsai / 阿里云百炼），不再用作 ComfyUI / 付费 的二分。
