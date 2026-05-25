# Task: Shein - workflow.ts（切片 8 - 上架 - Shein）

## 目标

Shein 业务工作流。

## 输入

参考文档（按重要性排序）：
- `docs/spec/07-listing.md §2.4`
- `docs/adr/0004-listing-direct-port-with-rewrite.md`
- `/Users/macmini/Desktop/一键pod/上架程序`（只作 research 上下文，不 Port DOM 代码）

## 验收标准

- [ ] 按真实 Shein 草稿流程定义 stages（可能不同于 Temu 的 12 个）
- [ ] 完整覆盖 5 项核心动作（替换店铺名 / 替换标题 / 替换图片 / 一键生成 SKU / 一键上传视频）

## 真实测试基线（MVP v1）

真实模板：https://www.dianxiaomi.com/web/sheinProduct/edit?id=128935201966452551

素材：`/Users/macmini/Desktop/服装素材摆放举例/GzG0001`

接入：bit-browser `2-1111` + connectOverCDP。

测试守护：`REAL_LISTING=1` 启用，CI 默认跳过；图片上传、视频上传、一键生成 SKU 必须再显式设置 `REAL_LISTING_MUTATE=1`。

参考：`/Users/macmini/Desktop/一键pod/上架程序`（只 Port 框架）。

## 不做

- 无明确排除项（按需收敛）

## 实施提示

侦察确定 stage 列表后再写。

## 完成后

```bash
git add -A
git commit -m "feat(task): shein workflow"
python3 .trellis/scripts/task.py archive 05-23-listing-shein-workflow
```
