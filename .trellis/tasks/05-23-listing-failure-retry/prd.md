# Task: 上架失败列表和重试（切片 8 - 上架）

## 目标

失败列表 UI + [重试失败] 按钮。

## 输入

参考文档（按重要性排序）：
- `docs/spec/07-listing.md`
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

重试入口必须沿用 5 项核心动作流程：替换店铺名称、替换标题、替换图片、一键生成 SKU、一键上传视频。

## 验收标准

- [x] 执行完成显示失败列表：货号 / 错误码 / 错误消息
- [x] [查看证据] 链接打开 .workbench/tmp/listing/{taskId}/evidence/...
- [x] [重试该货号] 单条重试
- [x] [全部重试失败] 批量重试
- [x] 重试时查 listing_status 只跑 failed
- [x] 失败列表通过主进程 IPC 读取 listing_status，不在渲染进程直接读 sqlite
- [x] 证据路径用主进程 shell.openPath 打开

## 不做

- 无明确排除项（按需收敛）

## 实施提示

证据路径打开用 shell.openPath。

## 完成后

```bash
git add -A
git commit -m "feat(task): listing failure list and retry UI"
python3 .trellis/scripts/task.py archive 05-23-listing-failure-retry
```
