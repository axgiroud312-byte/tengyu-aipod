# Task: 服务端 Skill 派发 API（切片 2 - 标题生成模块）

## 目标

实现 `GET /api/skills` 列表 + `GET /api/skills/:id` 详情，按 module/category/platform/language 过滤。

## 输入

参考文档（按重要性排序）：
- `docs/spec/08-server.md §4.2`
- `docs/spec/06-title.md §3.1` (skill 索引策略)

## 验收标准

- [ ] `GET /api/skills` 支持 query: `module`, `category`, `platform`, `language`, 返回 SkillSummary[]（不含 system_prompt 全文）
- [ ] `GET /api/skills/:id` 支持 query `version`（可选），返回 Skill 完整内容
- [ ] 客户端 JWT middleware 校验（除非 dev 环境）
- [ ] 未匹配时按 platform→language→generic fallback（spec §3.1）
- [ ] 支持版本过滤：`?version=3.0.1` 取指定版本，缺省取最新启用版本
- [ ] 返回 `data.version` 字段方便客户端缓存比较
- [ ] vitest 单测覆盖：精确匹配 / fallback / 版本回滚 / 禁用 skill 不返回

## 不做

- 不实现 admin 后台 CRUD（留 admin-skills-ui task）
- 不实现遥测

## 实施提示

用 Prisma 的 `where + orderBy + take` 实现优先级匹配。fallback 用多次查询而不是 SQL CASE（更清晰）。

## 完成后

```bash
git add -A
git commit -m "feat(task): server skills dispatch API"
python3 .trellis/scripts/task.py archive 05-23-server-api-skills
```
