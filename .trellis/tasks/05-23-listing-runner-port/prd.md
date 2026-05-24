# Task: Port runner.ts 编排框架（切片 8 - 上架）

## 目标

Port `一键pod/上架程序/packages/client/src/worker/listing/runner.ts` 的批量调度逻辑。

本 task 是切片 8 的第 4 步，只落地上架 runner 编排框架：队列分配、profile 锁、CDP 连接、per-item 重试、连续失败暂停、断点续传状态表、progress 事件。平台 DOM 操作必须通过 workflow 接口注入，不能 port 源项目 `platforms/*` 或 `runner/item-runner.ts` 内的 DOM 业务动作。

## 输入

参考文档（按重要性排序）：
- `docs/spec/07-listing.md §7`
- `docs/spec/07-listing.md §9`
- `docs/spec/07-listing.md §11`
- `docs/adr/0004-listing-direct-port-with-rewrite.md`
- `.agents/skills/listing-automation-builder/SKILL.md`
- `.trellis/tasks/05-23-listing-runner-port/research/listing-runner-source-map.md`
- `.trellis/tasks/archive/2026-05/05-23-listing-types-port/research/listing-types-source-map.md`

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

- 后续真实 DOM task 必须接入本机已打开的比特浏览器 `2-1111` 窗口，通过 `bit-browser-adapter` 的 `list-profiles` + Playwright `connectOverCDP` 接入。
- 不新建 profile，不 mock CDP。selectors / parser / executor / workflow 断言必须打在真实店小秘 DOM 上，不使用 fixture HTML。
- smoke 测试必须真实上传素材到真实模板页面，并断言上传后的 DOM 状态；完成后回滚或保留草稿由主理人决定。
- 单元层只允许 mock：`bit-browser-adapter` 自己的 HTTP 协议、`AppError` 错误格式、纯文件读写。素材路径扫描可以用真实目录。
- 真实测试由 `process.env.REAL_LISTING=1` 启用，CI 默认跳过。
- 本 task 不触达店小秘 DOM；它的测试重点是 runner 调度、重试、锁、状态表和事件。真实 DOM workflow 从后续平台 task 接入。

## 验收标准

- [x] 新增 `packages/client/src/modules/listing/runner.ts`
- [x] 调整 import 路径
- [x] 保留：runLocalListingBatch / runWorkspace / runItemWithRetries
- [x] 保留：fail_streak_limit 逻辑 / per-workspace 串行 / 跨 workspace 并行
- [x] 断点续传调用 listing_status 表（spec §9）
- [x] Profile 锁集成（用 listing-profile-lock）
- [x] 事件通过 IPC `listing:progress` 推送
- [x] 不动业务逻辑（DOM 操作交给各平台目录的 workflow.ts）
- [x] 覆盖 runner 单元测试：分配、锁、重试、断点续传、连续失败暂停

## 不做

- 不 port 各平台具体实现（留 listing-{platform}-* tasks）
- 不 port `runner/item-runner.ts` 里的店小秘页面动作；只保留 workflow 注入点

## 实施提示

源项目 `runner.ts` 只是门面，真正框架在 `runner/batch-runner.ts` / `browser-sessions.ts` / `failures.ts`。本仓库新增 `packages/client/src/modules/listing/runner.ts` 作为上架模块入口，主进程 `main/index.ts` 注册 `listing:run` IPC；后续 UI task 再补完整表单入参。

## 完成后

```bash
git add -A
git commit -m "feat(task): port listing runner framework"
python3 .trellis/scripts/task.py archive 05-23-listing-runner-port
```
