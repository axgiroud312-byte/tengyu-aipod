# Task: Shein - action-executor.ts（切片 8 - 上架 - Shein）

## 目标

Shein 动作执行器。

## 输入

参考文档（按重要性排序）：
- `docs/spec/07-listing.md §2.3`
- `docs/adr/0004-listing-direct-port-with-rewrite.md`
- `/Users/macmini/Desktop/一键pod/上架程序`（只作 research 上下文，不 Port DOM 代码）

## 验收标准

- [ ] 同 temu-executor，但跑在真实 Shein 草稿页面

## 核心动作（5 项必做）

参考 `/Users/macmini/Desktop/一键pod/上架程序`：

1. **替换店铺名称**
2. **替换标题**
3. **替换图片**（按 Shein 颜色组规则分批上传）
4. **一键生成 SKU**
5. **一键上传视频**

## 真实测试基线（MVP v1）

真实模板：https://www.dianxiaomi.com/web/sheinProduct/edit?id=128935201966452551

素材：`/Users/macmini/Desktop/服装素材摆放举例/GzG0001`

接入：bit-browser `2-1111` + connectOverCDP。

测试守护：`REAL_LISTING=1` 启用真实 DOM 测试；图片上传、视频上传、一键生成 SKU 必须再显式设置 `REAL_LISTING_MUTATE=1`。

## 不做

- 无明确排除项（按需收敛）

## 实施提示

Shein 上传逻辑可能与 Temu 不同（如必须按颜色组分批上传）。

## 完成后

```bash
git add -A
git commit -m "feat(task): shein action executor"
python3 .trellis/scripts/task.py archive 05-23-listing-shein-executor
```
