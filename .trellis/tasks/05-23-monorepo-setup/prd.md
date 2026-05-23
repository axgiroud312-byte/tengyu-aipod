# Task: Monorepo Setup（切片 0 - 第 1 个）

## 目标

在项目根建立 pnpm workspace + Turborepo 骨架，让 `pnpm install` 能成功。

**切片 0 是项目骨架阶段，目标是"能 build、能起进程"**，不实现任何业务逻辑。

## 输入

- 参考：`docs/spec/00-overview.md §1-3`（技术栈 + Monorepo 目录结构）

## 验收标准

- [ ] 根目录有 `package.json`（含 monorepo 元数据 + workspace scripts）
- [ ] 根目录有 `pnpm-workspace.yaml`（声明 `packages/*`）
- [ ] 根目录有 `turbo.json`（含 build/dev/lint/test/type-check pipelines）
- [ ] 根目录有 `tsconfig.base.json`（含 strict mode + path aliases）
- [ ] 根目录有 `biome.json`（lint + format 配置）
- [ ] 根目录有 `.npmrc`（设 `node-linker=hoisted` 让 Electron 模块兼容）
- [ ] 创建空目录 `packages/{shared,client,server}` 各含一个 `.gitkeep` 或最小 package.json
- [ ] `pnpm install` 成功
- [ ] `pnpm turbo --help` 能跑

## 不做

- 不实现任何业务代码
- 不安装具体业务依赖（Electron、Next.js、Prisma 等 → 各自 task 装）
- 不写 README（v1 暂不写）

## 实施提示

```bash
# 推荐目录
.
├─ package.json
├─ pnpm-workspace.yaml
├─ turbo.json
├─ tsconfig.base.json
├─ biome.json
├─ .npmrc
└─ packages/
    ├─ shared/
    ├─ client/
    └─ server/

# turbo.json pipelines
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**"] },
    "dev": { "cache": false, "persistent": true },
    "lint": {},
    "test": {},
    "type-check": { "dependsOn": ["^build"] }
  }
}
```

## 完成后

执行：
```bash
git add -A
git commit -m "feat(task-01): monorepo skeleton (pnpm workspace + Turborepo)"
python3 .trellis/scripts/task.py archive 05-23-monorepo-setup
```
