# Task: v1.5: electron-updater 集成（v1.5 - 横切）

## 目标

全自动更新替代 v1 半自动（跳转下载页）。

## 输入

参考文档（按重要性排序）：
- `docs/spec/09-cross-cutting.md §7.2`

## 验收标准

- [ ] 集成 electron-updater 包
- [ ] 配置 GitHub Releases 或自托管 endpoint
- [ ] 启动时 autoUpdater.checkForUpdatesAndNotify()
- [ ] update-downloaded 事件 → 弹窗 [立即重启] / [稍后]
- [ ] 强制升级时 quitAndInstall 不可拒绝
- [ ] 支持 stable / beta 通道切换

## 不做

- 不实现增量更新（differential update v2）

## 实施提示

用 GitHub Releases + electron-builder publish 配置。

## 完成后

```bash
git add -A
git commit -m "feat(task v1.5): electron-updater integration"
python3 .trellis/scripts/task.py archive 05-23-v15-electron-updater
```
