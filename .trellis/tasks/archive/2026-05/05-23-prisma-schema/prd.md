# Task: Prisma Schema 和 Migrations（切片 1 - 第 1 个）

## 目标

把完整的服务端数据库 schema 写到 `packages/server/prisma/schema.prisma`，跑通 `prisma migrate dev`。

## 输入

- **完整 schema 在 `docs/spec/08-server.md §3`**，照着抄即可。

## 验收标准

- [ ] `packages/server/prisma/schema.prisma` 含以下模型（与 spec/08-server §3 完全一致）：
  - `Customer`
  - `ActivationCode`
  - `DeviceActivation`
  - `Skill` (含 SkillModule enum)
  - `Provider`
  - `ComfyuiWorkflow`
  - `PlatformRule`
  - `Announcement`
  - `ClientVersion`
  - `Admin`
  - `TelemetryError`
- [ ] 删除 task-server-nextjs-skeleton 留下的 `_Placeholder` 模型
- [ ] 所有 enum / index / unique constraint 与 spec 一致
- [ ] `pnpm -F @tengyu-aipod/server prisma migrate dev --name init` 成功生成 migration
- [ ] `pnpm -F @tengyu-aipod/server prisma generate` 成功生成 Prisma Client
- [ ] `pnpm -F @tengyu-aipod/server type-check` 通过

## 不做

- 不写 seed 数据（v1 后台手动建数据）
- 不实现任何 API endpoint
- 不实现 admin UI

## 实施提示

特别注意：

- `Customer.phone` 是 `@unique`（用于智能匹配老客户）
- `ActivationCode.customer_id` 是**可空**（支持匿名码）
- `DeviceActivation.code_id` + `device_fingerprint` 是复合 unique（同码同设备不能激活两次）
- 所有 enum 用 `enum SkillModule { generation detection title }` 风格
- 时间字段统一用 `DateTime` + `@default(now())` / `@updatedAt`

## 完成后

```bash
git add -A
git commit -m "feat(task-06): full prisma schema with 11 models"
python3 .trellis/scripts/task.py archive 05-23-prisma-schema
```
