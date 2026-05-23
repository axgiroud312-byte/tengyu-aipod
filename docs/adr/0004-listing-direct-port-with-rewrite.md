# ADR-0004 — 上架模块直接 Port 框架代码，按 listing-automation-builder SKILL 重写店小秘 DOM 操作

**状态**：已采纳
**日期**：2026-05-23

## 背景

`/Users/macmini/Desktop/一键pod/上架程序/` 是一个已经跑通的店小秘批量上架程序：

- Playwright + 比特浏览器 CDP（不直接调店小秘 API，因为店小秘没公开 API）
- 12 阶段流程（openDraft → fill_title → upload_images → ... → submit）
- 多比特 profile 并发 + 单 profile 串行
- per-item 重试 + 连续失败暂停
- 支持 6 个平台（Temu PopTemu / Shein / TikTok / Temu Full / Ozon / Mercado）

腾域要把这套能力集成进来。

## 关键观察

读过源码后发现两类代码质量截然不同：

**框架代码（高质量）**：
- BitBrowser + CDP 适配器
- runner.ts 的批量调度
- 状态机、错误码、可配置 selectors
- 多 workspace 并发模型

**店小秘 DOM 操作代码（屎山）**：
- packages/client/src/worker/listing/platforms/* 各平台目录
- 大量冗余逻辑
- 状态管理混乱
- 选择器散落
- 调试困难

**关键线索**：项目里有一个 `listing-automation-builder` SKILL（在 `.agents/skills/`），定义了**写网页自动化代码的规范方法论**——四层文件结构（selectors / page-parser / action-executor / workflow）+ 状态机驱动（observed_state → target_state → transition → success_evidence）。

讽刺的是，源项目自己**没严格遵守这个 SKILL**，所以代码屎山。

## 决策

**Port + Rewrite 双管齐下**：

### Port（直接搬，几乎不改）

| 源 | 目标 |
|---|---|
| `packages/client/src/main/adapters/{bit-browser,cdp}.ts` | `pod-workbench/src/main/adapters/{bit-browser,cdp}.ts` |
| `packages/client/src/worker/listing/runner.ts`（批量调度框架）| `pod-workbench/src/modules/listing/runner.ts` |
| 错误码、状态机、Stage 跟踪 | `pod-workbench/src/shared/listing-types.ts` |
| `listing-automation-builder` SKILL | `pod-workbench/.agents/skills/listing-automation-builder/` |

### Rewrite（按 SKILL 规范重写）

`pod-workbench/src/modules/listing/platforms/{platform}/`，每个平台一个目录，严格 4 层：

- `selectors.ts` — 只放静态规则
- `page-parser.ts` — 读 DOM 返回 observed_state
- `action-executor.ts` — 按 parser 输出执行 + 重新 parser 验证 target_state
- `workflow.ts` — 业务状态机
- `smoke.ts` — 真实页面验证

### v1 收窄到 2 个平台

之前考虑 v1 全开 6 个平台，**重写工作量 ×6 不现实**。收窄到：
- Temu PopTemu（核心场景）
- Shein（次核心）

v1.5 排队加：TikTok / Temu Full / Ozon / Mercado。

## 候选方案对比

| 方案 | 工作量 | 代码质量 | 维护性 |
|---|---|---|---|
| **全部 port，不重写**（最省力）| 低 | 屎山继承 | 极差，调试都难 |
| **全部重写**（不依赖源项目）| 极高 | 优秀但无源验证 | 好 |
| **Port 框架 + 重写 DOM（采纳）** | 中 | 优秀 | 好 |

## 重写的执行原则

每个平台的代码开发**严格执行 listing-automation-builder SKILL 的纪律**：

1. **不凭记忆猜页面** —— 必须打开真实店小秘页面侦察
2. **侦察先于实现** —— 先输出"页面侦察报告" + "状态转换契约"
3. **小步骤验证循环** —— 每个状态转换写完 → 真实页面跑 → 截图/DOM 留证据
4. **状态转换为最小验证单位** —— 不接受"按钮能点就算成功"
5. **结构化错误** —— 每个失败带 action / state / selector / URL / 关键页面文本 + 证据路径

执行落地：
- 子代理（codex / claude code）开发店小秘代码时**必须加载 listing-automation-builder SKILL**
- 每个 stage 都要写 `state-transition-contract.md` 到 `output/automation-runs/<date>/`
- 平台间禁止互相抄代码，按相同 SKILL 流程独立开发

## 影响

### 正面

- 框架级稳定（已经在 `一键pod/上架程序` 跑过）
- DOM 代码可维护（SKILL 强制分层）
- v1 范围现实可达（2 个平台）
- 未来加平台容易（按 SKILL 模式复制目录）

### 负面

- v1 不能一上来就支持 6 个平台（用户的"全平台"承诺要分批兑现）
- 每加一个平台需要真实页面验证，不能 mock

## 选择器云端派发的预留

v1 选择器写死客户端代码（一个版本对应一组 selectors）。
v1.5 升级到云端版本化派发选择器（spec/07-listing §12）：

```
店小秘改版 → 你后台改选择器版本 → 客户端 30 分钟内拉到新版本 → 无需发布客户端
```

这是腾域抗变能力的关键，写进 v1.5 路线。

## 替代决策的触发条件

如果发现 listing-automation-builder SKILL 的分层结构在某些极端场景下成本太高（如店小秘的某些页面用了 iframe + 复杂 popup），可以**有限放宽**单个平台的内部组织，但**总体规范不变**。
