# Task: ComfyUI 实例生命周期管理（切片 5 - 生图 ComfyUI）

## 目标

实例创建/启停/销毁 + 费用展示 + 定时关机配置。

## 输入

参考文档（按重要性排序）：
- `docs/spec/03-generation.md §9`

## 验收标准

- [ ] 类 `ComfyuiInstanceManager`
- [ ] 状态：none / starting / running / shutting_down / stopped
- [ ] [创建实例] 向导：选 Pod / 选 GPU / 选自动关机时长（默认 60 分钟）
- [ ] 创建时自动调 setShutdownTimer 设定时关机
- [ ] 实例信息卡片：UUID / GPU / ComfyUI URL / 已运行时长 / 累计费用估算
- [ ] [立即关机] / [重启] / [延长关机时间] / [销毁实例]（销毁需二次确认）
- [ ] 费用估算：已运行分钟 × pod_price + gpu_price
- [ ] 余额展示（每 60 秒 getBalance）
- [ ] 数据库 comfyui_instances 单行存储
- [ ] 启动客户端时检测实例是否还在 running

## 不做

- 不实现多实例（v1 单实例）
- v1 不上空闲自动关机（晨羽 API 未上线）

## 实施提示

ComfyUI URL 从 instance.server_map 找 port_type=http 且 title 含 ComfyUI 的条目。

## 完成后

```bash
git add -A
git commit -m "feat(task): comfyui instance manager"
python3 .trellis/scripts/task.py archive 05-23-comfyui-instance-manager
```
