# Task: Shein - page-parser.ts（切片 8 - 上架 - Shein）

## 目标

Shein 页面状态解析器。

## 输入

参考文档（按重要性排序）：
- `docs/spec/07-listing.md §2.2`
- `docs/adr/0004-listing-direct-port-with-rewrite.md`
- `.trellis/tasks/archive/2026-05/05-23-listing-shein-selectors/evidence/shein-selector-scout.json`
- `/Users/macmini/Desktop/一键pod/上架程序`（只作 research 上下文，不 Port DOM 代码）

## 验收标准

- [ ] 同 temu-parser，但断言打在真实 Shein 草稿 DOM 上
- [ ] 返回 Shein 页面 observed_state：页面上下文、店铺、标题、货号、变种表、变种图、详情图、SKU 生成入口、保存/发布入口
- [ ] Parser 只读 DOM，不点击、不上传、不传 ElementHandle 给 executor
- [ ] 为 5 项核心动作提供状态输入：替换店铺名称、替换标题、替换图片、一键生成 SKU、一键上传视频

## 真实测试基线（MVP v1）

真实模板：https://www.dianxiaomi.com/web/sheinProduct/edit?id=128935201966452551

真实素材路径：`/Users/macmini/Desktop/服装素材摆放举例/GzG0001`

接入：bit-browser `2-1111` + connectOverCDP。

测试守护：`REAL_LISTING=1` 启用。

参考：`/Users/macmini/Desktop/一键pod/上架程序`。

## 不做

- 无明确排除项（按需收敛）

## 实施提示



## 完成后

```bash
git add -A
git commit -m "feat(task): shein page parser"
python3 .trellis/scripts/task.py archive 05-23-listing-shein-parser
```
