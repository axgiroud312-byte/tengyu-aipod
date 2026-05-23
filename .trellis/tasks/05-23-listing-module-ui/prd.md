# Task: 上架模块前端 UI（切片 8 - 上架）

## 目标

上架模块的 UI（批次选择 + profile 多选 + 草稿模板 + 高级配置 + 进度）。

## 输入

参考文档（按重要性排序）：
- `docs/spec/07-listing.md §6`

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
