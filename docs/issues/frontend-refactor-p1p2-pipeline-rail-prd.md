# PRD:前端视觉收敛 + 完整任务流水线导轨(重构第一批 P1+P2)

## Problem Statement

作为软件的使用者和购买决策者,我打开腾域 aipod 时感觉它"AI 感太强":满屏渐变光效、插画横幅、英文角标,像一个 AI 产品的宣传 demo,而不是我每天要用 8 小时的生产工具。更糟的是,软件最核心的卖点——完整任务把 采集/生图 → 抠图 → 侵权检测 → PS 套版 → 标题 全链路自动跑完——在界面上完全看不出来:启动后只有一行文字消息和一个状态角标,我不知道机器正在干什么、干到哪了、干得多快。而启动之前,我要面对一整页 90 多个表单项和一大块琥珀色警告列表,还没跑起来就被劝退了。

给客户演示时,这个软件应该让人觉得"真牛逼"——但现在牛逼的部分(后台自动化)是隐形的,劝退的部分(配置表单)是最显眼的。

## Solution

把复杂度从"运行前"搬到"运行中",分两条线:

1. **视觉收敛**:删掉全部 AI 风装饰(雷达渐变、背景插画、网格纹理、发光阴影、渐变 logo、插画横幅、Sparkles 图标),回归 Linear / Raycast 式的克制专业感。高级感来自克制,不来自光效。

2. **流水线导轨(PipelineRail)**:完整任务页新增一个贯穿"配置 → 运行 → 完成"三态的流水线可视化组件,作为页面视觉主角:
   - **配置态**:横向节点链(来源 → 抠图 → 检测 → 套版 → 标题),开关阶段=点亮/熄灭节点,依赖锁定直接在导轨上表达;缺配置的节点亮红点,启动前校验从"36 条警告长列表"变成节点内联定位。
   - **运行态**:按 ADR-0015 流式流水线契约,**多个节点同时活跃**,每个节点显示自己的实时计数(如"检测 12/40")和流动动画,印花逐项在阶段间流动;当前日志尾部滚动展示;产物图完成一张点亮一张。
   - **完成态**:导轨定格为运行摘要——每个节点显示产出数和耗时,顶部展示总耗时与总产出。

   数据源完全复用现有 `pipeline.onProgress` 推送的 `PipelineProgress`(steps / items / logs / result_sections / stats),**零主进程与 IPC 协议改动**。

用户启动一次完整任务后看到的画面:五个节点同时呼吸、计数跳动、图片一张张出现、最后定格成运行摘要。这是演示时最能体现自动化价值的画面。

## User Stories

