# Task: 上架模块前端 UI（切片 8 - 上架）

## 目标

上架模块的 UI（批次选择 + profile 多选 + 草稿模板 + 高级配置 + 进度）。

## 输入

参考文档（按重要性排序）：
- `docs/spec/07-listing.md §6`
- `docs/adr/0004-listing-direct-port-with-rewrite.md`
- `/Users/macmini/Desktop/一键pod/上架程序`（只作 research 上下文，不 Port DOM 代码）

## 真实测试基线（MVP v1）

全部真实验证都以主理人本机比特浏览器 `2-1111` 窗口 + 真实店小秘为目标，接入方式必须是 `bit-browser-adapter list-profiles` 找到 `2-1111`，再通过 `connectOverCDP` 接入；禁止新建 profile 或 mock CDP。

测试守护：`REAL_LISTING=1` 才启用真实 DOM 测试，CI / 默认测试跳过；破坏性动作（生成 SKU / 上传图片 / 上传视频）必须再显式设置 `REAL_LISTING_MUTATE=1`。

3 个真实模板：
- Temu 服装：https://www.dianxiaomi.com/web/popTemu/edit?id=128935194843933515
  - 素材：`/Users/macmini/Desktop/服装素材摆放举例`（排除 `GzG00010`）
- Temu 百货：https://www.dianxiaomi.com/web/popTemu/edit?id=128935194833519551
  - 素材：`/Users/macmini/Desktop/素材文件夹`
- Shein：https://www.dianxiaomi.com/web/sheinProduct/edit?id=128935201966452551
  - 素材：`/Users/macmini/Desktop/服装素材摆放举例/GzG0001`

UI 配置必须能驱动 5 项核心动作：替换店铺名称、替换标题、替换图片、一键生成 SKU、一键上传视频。

## 验收标准

- [ ] 批次目录选择（默认 05-货号成品/）+ 扫描结果（货号数 + 已有标题数 + 缺标题警告）
- [ ] 平台选择（v1: Temu/Shein）
- [ ] 比特浏览器工作区多选（显示 profile 状态：已登录/未登录/被采集占用）
- [ ] 草稿模板 ID 手填输入框
- [ ] SKU 编码策略 / 提交方式 radio
- [ ] 高级折叠：每店铺并发 / 失败重试 / 连续失败暂停阈值 / 断点续传
- [ ] 预估耗时显示
- [ ] [开始上架]
- [ ] 执行中：每个 workspace 一行进度
- [ ] 复用现有 generation / detection 工作台 UI 模式（主内容区 + 右侧工作台/概览），不重写整体路由结构
- [ ] 只通过既有 IPC / 必要的 listing IPC 接入，不在渲染进程直接访问文件系统或比特浏览器

## 不做

- v1 草稿模板用户手填（不内置常用模板列表）

## 实施提示

用 shadcn/ui 的 Accordion 折叠高级配置。

## 完成后

```bash
git add -A
git commit -m "feat(task): listing module UI"
python3 .trellis/scripts/task.py archive 05-23-listing-module-ui
```
