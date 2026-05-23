# Task: 生图 ComfyUI E2E（切片 5 - 生图 ComfyUI）

## 目标

ComfyUI 4 能力 E2E 测试（mock）。

## 输入

参考文档（按重要性排序）：
- 无（按 spec 通用约束）

## 验收标准

- [ ] Mock 晨羽 API + ComfyUI HTTP
- [ ] 提取 / 图生图 / 抠图直接 / 抠图混合 4 个用例
- [ ] 断言：input_slots 注入正确
- [ ] 断言：output 文件名解析正确
- [ ] 断言：产物落到正确目录
- [ ] 断言：临时文件清理

## 不做

- 不在 CI 跑真实晨羽（手动测试）

## 实施提示

Mock ComfyUI 用 msw 拦截 server_url 域名。

## 完成后

```bash
git add -A
git commit -m "feat(task): generation comfyui e2e tests"
python3 .trellis/scripts/task.py archive 05-23-generation-comfyui-e2e
```
