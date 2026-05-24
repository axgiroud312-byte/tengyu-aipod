# Task: BrowserProfileLock（切片 8 - 上架）

## 目标

全局 profile 互斥锁，采集和上架不能同时占用同一 profile。

本 task 是切片 8 的第 2 步。目标是把 profile 互斥能力固化成上架模块可复用的共享入口；如果现有采集模块已有锁实现，优先复用和补齐契约，不重复造一套。

## 输入

参考文档（按重要性排序）：
- `docs/spec/01-orchestration.md §4.1`
- `docs/spec/07-listing.md §4`
- `docs/adr/0004-listing-direct-port-with-rewrite.md`
- `.agents/skills/listing-automation-builder/SKILL.md`
- `.trellis/tasks/05-23-listing-profile-lock/research/profile-lock-context.md`

## 切片 8 v1 真实范围基线

### 3 个模板

| 平台 | 店小秘编辑页 URL | 真实素材根目录 |
|---|---|---|
| Temu 服装 | `https://www.dianxiaomi.com/web/popTemu/edit?id=128935194843933515` | `/Users/macmini/Desktop/服装素材摆放举例`，排除 `GzG00010` |
| Temu 百货 | `https://www.dianxiaomi.com/web/popTemu/edit?id=128935194833519551` | `/Users/macmini/Desktop/素材文件夹` |
| Shein | `https://www.dianxiaomi.com/web/sheinProduct/edit?id=128935201966452551` | `/Users/macmini/Desktop/服装素材摆放举例/GzG0001` |

### 每个模板 workflow 必须覆盖的 5 项核心动作

1. 替换店铺名称
2. 替换标题
3. 替换图片
4. 一键生成 SKU
5. 一键上传视频

### 真实测试基线

- 测试目标是本机已打开的比特浏览器 `2-1111` 窗口；后续真实 DOM task 通过 `bit-browser-adapter` 的 `list-profiles` + Playwright `connectOverCDP` 接入该窗口。
- 不新建 profile，不 mock CDP。selectors / parser / executor / workflow 的断言必须打在真实店小秘 DOM 上，不用 fixture HTML。
- smoke 测试必须真实上传素材到真实模板页面并断言 DOM 状态；完成后回滚或保留草稿由主理人决定。
- 单元层只允许 mock：`bit-browser-adapter` 自己的 HTTP 协议、`AppError` 错误格式、纯文件读写。素材路径扫描可以用真实目录。
- 真实测试由 `process.env.REAL_LISTING=1` 启用，CI 默认跳过。
- 本 task 不触达店小秘 DOM；它的测试重点是 profile 锁契约和采集/上架共享边界。

## 验收标准

- [x] 类 `BrowserProfileLock` 或现有等价单例，对外导出共享实例
- [x] 方法：acquire(profileId, module, taskId) → ProfileHandle；冲突时抛 `PROFILE_LOCKED` 结构化错误
- [x] 方法：status(profileId) / list() → 当前锁状态
- [x] ProfileHandle 暴露 holder 持有时间 + 幂等 release 函数
- [x] 采集模块使用这个锁；上架 runner 在 `listing-runner-port` 接入同一个共享实例
- [x] 暴露 renderer 可读的锁状态 API；profile 列表展示在 `listing-module-ui` 落地
- [x] 进程退出钩子释放所有锁
- [x] 单测覆盖采集占用时上架获取失败、释放后可重新获取、重复 release 幂等、clear 释放所有锁

## 不做

- 无明确排除项（按需收敛）

## 实施提示

已有 `packages/client/src/main/lib/browser-profile-lock.ts` 和采集接入时，优先补齐契约和测试。不要为了名字重写一套锁。

## 完成后

```bash
git add -A
git commit -m "feat(task): browser profile lock"
python3 .trellis/scripts/task.py archive 05-23-listing-profile-lock
```
