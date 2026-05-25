# Task: Shein - selectors.ts（切片 8 - 上架 - Shein）

## 目标

Shein 平台的选择器表。

## 输入

参考文档（按重要性排序）：
- `docs/spec/07-listing.md §2.1`
- `docs/adr/0004-listing-direct-port-with-rewrite.md`
- `/Users/macmini/Desktop/一键pod/上架程序`（只作 research 上下文，不 Port DOM 代码）

## 验收标准

- [ ] 同 temu-selectors 但针对 Shein 草稿页
- [ ] 为 5 项核心动作准备 selector key：替换店铺名称、替换标题、替换图片、一键生成 SKU、一键上传视频
- [ ] 真实 selector 测试默认跳过，`REAL_LISTING=1` 时连接 `2-1111` + 真实 Shein 模板页

## 真实测试基线（MVP v1）

**测试目标 = 主理人本机比特浏览器 `2-1111` 窗口 + 真实店小秘 Shein 草稿**。禁止 fixture / mock。

v1 真实模板：
- Shein：https://www.dianxiaomi.com/web/sheinProduct/edit?id=128935201966452551

接入：bit-browser-adapter list-profiles 找 `2-1111` → connectOverCDP。

测试守护：`REAL_LISTING=1` 启用，CI 默认跳过。

参考：`/Users/macmini/Desktop/一键pod/上架程序`（只 Port 框架）。
真实素材路径：`/Users/macmini/Desktop/服装素材摆放举例/GzG0001`。

## 不做

- 禁止抄 temu 的 selectors（独立侦察）

## 实施提示

Shein 草稿页结构与 Temu 不同，工作流 stage 也可能不同。

## 完成后

```bash
git add -A
git commit -m "feat(task): shein selectors"
python3 .trellis/scripts/task.py archive 05-23-listing-shein-selectors
```
