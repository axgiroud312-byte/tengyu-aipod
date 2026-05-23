# Task: TempFileManager 全局临时文件管理器（切片 2 - 横切（所有模块用））

## 目标

全局单例管理 `.workbench/tmp/` 下的临时文件生命周期，含按任务隔离 + 24h 孤儿清理。

## 输入

参考文档（按重要性排序）：
- `docs/adr/0008-temp-file-manager-and-cleanup.md`
- `docs/spec/00-overview.md §6`

## 验收标准

- [ ] 类 `TempFileManager` 单例，方法：`createTaskDir(module, taskId): Promise<string>`、`getTaskDir(...)`、`cleanupTask(...)`、`cleanupOrphans()`
- [ ] `cleanupTask` 支持 `{ keepIfFailed: boolean }`：失败保留 1 小时后删（用 setTimeout）
- [ ] 启动时调 `cleanupOrphans()`：扫所有 module 目录，删超 24h 的子目录
- [ ] main 进程退出钩子（`app.on('before-quit')`）尝试清理当前会话所有 tmp（best-effort）
- [ ] 提供占用统计 API：`getDiskUsage(): Promise<Record<module, bytes>>`
- [ ] IPC：`temp-file:get-usage`、`temp-file:cleanup-all`
- [ ] vitest 单测覆盖：创建 / 清理 / 孤儿扫描

## 不做

- 不实现跨任务复用（同 hash 重做也建新 task 目录）
- 不实现压缩归档

## 实施提示

孤儿清理用 `fs.stat().mtimeMs`。注意 Windows 上 mtime 精度问题（用 ctimeMs 兜底）。

## 完成后

```bash
git add -A
git commit -m "feat(task): temp file manager with auto cleanup"
python3 .trellis/scripts/task.py archive 05-23-temp-file-manager
```
