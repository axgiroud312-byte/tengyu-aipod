# Task: 服务端 Provider Registry API（切片 4 - 生图 Grsai）

## 目标

实现 `GET /api/providers` 接口，派发付费生图/视觉LLM/comfyui-cloud 三类 provider 配置。

## 输入

参考文档（按重要性排序）：
- `docs/spec/08-server.md §4.2`
- `docs/adr/0003-skill-and-provider-cloud-dispatch.md`

## 验收标准

- [ ] `GET /api/providers` 支持 query `type`（'paid-generation' | 'vision-llm' | 'comfyui-cloud'）
- [ ] 返回 Provider[]：含 id/name/base_url/api_style/endpoints/model_options
- [ ] 不返回任何 API Key（Key 留用户本机）
- [ ] 客户端 JWT 校验
- [ ] 排序按 sort_order asc
- [ ] 禁用的 provider 不返回

## 不做

- 不接收用户的 API Key（架构红线）

## 实施提示

endpoints/model_options/default_params 用 String + JSON，response 时解析返回 object。

## 完成后

```bash
git add -A
git commit -m "feat(task): server provider registry API"
python3 .trellis/scripts/task.py archive 05-23-server-api-providers
```
