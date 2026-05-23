# Task: Temu PopTemu - selectors.ts（切片 8 - 上架 - Temu PopTemu）

## 目标

Temu PopTemu 平台的选择器表（只放静态规则）。

## 输入

参考文档（按重要性排序）：
- `docs/spec/07-listing.md §2.1`
- `docs/adr/0004` 重写策略

## 验收标准

- [ ] **先打开真实店小秘 Temu PopTemu 草稿页面侦察**
- [ ] 列出所有要操作的字段的候选选择器（css/text/label/placeholder/role 多前缀）
- [ ] 覆盖：title_input / sku_input / publish_button / material_images / video_uploader / size_chart_dropdown / color_skc / etc.
- [ ] 登录页判定 indicators 列表
- [ ] 成功 toast / 失败 toast 选择器
- [ ] 每个 selector 至少 2 个候选（fallback）
- [ ] 侦察过程截图 + DOM 快照保存到 evidence/

## 不做

- 不访问页面（这是静态规则，不读 DOM）
- 不点击（不写动作）

## 实施提示

**必须按 listing-automation-builder SKILL 流程：先侦察后实现**。

## 完成后

```bash
git add -A
git commit -m "feat(task): temu pop selectors"
python3 .trellis/scripts/task.py archive 05-23-listing-temu-selectors
```
