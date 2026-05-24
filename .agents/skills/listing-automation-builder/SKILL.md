---
name: listing-automation-builder
description: Use when 需要把真实网站或后台页面的人工流程做成可批量复用的浏览器自动化，或整理同站点/业务域的自动化代码。适用于上架、电商后台、ERP/CRM、表单录入、文件上传、批量处理、Playwright、selectors、parser、executor、workflow。
---

# 网页自动化构建器

## 核心目标

把真实网页操作工程化成稳定、可复用、可真实验证的批量自动化程序。不要一开始写 selector 或线性点击脚本；先识别站点/业务域、查找已有资产、侦察真实页面，再按状态机实现。

必须守住五条：

- 先识别 `site_key` / `business_domain` / `page_family` / `platform_variant`。
- 先轻量扫描同站点、同后台、同业务域、相似页面的候选资产，避免重复造。
- 页面侦察和需求对齐后，再输出正式 `复用分析` 和 `文件归属计划`。
- 关键动作按 `observed_state -> target_state -> transition -> success_evidence` 实现，不按“按钮能点”实现。
- 每个小步骤都用真实页面验证，完成后沉淀可复用资产。

## 先判断模式

开始前先判断当前属于哪种模式，并按对应输出推进。

### 1. 整理模式

触发：用户要求“整理目录”“梳理架构”“抽 common”“复用已有流程”“同站点自动化归拢”，或已有类似代码但结构混乱。

默认只分析不改代码，除非用户明确要求落地整理。

必须输出：

- `现有结构地图`：目录、关键文件、入口脚本、测试/smoke、证据输出位置和职责。
- `相似资产分组`：按站点/后台、业务域、页面家族、平台变体、共享动作分组。
- `复用分析`：哪些直接复用、哪些抽象复用、哪些新增、哪些禁止复用。
- `文件归属计划`：哪些保留原位、哪些抽 common、哪些留页面/平台层、哪些暂时不动、哪些废弃但暂不删。
- `迁移步骤`：小步移动顺序、import 修改、验证命令、当前小步回滚方式。
- `风险清单`：高风险文件、外部入口、隐式依赖、命名冲突、测试缺口、真实页面验证缺口。

落地整理时：优先最小必要整理；能用 common 包装层复用的，不优先大量移动旧文件；已跑通旧流程没有验证前不删入口。

### 2. 首个页面模式

触发：这是某个网站/后台/业务域/平台家族的第一个自动化页面。

建立最小可扩展骨架，但不要过度抽象：

```text
automation-root/
  <site-or-domain>/
    common/
      site-profile.ts
      evidence.ts
      errors.ts
    <page-or-platform>/
      selectors.ts
      page-parser.ts
      action-executor.ts
      workflow.ts
      smoke.ts
```

第一次只把确定跨页面复用的能力放 common：

- 站点识别、基础 URL、登录态/权限页识别、通用页面标题或菜单特征。
- 证据保存：截图、DOM 快照、日志目录、失败上下文。
- 结构化错误类型和错误上下文字段。

上传图片、保存草稿、发布、复杂弹窗解析、分页搜索、批量表格操作、平台字段映射，第一次先放页面/平台层；第二个真实页面出现相同状态转换后再抽 common。

### 3. 新流程模式

触发：用户给目标网址、业务目标、人工流程、测试数据或成功标准，要实现一个新自动化流程。

流程：

1. 读取项目规则和现有自动化约定。
2. 识别初步归属：站点/后台、业务域、页面家族、平台变体。
3. 做轻量候选资产扫描：只列可能相关的旧实现、common、smoke、证据工具，不下最终复用结论。
4. 打开真实页面侦察：URL、标题、登录态、iframe、弹窗、遮罩、loading、字段、按钮、上传入口、校验信息、异步行为。
5. 反问需求并对齐：流程结构、变量模型、固定/可配置规则、失败策略、扩展边界。
6. 基于候选资产、真实页面状态和已确认需求，输出正式复用分析和文件归属计划。
7. 输出自动化契约和状态转换契约。
8. 每次只实现一个可验证小步骤。
9. 小步骤真实验证通过后再串联 workflow。
10. 完整真实测试，失败回到对应状态转换修复。
11. 沉淀复用资产。

### 4. 稳定性加固模式

触发：已有自动化失败、页面变化、selector 不稳、上传/提交/弹窗识别不可靠。

流程：

- 读取失败截图、DOM 快照、日志、URL、当前 parser 输出。
- 识别失败停在哪个 `observed_state` 和哪个状态转换。
- 修 selector/parser/等待条件/动作后验收，不扩大改动面。
- 用真实页面重新验证失败小步骤，再跑完整流程或对应 smoke。