1. As a 跨境电商运营(日常操作员), I want 打开软件看到干净克制的专业界面而不是满屏 AI 光效, so that 我把它当成可靠的生产工具而不是演示玩具。
2. As a 老板(购买决策者), I want 给客户或员工演示完整任务时看到全链路自动流动的可视化画面, so that 对方直观感受到软件的自动化价值。
3. As a 操作员, I want 在完整任务页通过点亮/熄灭导轨节点来开关抠图/检测/套版/标题阶段, so that 我不用在一排 Checkbox 里找开关。
4. As a 操作员, I want 导轨上被依赖锁定的节点(如"标题依赖套版"、existing_prints 起点之前的步骤)显示为置灰并附带原因提示, so that 我不会困惑为什么某个开关点不动。
5. As a 操作员, I want 缺配置的阶段在对应导轨节点上亮红点、点击后看到具体缺哪几项, so that 我不用在一大块琥珀色警告列表里逐条对照。
6. As a 操作员, I want 启动按钮不可用时 hover 显示"还差 N 项配置", so that 我知道离能跑还差多远。
7. As a 操作员, I want 运行中每个阶段节点显示自己的实时完成计数(如"套版 8/24"), so that 我随时知道整条流水线的进度分布。
8. As a 操作员, I want 运行中看到印花逐项从一个阶段流向下一个阶段(流式,多阶段同时活跃), so that 我确认机器一直在跑、没有空转。
9. As a 操作员, I want 被侵权检测拦截(block)的印花在导轨检测节点上单独计数并归入"未通过", so that 我知道有多少张被过滤掉、流水线没有被堵住。
10. As a 操作员, I want 单张印花或单个货号失败时只在对应节点累计失败数、不中断整条运行, so that 我不用因为一张图出错而重跑全部。
11. As a 操作员, I want 运行中在导轨下方看到最近几条运行日志的尾部滚动, so that 我不用打开日志弹窗也能瞄到机器正在干什么。
12. As a 操作员, I want 仍然可以打开完整日志弹窗查看全量分级日志, so that 出问题时我能排查细节。
13. As a 操作员, I want 产物图片完成一张显示一张(沿用现有槽位机制,但视觉上提升为主区域), so that 我第一时间看到生成/抠图/套版结果。
14. As a 操作员, I want 运行完成后导轨定格为运行摘要(每阶段产出数+耗时,总耗时), so that 我一眼看到这次运行的成果汇总。
15. As a 操作员, I want 检测全部拦截、零货号产出的运行显示为"正常完成+警告"而不是失败, so that 状态语义和 ADR-0015 一致、我不会误以为程序坏了。
16. As a 操作员, I want 取消运行后导轨如实显示"软停"状态(在跑的单张跑完、未开始的不再进入), so that 我理解取消是尽力取消而不是立刻中断。
17. As a 操作员, I want 中断(软件中途关闭)的历史运行在历史面板里仍可见并可从"已有印花来源"手动续起, so that 已产出的成果不会丢。
18. As a 操作员, I want 完整任务页的四类任务起点(采集+提取 / 文生图 / 图生图 / 已有印花)保持现有功能不变, so that 我的既有工作流不受重构影响。
19. As a 操作员, I want 阶段开关控件从 Checkbox 换成 Switch, so that 开/关状态一眼可辨。
20. As a 操作员, I want 顶部模块横幅从 92px 插画横幅变成紧凑的纯文字条(模块名+当前状态), so that 屏幕空间留给真正的工作内容。
21. As a 操作员, I want 侧边栏保持现有导航结构但去掉发光渐变激活态、改用克制的高亮, so that 视觉焦点不被导航抢走。
22. As a 操作员, I want 主色蓝只出现在主操作按钮和激活态、语义色只表达状态(绿=成功/琥珀=警告/红=失败), so that 颜色是信息而不是装饰。
23. As a 开发者, I want 后端 PipelineProgress 到导轨视图模型的全部映射规则集中在一个纯函数模块里, so that 流式进度的展示逻辑可以被单元测试穷举覆盖。
24. As a 开发者, I want 36 条启动前校验规则从组件 useMemo 里搬到独立纯函数模块、每条规则带阶段定位, so that 校验逻辑可测试且导轨能按阶段展示红点。
25. As a 开发者, I want 完整任务页从 3755 行单组件拆为编排容器+导轨+运行视图+结果面板的组合, so that 后续第二批重构(预设/配置抽屉)有可落脚的结构。
26. As a 开发者, I want 现有 E2E 测试(pipeline-comfyui / workspace-settings / tutorial 等 11 个 spec)在重构后全部保持绿色, so that 重构没有破坏既有行为。
27. As a 操作员, I want 完整任务的表单配置在会话内切页后仍保留(沿用现状), so that 我切去设置页再回来不用重填。

## Implementation Decisions

### 范围与分批

- 本 PRD 覆盖视觉收敛(P1)+ 流水线导轨与运行详情(P2),并纳入首次设置“服务连接”步骤的中性文案与操作收敛。预设系统、阶段配置抽屉化、设置页重组、Onboarding 业务流程或步骤顺序调整、演示 mock 模式属于第二批,另立 PRD。
- 遵守 ADR-0012 / ADR-0013 / **ADR-0015** 的完整任务边界:固定顺序+显式开关+流式流水线;导轨只是既有语义的可视化表达,不引入任何编排引擎语义。

### 视觉收敛

