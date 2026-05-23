# Task: Admin 认证 + JWT（切片 1 - 第 2 个）

## 目标

实现 `/admin/login` 邮箱密码登录 + JWT 签发 + middleware 路由保护。

## 输入

- 参考：`docs/spec/08-server.md §5.3`（Admin 登录）+ §7（路由保护）

## 验收标准

- [ ] `/admin/login` 页面：邮箱 + 密码表单
- [ ] `POST /admin/api/login`：
  - 用 bcrypt.compare 验证密码
  - 签发 admin JWT（含 sub, role, exp）
  - 写 httpOnly cookie 名 `admin_token`
  - 返回 `{ ok: true, admin: { name, role } }`
- [ ] `POST /admin/api/logout`：清 cookie
- [ ] `packages/server/src/lib/jwt.ts`：提供 `signAdminJwt` / `verifyAdminJwt`
- [ ] `packages/server/src/middleware.ts`：
  - 拦截所有 `/admin/*`（除了 `/admin/login`）
  - 验证 cookie 里的 admin_token
  - 验证失败 → redirect 到 `/admin/login`
- [ ] `packages/server/prisma/seed.ts`：建初始 admin 账号（用环境变量 `ADMIN_INITIAL_EMAIL` + `ADMIN_INITIAL_PASSWORD`）
- [ ] 加 npm script `"prisma-seed": "tsx prisma/seed.ts"`
- [ ] 首次跑 seed 后能用初始账号登录

## 不做

- 不实现 admin 后台具体业务页面（留各自 task）
- 不实现"忘记密码"流程（v1 不要）
- 不实现多 admin 管理界面（v1.5）

## 实施提示

JWT 签名：

```ts
import jwt from 'jsonwebtoken'

export function signAdminJwt(payload: { sub: string; role: string }) {
  return jwt.sign(payload, process.env.JWT_SECRET_ADMIN!, {
    expiresIn: '7d',
    issuer: 'tengyu-pod-admin',
  })
}

export function verifyAdminJwt(token: string) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET_ADMIN!) as { sub: string; role: string }
  } catch {
    return null
  }
}
```

bcrypt cost = 12（spec/08-server §11）。

中间件示例：

```ts
import { NextRequest, NextResponse } from 'next/server'

export function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname
  if (!pathname.startsWith('/admin') || pathname === '/admin/login' || pathname === '/admin/api/login') {
    return NextResponse.next()
  }
  const token = req.cookies.get('admin_token')?.value
  if (!token) return NextResponse.redirect(new URL('/admin/login', req.url))
  // verify 见 jwt.ts
}

export const config = { matcher: ['/admin/:path*'] }
```

## 完成后

```bash
git add -A
git commit -m "feat(task-07): admin login + JWT + middleware"
python3 .trellis/scripts/task.py archive 05-23-admin-auth-jwt
```
