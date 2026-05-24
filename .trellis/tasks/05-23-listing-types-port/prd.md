# Task: Port 一键pod shared 类型和错误码（切片 8 - 上架）

## 目标

从 `一键pod/上架程序/packages/shared` Port 关键类型到腾域。

本 task 是切片 8 的第 3 步，只建立上架模块后续 runner / batch-loader / platform workflow 共用的类型和错误码契约。不 port 源项目 runner、orchestration 或 DOM 业务逻辑。

## 输入

参考文档（按重要性排序）：
- `docs/spec/07-listing.md §1.1`
- `docs/spec/07-listing.md §8`
- `docs/adr/0004-listing-direct-port-with-rewrite.md`
- `.agents/skills/listing-automation-builder/SKILL.md`
- `.trellis/tasks/05-23-listing-types-port/research/listing-types-source-map.md`

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
- 本 task 不触达店小秘 DOM；它的测试重点是 shared 类型导出、错误码、纯状态/错误辅助函数。

## 验收标准

- [x] 新增 `packages/shared/src/listing-types.ts`，并从 `packages/shared/src/index.ts` 导出
- [x] 包括 `ListingItem` / `ListingConfig` / `ListingResult` / `StageResult` / `WorkspaceResult`
- [x] 包括 v1 三模板需要的 `ListingTemplateKey`、`ListingPlatformKey`、图片组、素材扫描项、workflow stage、运行状态等类型
- [x] Listing 错误码 enum/常量和 retryable 判断复制到 listing 子模块，并与现有 `AppErrorClass` 兼容
- [x] 只 port 类型和纯函数，不 port 源项目 orchestration / runner / selectors / DOM 代码
- [x] shared 包 ts 编译通过；client/server 引用不破坏

## 不做

- 不 port 业务逻辑代码（留各自 task）

## 实施提示

参考源项目 `packages/shared/src/types/listing.ts` 和 `packages/shared/src/listing-execution.ts`，挑 v1 稳定类型 port；避免带入 v1.5 平台和大段选择器配置。

## 完成后

```bash
git add -A
git commit -m "feat(task): port listing shared types"
python3 .trellis/scripts/task.py archive 05-23-listing-types-port
```
