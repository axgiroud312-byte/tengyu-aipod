# 采集功能说明

采集模块面向跨境电商页面图片采集，当前重点支持 Temu 的图池扫描、商品详情主图采集、点击采集和实时日志排查。

## 图池采集规则

- 搜索页/列表页：扫描当前页面里的商品列表图片，进入“散图”池；下载时直接保存到 `01-采集工作区/<平台-时间>/`。
- 商品详情页：只采集商品详情页左侧主图/轮播主图区域，进入“商品页”分组；下载时保存到 `01-采集工作区/<平台-时间>/商品页/<商品分组>`。
- 点击采集：保留原有点击图片即采集的流程，并继续通过采集会话记录保存结果。
- Temu 图片 URL 会尽量升级到高分辨率下载地址，例如 `w/1300/q/90`，前端尺寸显示以下载预估尺寸为主。

## 前端数据流

- `App.tsx` 负责保存图池状态、选中状态、当前页面检测结果、扫描/下载结果和运行期日志。
- `image-pool.ts` 负责把扫描结果合并进图池，并按“散图”和“商品页分组”整理展示。
- `CollectionPage.tsx` 负责采集页 UI：扫描、全选、下载、商品页文件夹预览、散图预览和日志弹窗。

## 主进程数据流

- `collection-image-index-service.ts` 通过比特浏览器 CDP 获取当前平台页面，执行页面扫描脚本，产出可下载图片索引。
- 扫描结果会标记 `bucket`、`pageKind`、`groupKey`、`groupTitle` 和 `coverUrl`，用于前端分组和后续保存目录区分。
- 下载仍采用逐张串行下载，避免过高并发触发平台/CDN 限制；每张图片成功或失败都会记录日志。

## 日志窗口

- 采集页顶部“日志”按钮会打开命令行风格弹窗。
- 日志通过现有 `collection:event` / `debug-log` 通道实时进入前端，不写入本地文件。
- 日志最多保留最近 `1000` 条，应用重启后清空。
- 扫描日志显示页面级进度；下载日志显示逐张进度、文件大小、耗时、保存路径或错误原因。
- 弹窗打开时会自动滚动到底部，并提供“清空”按钮。

## 验证命令

```bash
pnpm --dir packages/client exec biome check src/main/lib/collection-image-index-service.ts src/main/lib/collection-image-index-service.test.ts src/renderer/src/App.tsx src/renderer/src/features/collection/CollectionPage.tsx src/renderer/src/features/collection/collection-debug-log.ts src/renderer/src/features/collection/collection-debug-log.test.ts
pnpm --dir packages/client exec vitest run src/main/lib/collection-image-index-service.test.ts src/renderer/src/features/collection/image-pool.test.ts src/renderer/src/features/collection/collection-debug-log.test.ts --maxWorkers=1
```
