# Task: CI Activation（切片 0 - 第 5 个 / 最后一个）

## 目标

把 `.github/workflows/ci.yml` 中的占位检查改为**真实强制检查**。

## 输入

- 已存在：`.github/workflows/ci.yml`（占位版本）
- 已就绪：monorepo + shared + client + server（前 4 个 task 完成后）

## 验收标准

- [ ] 去掉 ci.yml 中 type-check / lint / test 步骤的 `continue-on-error`
- [ ] 在三个 package 的 package.json 各加 scripts：
  - `"type-check": "tsc --noEmit"`
  - `"lint": "biome check ."`
  - `"test": "vitest run"`（如果没有 test 文件，设为 `"test": "echo no tests yet"`）
- [ ] 根 `package.json` 加汇总 scripts：
  - `"type-check": "turbo run type-check"`
  - `"lint": "turbo run lint"`
  - `"test": "turbo run test"`
- [ ] 推一次 commit 触发 CI
- [ ] CI 在 GitHub Actions 上**全绿**通过
- [ ] 在 README（如果有）或 ci.yml 顶部加 badge：`[![CI](https://github.com/axgiroud312-byte/tengyu-aipod/actions/workflows/ci.yml/badge.svg)](...)`

## 不做

- 不写新的测试（vitest 占位即可）
- 不上 e2e（Playwright e2e 在切片 1 加）
- 不接 Codecov 等覆盖率服务

## 实施提示

要让 CI 真的有意义，建议加：

```yaml
- name: Lint check
  run: pnpm lint
  # 去掉 continue-on-error

- name: Type check
  run: pnpm type-check
```

主分支保护规则（建议在 GitHub 网页配）：
- Require PR before merging
- Require CI checks to pass
- Restrict pushes to main（个人项目可选）

## 完成后

```bash
git add -A
git commit -m "feat(task-05): activate full CI checks (type-check + lint + test)"
python3 .trellis/scripts/task.py archive 05-23-ci-activation
```

至此**切片 0 完成**——项目骨架就绪，准备进入切片 1（激活码闭环）。
