# Task: 标题模块 E2E 测试（切片 2 - 标题生成模块）

## 目标

Playwright E2E 测试标题完整流程（含百炼真实调用）。

## 输入

参考文档（按重要性排序）：
- `docs/spec/06-title.md §12`

## 验收标准

- [ ] 测试用例：准备 3 个货号文件夹（mock 图）→ 启动标题任务 → 验证 xlsx 产物
- [ ] Mock 百炼 API 用 msw 拦截（避免真实费用），返回固定标题
- [ ] 断言：xlsx 列数对、行数对、内容匹配
- [ ] 断言：进度事件按预期发出
- [ ] 断言：失败重试机制（mock 第一次失败，第二次成功）
- [ ] 断言：已有标题跳过逻辑
- [ ] 测试用 GitHub Actions 跑通

## 不做

- 不在 CI 跑真实百炼调用（仅本地手动跑一次）

## 实施提示

用 `playwright/test`。Electron app launch 用 `_electron.launch({ args: ['main.js'] })`。

## 完成后

```bash
git add -A
git commit -m "feat(task): title module e2e tests"
python3 .trellis/scripts/task.py archive 05-23-title-module-e2e
```
