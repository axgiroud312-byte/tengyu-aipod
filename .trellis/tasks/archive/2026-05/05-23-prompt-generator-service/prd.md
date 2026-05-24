# Task: 提示词生成器服务（切片 4 - 生图 Grsai）

## 目标

调 LLM 生成 N 条印花提示词 + 通用解析器（支持 JSON / 换行 / 序号去除）。

## 输入

参考文档（按重要性排序）：
- `docs/spec/03-generation.md §3-4`

## 验收标准

- [ ] `generatePrompts(skill, variables, refImages?): Promise<string[]>`
- [ ] 拉 skill（按 module=generation + category=txt2img/img2img/extract）
- [ ] 注入变量到 system prompt
- [ ] 如果有 refImages：用 visionCompletion，否则 chatCompletion
- [ ] 调用百炼，response_format=json_object（如果 skill 约束 JSON）
- [ ] 通用解析器三级 fallback：JSON → 代码块 JSON → 按行拆
- [ ] 返回 prompts 数组，slice 到用户指定数量
- [ ] vitest 单测覆盖各种 LLM 输出格式

## 不做

- 不实现「提示词编辑历史」（v1.5）

## 实施提示

通用解析器的正则 spec §3.3 有完整代码。

## 完成后

```bash
git add -A
git commit -m "feat(task): prompt generator service"
python3 .trellis/scripts/task.py archive 05-23-prompt-generator-service
```
