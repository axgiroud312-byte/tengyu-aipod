# Task: Temu PopTemu - smoke 真实验证（切片 8 - 上架 - Temu PopTemu）

## 目标

在真实店小秘环境跑一遍完整 listing 验证。

## 输入

参考文档（按重要性排序）：
- 无（按 spec 通用约束）

## 验收标准

- [ ] 准备：登录店小秘 + 创建测试草稿模板（Temu PopTemu）
- [ ] 准备：1 个测试货号（含标题 + 3 张图）
- [ ] 跑：上架到测试草稿（不真发布）
- [ ] 验证：12 阶段全部完成 + listing_status='success'
- [ ] 验证：店小秘后台能看到新草稿
- [ ] 把验证记录写到 .trellis/tasks/05-23-listing-temu-smoke/info.md

## 不做

- 不真发布到 Temu（用保存草稿模式）
- 不在 CI 跑

## 实施提示

用你自己的店小秘账号 + 测试店铺。

## 完成后

```bash
git add -A
git commit -m "test(task): temu pop manual smoke validation"
python3 .trellis/scripts/task.py archive 05-23-listing-temu-smoke
```