- 删除:workbench-shell 的雷达渐变/背景插画/网格纹理三层叠加、所有发光阴影(替换为标准细阴影)、渐变文字 logo、模块插画横幅及其资源映射模块、"Workbench"英文角标、Sparkles/WandSparkles 类装饰图标。
- 顶部 Header 降为紧凑文字条:模块名 + 该模块当前状态摘要(完整任务模块显示运行态,如"运行中 · 检测 12/40")。
- 保持现有 shadcn 风格 token 体系(HSL CSS 变量)不换库;只收敛用色纪律。暗色主题不在本批范围。
- 新增 Switch 组件(基于项目现有 Radix + cva 模式,与现有 ui 组件同风格),完整任务页阶段开关全部由 Checkbox 迁移到 Switch。

### PipelineRail(流水线导轨)——核心新模块

- **受控纯展示组件**,不订阅 IPC、不持有业务状态。接口(来自设计阶段原型,型别名可调):

```ts
type RailMode = 'config' | 'running' | 'done'

interface RailStage {
  key: 'source' | 'matting' | 'detection' | 'photoshop' | 'title'
  enabled: boolean
  locked?: { on: boolean; reason: string }   // 依赖锁定(锁开/锁跳过)
  issues?: number                            // 配置态:缺配置项数,>0 亮红点
  counts?: { done: number; total: number; failed: number; blocked?: number }  // 运行态
  durationMs?: number                        // 完成态
  active?: boolean                           // 运行态:该阶段当前有在途项(流式下可多节点同时 true)
}

interface PipelineRailProps {
  mode: RailMode
  stages: RailStage[]
  selectedStage?: string
  onToggleStage?: (key: string) => void
  onSelectStage?: (key: string) => void
}
```

- 运行态遵循 ADR-0015 流式契约:**不存在单一"当前阶段"**,多节点可同时 active;检测节点额外展示 blocked 计数;失败数逐项累计不中断。
- 配置态点击节点触发 `onSelectStage`,页面在导轨下方展示该阶段的现有配置区块(本批只做"滚动定位/显隐到现有表单区块",不重做表单交互——表单抽屉化属于第二批)。

### progress-mapper(进度映射)——核心新模块

- 纯函数模块:`PipelineProgress → RailViewModel`(含各阶段 counts/active/耗时、日志尾部截取、运行级状态语义)。
- 集中处理的映射规则至少包括:steps/items 到各阶段计数的归并;skipped 阶段的表达;检测 block 归入 blocked;"全拦截零产出=正常完成+警告"的状态语义;取消软停态;中断(interrupted)态;完成态运行摘要数据(每阶段产出+耗时)。
- 该模块不依赖 React,不做 IPC,输入输出均为可序列化对象。

### validation(启动前校验)——搬迁模块

- 现有 36 条校验规则从页面组件 useMemo 搬到独立纯函数模块,签名形如 `(config) => StageIssue[]`,每条 issue 携带 `{ stage, field, message }`。
- 规则内容一条不改(行为等价搬迁),只改归属和输出结构;导轨按 stage 聚合展示红点与计数,启动按钮 hover 汇总"还差 N 项"。
- 琥珀色警告长列表移除,替代为节点红点 + 点击节点查看该阶段明细。

### RunTheater(运行详情)——薄组合层

- 组合 PipelineRail(running/done)+ 日志尾部条(截取最近数条,复用现有日志数据流)+ 现有产物槽位/结果面板。
- 现有结果预览面板、日志弹窗、历史面板、逐项状态面板保留复用,只调整排版层级:导轨与产物为主视觉,历史与逐项列表下沉。

### 页面拆分

- 完整任务页从单文件巨型组件拆为:编排容器(目标 <300 行)+ PipelineRail + RunTheater + 校验模块 + 既有面板组件。
- 现有 ~93 个 state 与 sessionStorage 会话持久化机制**本批保持原样**(行为不变),仅按拆分后组件归位;迁移到 zustand store 属于第二批。
- 既有 sessionStorage 草稿 key 兼容性不做保证(草稿本来就不跨重启,可丢弃)。

### 明确不改的东西

- 主进程、IPC 协议、`PipelineProgress` 数据结构:零改动。
- 所有页面常驻挂载 + hidden 切换的应用级架构:不动。
- 四类任务起点表单、检测覆盖语义、印花货号/分隔符/等待套版命名规则:不动。

