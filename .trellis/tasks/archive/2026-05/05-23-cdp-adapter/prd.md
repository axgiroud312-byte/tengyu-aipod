# Task: CDP Adapter（Playwright connectOverCDP）（切片 6 - 采集（也供上架用））

## 目标

通过 Playwright connectOverCDP 连到比特浏览器 profile。

## 输入

参考文档（按重要性排序）：
- `docs/spec/02-collection.md §7.2-7.3`

## 验收标准

- [ ] 类 `CDPClient`
- [ ] 方法：connectToProfile(profileId) → Browser instance
- [ ] 方法：disconnect(profileId)
- [ ] 内部缓存 profile_id → Browser 实例（同 profile 复用）
- [ ] 支持注入页面脚本（用 page.addInitScript）
- [ ] 断连检测 + 重连机制
- [ ] 暴露 page binding 让脚本回调主进程（page.exposeBinding）

## 不做

- 不实现 raw Chrome DevTools Protocol（用 Playwright 抽象）

## 实施提示

用 playwright-extra + stealth 插件防反爬指纹。

## 完成后

```bash
git add -A
git commit -m "feat(task): CDP adapter via playwright"
python3 .trellis/scripts/task.py archive 05-23-cdp-adapter
```
