# Task: 客户端 Skill 缓存（切片 2 - 标题生成模块）

## 目标

客户端启动时拉 skill 列表 + 30 分钟刷新 + 按需拉取 skill 详情 + 缓存到 `.workbench/cache/skills/`。

## 输入

参考文档（按重要性排序）：
- `docs/spec/00-overview.md §5`
- `docs/spec/03-generation.md §3.3`

## 验收标准

- [ ] 主进程 `SkillCacheManager` 单例
- [ ] `getSkill(id, version?): Promise<Skill>`：先查缓存，缺则拉服务器
- [ ] `listSkills(filter): Promise<SkillSummary[]>`
- [ ] 启动时拉一次全量列表 + 每 30 分钟后台静默刷新
- [ ] 用户进具体模块面板时若上次刷新 > 30 分钟立即重拉对应模块的 skill
- [ ] 缓存文件路径 `.workbench/cache/skills/{skill_id}/{version}.json`
- [ ] 失败时用本地缓存兜底（最多 7 天）
- [ ] IPC `skill:list` / `skill:get` 暴露给渲染进程

## 不做

- 不在渲染进程实现缓存（统一主进程）
- 不持久化缓存到 DB（用文件系统）

## 实施提示

用 chokidar 监听本地 skill 文件变化（仅 dev 模式）方便快速测试。

## 完成后

```bash
git add -A
git commit -m "feat(task): client skill cache manager"
python3 .trellis/scripts/task.py archive 05-23-client-skill-cache
```