## Testing Decisions

- **好测试的标准**:只测外部行为(输入→输出、渲染结果、用户可见状态),不测实现细节(内部 state 名、调用次数)。纯函数模块用穷举式表驱动测试。
- **单元测试(vitest,新增)**:
  - progress-mapper:覆盖流式多阶段同时活跃、skipped、blocked 归类、单项失败累计、全拦截零产出=正常完成+警告、取消软停、中断、运行摘要聚合等映射规则。
  - validation:36 条规则逐条的触发/不触发用例,以及 stage 聚合正确性。
  - 先例:仓库已有 vitest 3 + 主进程单测(如 app-lifecycle、onboarding 的 test 文件),沿用同套配置;这两个模块不依赖 React/IPC,可直接在 node 环境跑。
- **E2E(playwright,既有)**:现有 11 个 spec 重构后必须全绿,尤其 pipeline-comfyui、workspace-settings、tutorial。若导轨替换了 spec 依赖的选择器/文案,修 spec 的断言而不是在产品里保留旧 DOM。
- **stage0 mock 环境(运行态验证的关键)**:仓库 `.workbench/codex-logs/stage0/` 下已有一套可复用的本地 mock 环境——`stage0-mock-service.cjs`(单文件 node 服务,监听 127.0.0.1:63796,伪造 PHP 登录、Skill 派发、阿里云百炼、Grsai、晨羽实例与 ComfyUI 全部外部接口)+ `mock-workbench/`(含示例源图的五个业务工作区)+ mock user-data 启动方式(参见同目录下 client-dev-mock 日志)。验证导轨运行态/完成态时,应启动该 mock 服务并用 mock 工作区跑真实完整任务,**不需要任何真实 API Key 或云机**。
- **视觉人工验收(硬性)**:视觉收敛与导轨三态无法靠 type-check/单测验证。每个视觉里程碑(Header/侧边栏收敛、导轨配置态、运行态、完成态)需在 `pnpm dev` 下(配合 stage0 mock 环境)截图供主理人确认后才算完成。agent 执行时必须在 PR 描述中附截图或明确声明"未能启动 dev 环境验证",不得仅凭编译通过声称完成。
- PipelineRail 组件本身不写单测,由 E2E + 人工验收覆盖(受控纯展示组件,渲染逻辑薄)。

## Out of Scope

- 预设(Preset)系统、阶段配置抽屉化、93 个 state 迁移 zustand——第二批 PRD。
- 设置页三 tab 重组、Onboarding 业务流程或步骤顺序调整、"测试连接"死按钮修复——第二批 PRD;不包含本批已经纳入的“服务连接”视觉和文案收敛。
- 演示 mock 运行模式(假 progress 回放)——第二批 PRD。
- 暗色主题及其切换入口。
- 主进程/IPC/数据库任何改动;`pipeline_runs` / `pipeline_steps` 表结构。
- 上架串接、暂停恢复、断点续跑、自由编排(v1.5,ADR-0012/0015 边界)。
- 完整任务以外其他模块页面的交互重构(仅承受全局视觉 token 收敛的被动影响)。

## Further Notes

- **ADR-0015 是本 PRD 的执行模型权威**:完整任务已是流式流水线,导轨运行态必须表达"多阶段同时流动",不得实现为"单一当前阶段高亮"的线性进度条。实现前必读 ADR-0012 / 0013 / 0015 与 spec/01。
- 视觉收敛动的是全局 css token 与布局骨架,会被动影响所有模块页面——改动后需全模块过一遍 E2E 并抽查各页面截图,防止个别页面依赖被删的装饰类名。
- 构建管线中存在主题 css 校验脚本(assert-theme-css),删 token 时同步更新该校验。
- 建议实施顺序:视觉收敛 → validation 搬迁 → progress-mapper → PipelineRail 配置态 → 运行态/完成态 → RunTheater 排版整合。每步保持可编译、E2E 可跑。
- 第二批 PRD(预设/抽屉/设置与 Onboarding 业务流程重组/演示模式)待本批验收后另行提交,届时预设持久化先走 localStorage、写明升级 SQLite 的路径。
