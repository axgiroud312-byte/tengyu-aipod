# Task: 检测后一键流转到待套版（切片 3 - 侵权检测）

## 目标

把 `03-检测/pass/` 的图一键复制/移动到 `04-待套版印花/`。

## 输入

参考文档（按重要性排序）：
- `docs/spec/04-detection.md §7`

## 验收标准

- [ ] UI 按钮 [一键加入待套版]
- [ ] 弹窗：复制（推荐保留 03/pass 副本）/ 移动
- [ ] 执行：for img in 03/pass/*: copy or move to 04-待套版印花/{印花ID}.{ext}
- [ ] artifact 表登记新 record（step=matting 或保留 step=extract 但加入 04 引用）
- [ ] 成功后 toast 提示数量

## 不做

- 不实现选择性流转（v1 一键全部）

## 实施提示

用 fs.cp / fs.rename。冲突文件用印花 ID 重命名。

## 完成后

```bash
git add -A
git commit -m "feat(task): detection promote to matting"
python3 .trellis/scripts/task.py archive 05-23-detection-promote-to-matting
```
