# Task: v1.5: 上架选择器云端派发（v1.5 - 服务端）

## 目标

店小秘改版时只发布新选择器版本，不发新客户端。

## 输入

参考文档（按重要性排序）：
- `docs/spec/07-listing.md §12`

## 验收标准

- [ ] 服务端 DB 加 selectors 表（platform / version / selectors_json / effective_from）
- [ ] GET /api/listing/selectors/:platform?current_version=...
- [ ] Admin 后台 /admin/listing-selectors 编辑界面
- [ ] 客户端启动时拉最新版 → 缓存到 .workbench/cache/listing-selectors/
- [ ] 客户端运行时优先用缓存版而非代码内默认值

## 不做

- 无明确排除项（按需收敛）

## 实施提示



## 完成后

```bash
git add -A
git commit -m "feat(task v1.5): listing selectors cloud dispatch"
python3 .trellis/scripts/task.py archive 05-23-v15-selectors-dispatch
```