## 资产发现与复用分析

不要只按用户说的平台名搜索。结合 URL、域名、菜单路径、页面标题、按钮文案、业务对象和动作关键词搜索。

新流程模式里，资产发现分两段：

- `候选资产扫描`：发生在页面侦察前，只回答“可能有哪些旧实现值得看”，不得声明最终可复用。
- `正式复用分析`：发生在页面侦察和需求对齐后，必须基于真实页面状态、目标业务流程、状态转换契约判断能否复用。

必须识别：

- `site_key`：网站或后台系统，例如 `dianxiaomi`、`shopify-admin`、`erp-admin`。
- `business_domain`：商品上架、订单处理、库存同步、素材上传、表单审核等。
- `page_family`：商品编辑页、列表页、详情页、批量导入页、弹窗上传器等。
- `platform_variant`：Temu、TikTok、Shopee、Amazon；无平台差异写 `none`。
- `shared_actions`：选择账号、选择店铺、上传图片、清空旧值、保存草稿、发布、解析成功弹窗等。

推荐搜索：

```bash
rg "<站点名|域名|后台名|菜单路径>" packages scripts docs .agents
rg "<平台名|业务对象|页面标题|按钮文案>" packages scripts docs .agents
rg "selectors|page-parser|action-executor|workflow|site-profile|evidence|smoke" packages scripts docs .agents
rg "upload|select|save|publish|submit|dialog|modal|toast|table|pagination" packages scripts docs .agents
```

复用分析必须分四类：

- `直接复用`：状态模型和成功证据一致，现有 selector/parser/action/workflow/helper 可直接用。
- `抽象复用`：逻辑相似，但需要参数化站点配置、字段映射、平台差异或等待策略。
- `新增实现`：当前页面/平台独有，放页面或平台目录。
- `禁止复用`：看起来相似，但状态模型、页面组件、成功证据、副作用或幂等性不同。

判断能否抽 common 的标准：前置状态、目标状态、成功证据、失败策略一致，或差异能被清晰参数化。否则先留页面层。

## 站点级交互模式

侦察或实现时，如果发现同一网站/后台中多个页面可能复用的控件行为，必须命名为 `interaction pattern`，并在复用沉淀里说明建议放哪里。不要把某个站点的具体规则写进本 skill；skill 只负责要求发现、命名、验证和沉淀。

每个 interaction pattern 至少记录：

- `pattern_name`：例如 `<site_key>.imageUpload.hoverLocalUpload`。
- `applicable_scope`：适用站点、页面家族、控件区域和限制条件。
- `observed_states`：控件可能处于哪些状态。
- `transitions`：从不同状态到目标状态的动作路径。
- `success_evidence`：重新 parser 后什么证据算成功。
- `failure_evidence`：失败时保存哪些截图、DOM、日志和页面文本。
- `recommended_home`：建议放到 site common、业务域 common、页面层，还是先只写入证据/文档等待二次验证。

常见 interaction pattern：

- hover 后才出现上传、删除、编辑、本地上传等入口。
- 有删除按钮时先删再上传，无删除按钮时直接上传或验证覆盖/追加。
- 异步下拉搜索、选项加载、精确匹配和无结果状态。
- 弹窗确认、成功 toast、失败 toast、遮罩和 loading。
- 表格搜索、分页定位记录、批量勾选和行内操作。
- 上传进度等待、缩略图出现、错误提示清空和数量验证。

## 文件边界

项目已有更具体约定时优先遵守；没有约定时按以下职责分文件。

### `selectors.ts`

- 只放静态规则、字段语义、selector contract、候选定位策略。
- 不访问页面，不读取 DOM，不点击。
- 稳定性优先级：role/label/placeholder/text、稳定属性、相邻文本、局部 CSS、坐标兜底。

### `page-parser.ts`

- 读取真实页面，返回页面状态、区域结构、字段状态、错误信息、上传状态、可执行动作。
- 不把长期使用的 ElementHandle 传给 executor。
- 尽量返回关键控件的 `observed_state` 和证据，不只返回 selector 或元素数量。

### `action-executor.ts`

- 根据 parser 输出重新定位元素并执行动作。
- 动作前确认前置状态，动作后重新 parser 验证目标状态。
- 错误必须带 action、state、selector、URL、关键页面文本和证据路径。

### `workflow.ts`

- 按业务状态机推进，不写机械线性点击。
- 每一步固定为：解析当前状态 -> 判断前置条件 -> 执行动作 -> 重新解析 -> 验证后置条件 -> 记录证据。
- 记录 `observed_state`、`target_state`、`transition`、`success_evidence`。

## 状态转换规则

网页自动化的最小验证单位不是“点击成功”，而是“页面状态转换成功”。

