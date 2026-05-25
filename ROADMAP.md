# 腾域 aipod — Roadmap

> 工程落地路线图：垂直切片，每个切片可演示。
> 详细 task 在 `.trellis/tasks/`。

---

## 总体节奏

```
切片 0   项目骨架        ← 当前位置（5 个 task 已建好 prd）
切片 1   激活码闭环      ← 切片 0 完成后立即进行（9 个 task 已建好 prd）
v0.1.0   ↑ 发版本：激活码可用
切片 2   标题生成模块    ← 用百炼，最简单的业务模块（状态：✅ 已完成并归档）
v0.2.0
切片 3   侵权检测模块    ← 复用百炼 adapter（状态：✅ 已完成并归档）
v0.3.0
切片 4   生图-Grsai      ← 独立 adapter（状态：✅ 已完成并归档）
v0.4.0
切片 5   生图-ComfyUI    ← 晨羽实例管理（状态：✅ 已完成并归档）
v0.5.0
切片 6   采集模块        ← 比特浏览器真实集成（状态：✅ 已完成并归档）
v0.6.0
切片 7   PS 套版         ← Windows 真实 PS
v0.7.0
切片 8   上架模块        ← 最复杂，按 listing-automation-builder SKILL 重写（状态：✅ 已完成并归档）
v1.0.0   ↑ 全功能 v1 发布
v1.5     编排引擎 + 第 3-6 上架平台 + electron-updater + 代码签名
```

每切片完成 = 一个可演示版本。**v0.1.0 起就能发给信任的朋友试**（哪怕只有"激活码"功能）。

---

## 切片 0 — 项目骨架（5 个 task）

目标：能 build、能起进程，无任何业务逻辑。

| # | Task | 路径 | 优先级 |
|---|---|---|---|
| 1 | monorepo setup | `.trellis/tasks/05-23-monorepo-setup/` | P0 |
| 2 | shared package skeleton | `.trellis/tasks/05-23-shared-package-skeleton/` | P0 |
| 3 | client electron skeleton | `.trellis/tasks/05-23-client-electron-skeleton/` | P0 |
| 4 | server nextjs skeleton | `.trellis/tasks/05-23-server-nextjs-skeleton/` | P0 |
| 5 | ci activation | `.trellis/tasks/05-23-ci-activation/` | P1 |

**预计工时**：1-2 个工作日（AI 协作下）

**完成后**：`pnpm dev` 客户端能弹窗、`pnpm dev` 服务端 `/api/health` 返回 200。

---

## 切片 1 — 激活码闭环（9 个 task）

目标：激活码可发可激活，admin 后台可管理。

| # | Task | 路径 | 优先级 |
|---|---|---|---|
| 6 | prisma schema | `.trellis/tasks/05-23-prisma-schema/` | P0 |
| 7 | admin auth jwt | `.trellis/tasks/05-23-admin-auth-jwt/` | P0 |
| 8 | admin codes ui | `.trellis/tasks/05-23-admin-codes-ui/` | P0 |
| 9 | admin customers ui | `.trellis/tasks/05-23-admin-customers-ui/` | P1 |
| 10 | api activate | `.trellis/tasks/05-23-api-activate/` | P0 |
| 11 | api status | `.trellis/tasks/05-23-api-status/` | P0 |
| 12 | client onboarding | `.trellis/tasks/05-23-client-onboarding/` | P0 |
| 13 | client keychain | `.trellis/tasks/05-23-client-keychain/` | P0 |
| 14 | client status badge | `.trellis/tasks/05-23-client-status-badge/` | P0 |

**预计工时**：5-7 个工作日

**完成后**：
- 你能在 admin 后台创建激活码
- 客户端能用激活码激活
- 客户端右上角实时显示状态
- ✅ **发 v0.1.0**

---

## 切片 2 — 标题生成模块（9 task）

| # | Task | Slug | 优先级 |
|---|---|---|---|
| 15 | 服务端 Skill 派发 API | server-api-skills | P0 |
| 16 | Admin Skill 管理 UI | admin-skills-ui | P0 |
| 17 | 客户端 Skill 缓存 | client-skill-cache | P0 |
| 18 | 阿里云百炼 Adapter | bailian-adapter | P0 |
| 19 | Sharp 预处理 Worker 池 | sharp-preprocess-pool | P0 |
| 20 | TempFileManager | temp-file-manager | P0 |
| 21 | 标题模块业务服务 | title-module-service | P0 |
| 22 | 标题模块 UI | title-module-ui | P0 |
| 23 | 标题模块 E2E | title-module-e2e | P1 |

**v0.2.0 发版**

## 切片 3 — 侵权检测（6 task）

| # | Task | Slug | 优先级 |
|---|---|---|---|
| 24 | 阈值与 Skill 配置 UI | detection-thresholds | P0 |
| 25 | 检测业务服务 | detection-module-service | P0 |
| 26 | 检测前端 UI | detection-module-ui | P0 |
| 27 | 一键加入待套版 | detection-promote-to-matting | P1 |
| 28 | 费用预估器 | detection-cost-estimator | P1 |
| 29 | 检测 E2E | detection-e2e | P1 |

