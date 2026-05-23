# Task: 服务端 Platform Rules API（切片 6 - 采集）

## 目标

`GET /api/platform-rules` 派发采集和上架的平台规则。

## 输入

参考文档（按重要性排序）：
- `docs/spec/02-collection.md §6, §11`
- `docs/spec/08-server.md §3` PlatformRule 模型

## 验收标准

- [ ] 支持 category 过滤（'collection' | 'listing'）
- [ ] 返回 PlatformRule[]
- [ ] rules_json 反序列化为 object
- [ ] 客户端 JWT 校验
- [ ] 版本变化时客户端能识别（响应含 version）

## 不做

- 无明确排除项（按需收敛）

## 实施提示

采集规则示例：temu/ozon/shein 等的 url 规则、登录检测、原图提取规则。

## 完成后

```bash
git add -A
git commit -m "feat(task): server platform rules API"
python3 .trellis/scripts/task.py archive 05-23-server-api-platform-rules
```
