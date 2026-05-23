# Task: BrowserProfileLock（切片 8 - 上架）

## 目标

全局 profile 互斥锁，采集和上架不能同时占用同一 profile。

## 输入

参考文档（按重要性排序）：
- `docs/spec/01-orchestration.md §4.1`
- `docs/spec/07-listing.md §4`

## 验收标准

- [ ] 类 `BrowserProfileLock` 单例
- [ ] 方法：acquire(profileId, module, taskId) → ProfileHandle | null
- [ ] 方法：list() → 当前所有锁状态
- [ ] ProfileHandle 持有时间 + release 函数
- [ ] 采集和上架模块都用这个锁
- [ ] UI 上 profile 列表显示占用模块
- [ ] 进程退出钩子释放所有锁

## 不做

- 无明确排除项（按需收敛）

## 实施提示

用 Map + ref counting。

## 完成后

```bash
git add -A
git commit -m "feat(task): browser profile lock"
python3 .trellis/scripts/task.py archive 05-23-listing-profile-lock
```
