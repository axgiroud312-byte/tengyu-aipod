# 腾域 aipod — Roadmap

> 工程落地路线图：垂直切片，每个切片可演示。
> 详细 task 在 `.trellis/tasks/`。

---

## 总体节奏

```
切片 0   项目骨架        ← 当前位置（5 个 task 已建好 prd）
切片 1   激活码闭环      ← 切片 0 完成后立即进行（9 个 task 已建好 prd）
v0.1.0   ↑ 发版本：激活码可用
切片 2   标题生成模块    ← 用百炼，最简单的业务模块（5 task，未建）
v0.2.0
切片 3   侵权检测模块    ← 复用百炼 adapter
v0.3.0
切片 4   生图-Grsai      ← 独立 adapter
v0.4.0
切片 5   生图-ComfyUI    ← 晨羽实例管理
v0.5.0
切片 6   采集模块        ← 比特浏览器真实集成
v0.6.0
切片 7   PS 套版         ← Windows 真实 PS
v0.7.0
切片 8   上架模块        ← 最复杂，按 listing-automation-builder SKILL 重写
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

## 切片 2-8（task 待用户进入切片时再用 task.py 创建）

### 切片 2：标题生成模块

业务最简单（仅依赖百炼），用来跑通"云端 skill 派发 → adapter → 模块"全套路。

预计 task：
- bailian-adapter（百炼 OpenAI 兼容客户端）
- skill-cache-client（客户端缓存 + 30 分钟刷新）
- api-skills（服务端派发 skill）
- title-module-service（业务编排）
- title-module-ui
- title-module-e2e

### 切片 3：侵权检测

复用 bailian-adapter + skill-cache。新加：sharp 图像预处理 + worker thread + 风险分类。

### 切片 4：生图 - Grsai

新 adapter，4 能力 × 5 模式，UI 复杂度大。

### 切片 5：生图 - ComfyUI（晨羽）

实例管理 + 关机定时 + ComfyUI HTTP API 集成。

### 切片 6：采集

bit-browser + cdp 共享适配器（建好后切片 8 上架复用）。

### 切片 7：PS 套版

Windows 限定。COM + JSX 动态生成。

### 切片 8：上架

⚠️ 进入前**必须**先把 `listing-automation-builder` SKILL 复制到 `.agents/skills/`。详见 ADR-0004 + spec/07。

### v1.5

- 编排引擎 + 6 个流程模板
- electron-updater 全自动更新
- 上架 TikTok / Temu Full / Ozon / Mercado
- PS 套版路径 B
- 代码签名
- macOS / Windows 应用商店上架（可选）

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
