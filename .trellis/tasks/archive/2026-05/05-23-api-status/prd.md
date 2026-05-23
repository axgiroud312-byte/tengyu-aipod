# Task: GET /api/status（切片 1 - 第 6 个）

## 目标

实现客户端定期查询激活状态的接口。

## 输入

- 参考：`docs/spec/08-server.md §4.1, §5.2`

## 验收标准

### 接口契约

```
GET /api/status
Header: Authorization: Bearer <activation_token>

Response 200:
  { ok: true, data: {
      status: 'active' | 'expired' | 'banned',
      days_remaining: number,
      max_devices: number,
      used_devices: number,
      device_name: string,
      customer: { name?, has_contact: boolean } | null,
    }
  }

Response 401:
  { ok: false, error: { code: 'UNAUTHORIZED' } }
```

### 业务逻辑

- [ ] 解 Bearer token → 调 `verifyClientJwt`
- [ ] 查 `DeviceActivation by id = jwt.sub`：
  - 不存在 → `DEVICE_UNBOUND`（用户被你后台解绑了）
  - 关联的 `ActivationCode.is_active = false` → `status='banned'`
  - 关联的 `Customer.is_active = false` → `status='banned'`
- [ ] 算 `days_remaining = (expires_at - now) / day`：
  - < 0 → `status='expired'`
  - 否则 `status='active'`
- [ ] 更新 `DeviceActivation.last_active_at = now()`
- [ ] 算 `used_devices = count(DeviceActivation where code_id)`
- [ ] 返回（含客户信息，但**只返回 has_contact 不返回完整手机号**，保护客户隐私）

### 性能

- [ ] 单次响应 < 100ms（P95）
- [ ] 客户端每 30 分钟轮询，预期总 QPS < 10

### Rate limit

- [ ] 同 token 每分钟 60 次

## 不做

- 不重发 JWT（让客户端继续用旧 token，到期前重新激活）
- 不返回客户的完整手机号（隐私）

## 实施提示

```ts
// app/api/status/route.ts
import { verifyClientJwt } from '@/lib/jwt'

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return Response.json({ ok: false, error: { code: 'UNAUTHORIZED' }}, { status: 401 })
  
  const payload = verifyClientJwt(auth.substring(7))
  if (!payload) return Response.json({ ok: false, error: { code: 'INVALID_TOKEN' }}, { status: 401 })
  
  const device = await db.deviceActivation.findUnique({
    where: { id: payload.sub },
    include: { code: { include: { customer: true, devices: true }}},
  })
  if (!device) return Response.json({ ok: false, error: { code: 'DEVICE_UNBOUND' }}, { status: 401 })
  
  // ... 算 status / days_remaining
  
  await db.deviceActivation.update({
    where: { id: device.id },
    data: { last_active_at: new Date() },
  })
  
  return Response.json({ ok: true, data: { ... }})
}
```

## 完成后

```bash
git add -A
git commit -m "feat(task-11): GET /api/status endpoint"
python3 .trellis/scripts/task.py archive 05-23-api-status
```