每个关键动作先定义：

- `action_name`
- `observed_state`
- `target_state`
- `transition`：直接填写、清空再填写、删除再上传、追加、覆盖、保留、跳过等。
- `intermediate_states`：loading、searching、uploading、validating、confirming、saving。
- `success_evidence`
- `failure_evidence`
- `retry_policy`
- `idempotency`

不得把这些当成功：

- 按钮能点击。
- 菜单能打开。
- 弹窗能出现。
- file input 能设置文件。
- 请求已发出。
- 页面没有立刻报错。

只有重新 parser 后确认 `target_state` 达成，才算通过。高风险控件至少验证空状态和非空/已有旧内容状态。

常见状态：

- 文本字段：`empty` / `old_value` / `target_value` / `disabled` / `validation_error`。
- 下拉选择：`empty` / `selected_other` / `selected_target` / `searching` / `option_missing`。
- 上传控件：`empty` / `occupied` / `uploading` / `uploaded_target` / `upload_error`。
- 表格行：`missing` / `present` / `duplicated` / `selected` / `action_done`。
- 弹窗：`closed` / `open` / `confirming` / `success` / `error`。
- 提交按钮：`disabled` / `enabled` / `submitting` / `validation_failed` / `submitted_success`。

## 小步骤验证循环

每个小步骤都按这个循环：

```text
选择一个业务小步骤
-> 写状态转换契约
-> 写 selectors/parser/action 的最小实现
-> 到真实页面执行
-> 重新 parser 验证目标状态
-> 保存截图、DOM、日志、当前状态
-> 修正直到通过
-> 再进入下一个步骤
```

示例小步骤：页面加载识别、账号/组织/店铺选择、文本字段填写、文件/图片清空与上传、下拉/标签/分类/表格行选择、条件区域处理、提交/保存结果解析、成功后继续下一条或返回列表。

## 必交付输出

侦察与对齐阶段：

- `页面侦察报告`
- `复用分析`
- `文件归属计划`
- `整理/首个页面计划`（仅整理模式或首个页面模式）
- `需求对齐问题`
- `自动化契约草案`
- `站点级交互模式`（发现同站点可复用控件行为时输出）
- `动作状态转换契约`
- `实现计划`

实现阶段：

- `代码改动`
- `小步骤验证结果`
- `完整流程验证结果`
- `复用沉淀`

推荐证据目录：

```text
output/automation-runs/<日期>-<站点>-<流程>/
  页面侦察报告.md
  复用分析.md
  文件归属计划.md
  整理或首个页面计划.md
  需求对齐问题.md
  自动化契约草案.md
  站点级交互模式.md
  动作状态转换契约.md
  实现计划.md
  小步骤验证/
  完整流程验证.md
  screenshots/
  dom-snapshots/
  logs/
```

## 实现纪律

- 不凭记忆猜页面行为，必须以真实页面侦察和点击验证为准。
- 不复制同类 selector/action/parser/workflow，先搜索并输出复用分析。
- 不把同站点反复出现的控件行为散落在 workflow 里；要命名为 interaction pattern，并说明沉淀位置。
- 不在已有站点/业务域目录外另起平行结构，除非说明现有结构不适用的原因。
- 不把平台差异和站点通用逻辑混进同一个大文件；通用动作、平台规则、页面状态机要分层。
- 不把“代码长得像”当作可复用依据；必须比较状态模型、成功证据、失败副作用和幂等性。
- 不把 parser 一次读取的页面结构当成永久有效，页面变化后必须重新 parser。
- 不静默吞错；失败必须显式抛出或返回结构化错误。
- 不用无限重试；只对明确短暂状态做有限重试。
- 不把 API key、cookie、账号密码、图片字节流等敏感信息写入日志。
- 使用项目已有工具链。若本项目根目录有 `pnpm pw`，优先用它调用 Playwright。

## 示例调用

```text
使用 $listing-automation-builder。

目标网址：https://www.dianxiaomi.com/web/tiktokProduct/edit?id=...
业务目标：根据货号目录和表格数据完成 TikTok 商品上架。
人工流程：
1. 选择店铺账号。
2. 填写产品标题。
3. 删除旧商品图片并上传新商品图片。
4. 上传描述图。
5. 提交发布后识别成功弹窗。

请先识别站点/业务域/页面家族，轻量扫描已有同站点或相似上架流程，只列候选资产。
侦察真实页面并反问关键需求后，再输出正式复用分析和文件归属计划，然后按小步骤实现并真实验证。
```

```text
使用 $listing-automation-builder，帮我整理这个网站已有自动化目录。
先不要改代码，先输出：现有结构地图、相似资产分组、复用分析、文件归属计划、迁移步骤、风险清单。
```
