# Task: POST /api/activate（切片 1 - 第 5 个）

## 目标

实现客户端激活的核心接口。

## 输入

- 参考：`docs/spec/08-server.md §4.1, §5.1-5.2`

## 验收标准

### 接口契约

```
POST /api/activate
Body: { code: string, device_fingerprint: string, device_name?: string }

Response 200:
  { ok: true, data: {
      activation_token: string,        // JWT
      expires_at: number,               // ms
      max_devices: number,
      used_devices: number,
      device_name: string,
    }
  }

Response 4xx (statusCode 400 / 403):
  { ok: false, error: { code, message } }
```

### 业务逻辑

- [ ] 输入用 zod 校验
- [ ] 查 `ActivationCode` by `code`：
  - 不存在 → 返回 `INVALID_CODE`
  - `is_active=false` → `CODE_BANNED`
  - 关联的 `Customer.is_active=false` → `CUSTOMER_BANNED`
- [ ] 检查 `expires_at`（若已激活过）：
  - 已过期 → `CODE_EXPIRED`
- [ ] 检查 `device_fingerprint` 是否已注册到**别的码**：
  - 是 → `ALREADY_ACTIVATED_BY_OTHER`（或允许，看产品决策；推荐拒绝）
- [ ] 检查同码已激活的设备数：
  - `count(DeviceActivation where code_id) >= max_devices` 且本设备未在内 → `DEVICE_LIMIT_REACHED`
- [ ] 首次激活：
  - 设置 `ActivationCode.activated_at = now()`
  - 设置 `ActivationCode.expires_at = now() + days_total * day`
- [ ] 创建/更新 `DeviceActivation` 行
- [ ] 签发 JWT（payload: `{ sub: device_activation.id, code, device_fp, exp }`，有效期 30 天）
- [ ] 返回 token + 状态

### 测试

- [ ] vitest 单测：覆盖正常激活 / 各种错误码
- [ ] 用 supertest 跑端到端

### 安全

- [ ] Rate limit：同 IP 每分钟 10 次（用 `next-rate-limit` 或自实现）
- [ ] 不暴露内部错误（数据库错误统一返回 `INTERNAL_ERROR`）

## 不做

- 不实现 /api/refresh（v1 token 7-30 天 + 重新激活即可）
- 不实现 OAuth / 邮箱验证

## 实施提示

```ts
// app/api/activate/route.ts
import { z } from 'zod'
import { db } from '@/lib/db'
import { signClientJwt } from '@/lib/jwt'

const Schema = z.object({
  code: z.string().regex(/^POD-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/),
  device_fingerprint: z.string().length(64),
  device_name: z.string().max(40).optional(),
})

export async function POST(req: Request) {
  const body = await req.json()
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return ok(false, 'INVALID_INPUT', 400)
  
  const result = await db.$transaction(async (tx) => {
    const code = await tx.activationCode.findUnique({
      where: { code: parsed.data.code },
      include: { customer: true, devices: true },
    })
    if (!code) throw new ActivateError('INVALID_CODE', 404)
    if (!code.is_active) throw new ActivateError('CODE_BANNED', 403)
    if (code.customer && !code.customer.is_active) throw new ActivateError('CUSTOMER_BANNED', 403)
    
    // ... 业务校验 + 写 device + 算 expires_at
    return { device, code }
  })
  
  const token = signClientJwt({ sub: result.device.id, code: result.code.code, device_fp: parsed.data.device_fingerprint })
  return Response.json({ ok: true, data: { activation_token: token, ... } })
}
```

## 完成后

```bash
git add -A
git commit -m "feat(task-10): POST /api/activate with JWT signing"
python3 .trellis/scripts/task.py archive 05-23-api-activate
```
