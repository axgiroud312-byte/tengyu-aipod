# Task: v1.5: 服务端风控（v1.5 - 服务端）

## 目标

异常激活检测 + 飞书告警。

## 输入

参考文档（按重要性排序）：
- `docs/spec/08-server.md §8`

## 验收标准

- [ ] 服务端每次 /api/activate 后跑 detectSuspiciousActivation
- [ ] 规则：同码 24h 内激活 > 2 个不同国家 IP / 同 device_fingerprint 7 天内用 > 3 个不同码
- [ ] 命中规则 → 写 alerts 表 + 调飞书 webhook
- [ ] Admin 后台 /admin/alerts 列表
- [ ] 可一键封号或申诉

## 不做

- 无明确排除项（按需收敛）

## 实施提示

IP 地理用 GeoIP-Lite 或调阿里云 IP 接口。

## 完成后

```bash
git add -A
git commit -m "feat(task v1.5): server risk detection"
python3 .trellis/scripts/task.py archive 05-23-v15-risk-detection
```