**v0.3.0 发版**

## 切片 4 — 生图 Grsai（10 task）

| # | Task | Slug | 优先级 |
|---|---|---|---|
| 30 | Provider Registry API | server-api-providers | P0 |
| 31 | Admin Provider 管理 UI | admin-providers-ui | P0 |
| 32 | Grsai Adapter | grsai-adapter | P0 |
| 33 | 生图模块骨架 | generation-skeleton | P0 |
| 34 | 提示词生成器服务 | prompt-generator-service | P0 |
| 35 | 文生图 Grsai UI | txt2img-grsai-ui | P0 |
| 36 | 图生图 5 模式 UI | img2img-grsai-ui | P0 |
| 37 | 提取 Grsai UI | extract-grsai-ui | P0 |
| 38 | 并发控制器 | generation-concurrency | P0 |
| 39 | Grsai E2E | generation-grsai-e2e | P1 |

**v0.4.0 发版**

## 切片 5 — 生图 ComfyUI（11 task）

| # | Task | Slug | 优先级 |
|---|---|---|---|
| 40 | 晨羽智云 Adapter | chenyu-cloud-adapter | P0 |
| 41 | ComfyUI HTTP Adapter | comfyui-http-adapter | P0 |
| 42 | 工作流派发 API | server-api-workflows | P0 |
| 43 | Admin 工作流管理 UI | admin-workflows-ui | P0 |
| 44 | 实例生命周期管理 | comfyui-instance-manager | P0 |
| 45 | 工作流执行引擎 | comfyui-execution | P0 |
| 46 | 提取 ComfyUI UI | extract-comfyui-ui | P0 |
| 47 | 图生图 ComfyUI UI | img2img-comfyui-ui | P0 |
| 48 | 直接抠图 | matting-comfyui-direct | P0 |
| 49 | 混合抠图路径 | matting-mixed-pathway | P0 |
| 50 | ComfyUI E2E | generation-comfyui-e2e | P1 |

**v0.5.0 发版**

## 切片 6 — 采集（10 task）

| # | Task | Slug | 优先级 |
|---|---|---|---|
| 51 | BitBrowser Adapter | bit-browser-adapter | P0 |
| 52 | CDP Adapter | cdp-adapter | P0 |
| 53 | Platform Rules API | server-api-platform-rules | P0 |
| 54 | Admin 平台规则 UI | admin-platform-rules-ui | P1 |
| 55 | 采集会话状态机 | collection-session-fsm | P0 |
| 56 | 注入采集脚本 | collection-injected-script | P0 |
| 57 | 点击采集模式 | collection-click-mode | P0 |
| 58 | 滚动采集模式 | collection-scroll-mode | P0 |
| 59 | 采集记录和 manifest | collection-records | P0 |
| 60 | 采集 E2E | collection-e2e | P1 |

**v0.6.0 发版**

## 切片 7 — PS 套版（12 task，Windows-only）

状态：✅ 已完成并归档。PS 套版切片已完成 12 个 task，本地 Windows + Photoshop COM 真实测试已跑通可执行范围；完整手动矩阵受本机 fixture 数量限制，详见 `ps-module-e2e` 归档证据。

| # | Task | Slug | 优先级 |
|---|---|---|---|
| 61 | PS 状态检测 | ps-status-checker | P0 |
| 62 | PS COM Adapter | ps-com-adapter | P0 |
| 63 | PSD 模板扫描 | psd-scanner | P0 |
| 64 | JSX 生成器（路径 A）| ps-jsx-generator | P0 |
| 65 | 任务分组 | ps-task-grouping | P0 |
| 66 | 执行引擎 | ps-execution-engine | P0 |
| 67 | 多模板批次 | ps-multi-batch | P0 |
| 68 | 裁切策略 | ps-clipping | P0 |
| 69 | 跳过已完成 | ps-skip-completed | P1 |
| 70 | 进度和日志 | ps-progress-logs | P1 |
| 71 | PS 模块 UI | ps-module-ui | P0 |
| 72 | PS 手动 E2E | ps-module-e2e | P1 |

**v0.7.0 发版**：已具备 PS 套版能力。

## 切片 8 — 上架（20 task）

⚠️ **必须先做 task #73**（导入 listing-automation-builder SKILL）。

| # | Task | Slug | 优先级 |
|---|---|---|---|
| 73 | Import SKILL（强制） | listing-skill-import | P0 |
| 74 | Profile 锁 | listing-profile-lock | P0 |
| 75 | Port 类型 | listing-types-port | P0 |
| 76 | Port runner 框架 | listing-runner-port | P0 |
| 77 | Temu selectors | listing-temu-selectors | P0 |
| 78 | Temu parser | listing-temu-parser | P0 |
| 79 | Temu executor | listing-temu-executor | P0 |
| 80 | Temu workflow | listing-temu-workflow | P0 |
| 81 | Temu smoke | listing-temu-smoke | P0 |
| 82 | Shein selectors | listing-shein-selectors | P0 |
| 83 | Shein parser | listing-shein-parser | P0 |
| 84 | Shein executor | listing-shein-executor | P0 |
| 85 | Shein workflow | listing-shein-workflow | P0 |
| 86 | Shein smoke | listing-shein-smoke | P0 |
| 87 | 断点续传 | listing-resume | P0 |
| 88 | 批次加载器 | listing-batch-loader | P0 |
| 89 | 证据保存 | listing-evidence | P1 |
| 90 | 上架模块 UI | listing-module-ui | P0 |
| 91 | 失败重试 UI | listing-failure-retry | P1 |
| 92 | 上架手动 E2E | listing-module-e2e | P1 |

