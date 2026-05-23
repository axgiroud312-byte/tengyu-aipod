# Task: Port runner.ts 编排框架（切片 8 - 上架）

## 目标

Port `一键pod/上架程序/packages/client/src/worker/listing/runner.ts` 的批量调度逻辑。

## 输入

参考文档（按重要性排序）：
- `docs/spec/07-listing.md §7`

## 验收标准

- [ ] 复制 runner.ts 到 packages/client/src/modules/listing/runner.ts
- [ ] 调整 import 路径
- [ ] 保留：runLocalListingBatch / runWorkspace / runItemWithRetries
- [ ] 保留：fail_streak_limit 逻辑 / per-workspace 串行 / 跨 workspace 并行
- [ ] 断点续传调用 listing_status 表（spec §9）
- [ ] Profile 锁集成（用 listing-profile-lock）
- [ ] 事件通过 IPC `listing:progress` 推送
- [ ] 不动业务逻辑（DOM 操作交给各平台目录的 workflow.ts）

## 不做

- 不 port 各平台具体实现（留 listing-{platform}-* tasks）

## 实施提示

保留原始注释和 commit messages 方便追溯。

## 完成后

```bash
git add -A
git commit -m "feat(task): port listing runner framework"
python3 .trellis/scripts/task.py archive 05-23-listing-runner-port
```
