# Task: 生图并发控制器（切片 4 - 生图 Grsai）

## 目标

并发池 + 429 自适应降级 + 用户配置（1-10，默认 3）。

## 输入

参考文档（按重要性排序）：
- `docs/spec/03-generation.md §8`

## 验收标准

- [ ] 类 `GenerationConcurrencyController` 单例
- [ ] Semaphore 控制并发上限
- [ ] 默认 3，用户在设置面板可调 1-10
- [ ] `AdaptiveRateLimiter`：连续 3 个 429 自动 currentWorkers -1，toast 提示用户
- [ ] 成功后 currentWorkers 不自动恢复（避免反复降）
- [ ] 重试机制：network/timeout 退避重试，violation 不重试
- [ ] WorkUnit 接口（spec §8.3）

## 不做

- 不实现按 provider 独立并发（v1 全局共享）

## 实施提示

用 `p-limit` npm 包简化实现，自适应降级用 setState 的方式更新 limit。

## 完成后

```bash
git add -A
git commit -m "feat(task): generation concurrency controller"
python3 .trellis/scripts/task.py archive 05-23-generation-concurrency
```