**v1.0.0 发版（v1 全功能）**

当前收口状态：⚠️ 待全链路 E2E 真实验收。代码层切片 1-8 全部归档，v1.0.0 待主理人本机跑通完整链路 + 提供完整 fixture 矩阵后正式放行。

## v1.5 — 增量（15 task）

| # | Task | Slug | 优先级 |
|---|---|---|---|
| 93 | 编排流程模板 | v15-orch-templates | P2 |
| 94 | 编排引擎执行 | v15-orch-engine | P2 |
| 95 | 失败策略 | v15-orch-failure | P2 |
| 96 | 编排 UI（任务中心）| v15-orch-ui | P2 |
| 97 | electron-updater | v15-electron-updater | P2 |
| 98 | 选择器云端派发 | v15-selectors-dispatch | P2 |
| 99 | 服务端风控 | v15-risk-detection | P2 |
| 100 | TikTok 上架 | v15-listing-tiktok | P2 |
| 101 | Temu Full 上架 | v15-listing-temu-full | P2 |
| 102 | Ozon 上架 | v15-listing-ozon | P2 |
| 103 | Mercado 上架 | v15-listing-mercado | P2 |
| 104 | PS 路径 B | v15-ps-path-b | P2 |
| 105 | i18n 英文 | v15-i18n-english | P2 |
| 106 | Windows 签名 | v15-sign-windows | P2 |
| 107 | macOS 签名 | v15-sign-mac | P2 |

**v1.5.0 发版**

## 总计

**108 个 task**（含 00-bootstrap）= 全部 v1 + v1.5 工作单元已就绪，每个 task 含完整 prd.md。

每完成一个切片 = 一个可演示发版本。逐 task 跑、逐切片发，不要跳。

---

## 怎么在 Codex 终端开始

```bash
# 1. 切到项目目录
cd /Users/macmini/Desktop/第10次开发pod

# 2. 启动 Codex
codex

# 3. 给 Codex 第一句话（贴这段）

“项目刚做完文档体系（PRD/Spec/ADR）和 Trellis tasks 切片。请按以下顺序读取：

1. CLAUDE.md（项目级指南）
2. docs/CONTEXT.md（领域语言）
3. docs/spec/00-overview.md（架构）
4. ROADMAP.md（路线图）
5. .trellis/tasks/05-23-monorepo-setup/prd.md（第一个 task）

读完回答：
- 你理解了项目要做什么
- 你的下一步是什么

不要写代码，先确认理解。”

# 4. Codex 确认后，跑第一个 task：

“开始 task-01 monorepo-setup。

要求：
- 按 .trellis/tasks/05-23-monorepo-setup/prd.md 的验收清单逐项实现
- pnpm install 跑通后停下来给我确认
- 不要继续下一个 task

参考 docs/spec/00-overview.md §1-3 的技术栈和目录结构。”

# 5. Codex 跑完 task-01 后：

“task-01 验证通过。现在 commit + archive：
  git add -A
  git commit -m '...'
  python3 .trellis/scripts/task.py archive 05-23-monorepo-setup

然后开始 task-02 shared-package-skeleton。”

# 6. 重复，直到切片 0 全部完成，发 v0.0.1 起步版本
```

---

## 工作纪律（建议你贯彻）

1. **一次只跑一个 task**：Trellis 设计就是 incremental，强制单 task 完成才进下一个
2. **每个 task 完成都要 commit + push**：保留可回滚的检查点
3. **每个切片完成发版本 tag**：`git tag v0.X.0 && git push origin v0.X.0`
4. **遇到问题先查 spec**：`docs/spec/` 里有 95% 答案；spec 没说的再问我
5. **修改 spec 前一定先讨论**：spec 是契约，单方面改会乱
6. **绝不跳过 v1 范围做 v1.5**：留 v1.5 的功能就让它留着，先把 v1 跑通

---

## 反向沟通

如果 Codex / Trellis 跑出问题，回到 Claude（我）告诉我：
- 哪个 task 卡住
- 错误信息
- 你期望的结果

我可以：
- 修 spec / ADR
- 写更细的 prd.md
- 给具体调试方向

---

## 项目链接

- 仓库：https://github.com/axgiroud312-byte/tengyu-aipod
- 主文档：[CLAUDE.md](./CLAUDE.md) [docs/](./docs/)
- 外部 API 参考：[references/](./references/)
- Trellis tasks：[`.trellis/tasks/`](./.trellis/tasks/)
