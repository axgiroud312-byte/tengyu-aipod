# Task: 晨羽智云 Adapter（切片 5 - 生图 ComfyUI）

## 目标

封装晨羽智云 API：Pod/GPU 查询、实例创建/状态/启停/销毁、定时关机、余额查询。

## 输入

参考文档（按重要性排序）：
- `references/generation-comfyui/chenyu-cloud-api.md`

## 验收标准

- [ ] 类 `ChenyuCloudClient`
- [ ] 方法：listPods, listGpus, listImages, createByPod, getInstanceInfo, listInstances, startup, shutdown, restart, setShutdownTimer, destroy, getBalance
- [ ] Bearer auth，base URL https://www.chenyu.cn/api/open/v2
- [ ] 响应 code !== 0 时抛 AppError
- [ ] 限速 429 退避重试
- [ ] 实例状态码 enum: 1=initializing, 2=running, 21=shutting_down, 22=stopped
- [ ] vitest 单测 + msw mock

## 不做

- v1 不调用 workflow/run/submit（标记 draft 不稳定，spec/03 §2.4）
- 不调用 set_idle_close（未上线）

## 实施提示

shutdown_timer 的 shutdown_time 字段语义实施时确认（文档自相矛盾，参考 spec/03 §9.2 描述）。

## 完成后

```bash
git add -A
git commit -m "feat(task): chenyu cloud adapter"
python3 .trellis/scripts/task.py archive 05-23-chenyu-cloud-adapter
```
