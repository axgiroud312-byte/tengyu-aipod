# Task: Port 一键pod shared 类型和错误码（切片 8 - 上架）

## 目标

从 `一键pod/上架程序/packages/shared` Port 关键类型到腾域。

## 输入

参考文档（按重要性排序）：
- `docs/spec/07-listing.md §1.1`

## 验收标准

- [ ] 复制 listing 相关类型到 packages/shared/src/listing-types.ts
- [ ] 包括 ListingItem / ListingConfig / ListingResult / StageResult / WorkspaceResult
- [ ] 重命名以适应腾域命名（如有冲突）
- [ ] Listing 错误码 enum 复制到 listing 子模块
- [ ] ts 编译通过

## 不做

- 不 port 业务逻辑代码（留各自 task）

## 实施提示

用 git log 看一键pod 哪些类型最新，挑稳定的 port。

## 完成后

```bash
git add -A
git commit -m "feat(task): port listing shared types"
python3 .trellis/scripts/task.py archive 05-23-listing-types-port
```
