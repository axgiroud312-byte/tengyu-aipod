# Task: 采集会话状态机（切片 6 - 采集）

## 目标

采集会话生命周期：idle → starting → active → paused/stopping → completed，+ profile 锁集成。

## 输入

参考文档（按重要性排序）：
- `docs/spec/02-collection.md §3`

## 验收标准

- [ ] 类 `CollectionSessionManager`
- [ ] 全局单例（同时刻最多 1 个 active 会话）
- [ ] `startSession(config) → Session`
- [ ] `stopSession()`
- [ ] `getActiveSession() | null`
- [ ] 状态变化通过 IPC 事件推送
- [ ] 暂停触发场景：浏览器关闭 / 用户离开 platform 允许域 / 主窗口关闭
- [ ] 获取 BrowserProfileLock（与 listing 共享）
- [ ] 数据库 collection_sessions 表记录

## 不做

- 不支持多会话并行（v1.5）

## 实施提示

用 XState 或自己实现状态机。

## 完成后

```bash
git add -A
git commit -m "feat(task): collection session state machine"
python3 .trellis/scripts/task.py archive 05-23-collection-session-fsm
```
