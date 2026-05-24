# Task: 生图 Grsai E2E（切片 4 - 生图 Grsai）

## 目标

Playwright E2E 测试 4 种能力的 Grsai 路径（mock）。

## 输入

参考文档（按重要性排序）：
- `docs/spec/03-generation.md §15`

## 验收标准

- [ ] Mock grsai API + 百炼 API
- [ ] 文生图：5 条 prompt → 5 张图
- [ ] 图生图（参考风格）：上传 1 张参考图 → 3 条 prompt → 3 张图
- [ ] 提取：1 张源图 → 1 张提取产物
- [ ] 断言：artifacts 表正确记录 source_artifact_ids
- [ ] 断言：并发限制（mock 同时只 3 个请求）
- [ ] 断言：429 降级（mock 返回 429 触发）

## 不做

- 不在 CI 跑真实 grsai 调用

## 实施提示

用 msw 拦截 grsai 域名。

## 完成后

```bash
git add -A
git commit -m "feat(task): generation grsai e2e tests"
python3 .trellis/scripts/task.py archive 05-23-generation-grsai-e2e
```
