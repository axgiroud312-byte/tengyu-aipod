# Task: 采集模块 E2E（切片 6 - 采集）

## 目标

Playwright E2E：mock 一个商品页面，验证点击采集 + 滚动采集流程。

## 输入

参考文档（按重要性排序）：
- 无（按 spec 通用约束）

## 验收标准

- [ ] 起一个本地 mock 商品页面（含 IMG + 商品链接）
- [ ] Mock 比特浏览器 + CDP 用 Playwright 直接控制
- [ ] 点击模式：模拟点击图 + 填货号 + 验证图保存
- [ ] 滚动模式：模拟滚动 + 验证散图池
- [ ] 断言：去重生效
- [ ] 断言：失败重试
- [ ] 断言：profile 锁竞争（启动两个会话被拒）

## 不做

- 不连真实比特浏览器（CI 跑）

## 实施提示

用 Playwright 直接启动 chromium 跑 mock 页面。

## 完成后

```bash
git add -A
git commit -m "feat(task): collection e2e tests"
python3 .trellis/scripts/task.py archive 05-23-collection-e2e
```
