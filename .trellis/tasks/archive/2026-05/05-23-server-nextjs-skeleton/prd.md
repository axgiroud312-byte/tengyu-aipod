# Task: Server Next.js Skeleton（切片 0 - 第 4 个）

## 目标

在 `packages/server` 下建 Next.js 15 + Prisma + Postgres 服务端骨架，本地 `pnpm dev` 能跑起来，访问 `/api/health` 返回 200。

## 输入

- 参考：`docs/spec/08-server.md §1-3, §9`（技术栈 + 部署）

## 验收标准

- [ ] `packages/server/package.json`，依赖：next 15+, react 18+, prisma, @prisma/client, zod, jsonwebtoken, bcrypt, tailwindcss
- [ ] `packages/server/tsconfig.json`
- [ ] `packages/server/next.config.js`
- [ ] `packages/server/prisma/schema.prisma`（**只放 datasource + generator + 1 个 dummy model**，正式 schema 留 task-prisma-schema）
- [ ] `packages/server/.env.example`（DATABASE_URL / JWT_SECRET_CLIENT / JWT_SECRET_ADMIN 等）
- [ ] `packages/server/src/app/layout.tsx`（最小 RootLayout，引入 globals.css）
- [ ] `packages/server/src/app/page.tsx`（首页显示"腾域 aipod 服务端"）
- [ ] `packages/server/src/app/api/health/route.ts`（返回 `{ ok: true, uptime, db_ok }`）
- [ ] `packages/server/src/lib/db.ts`（Prisma 单例）
- [ ] Tailwind 配好
- [ ] shadcn 初始化 + 装 button + card 备用
- [ ] `pnpm -F @tengyu-aipod/server dev` 起服务
- [ ] `curl http://localhost:3000/api/health` 返回 200 JSON
- [ ] 本地 Postgres（或 Neon dev DB）连接通过

## 不做

- 不实现激活码 / Skill / Provider 等业务逻辑（留各自 task）
- 不实现 admin 后台页面
- 不实现 JWT 签发

## 实施提示

Prisma 占位 schema（**重要**：不写完整 schema，只写 datasource + generator 让 prisma generate 能跑）：

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

// 占位模型，task-prisma-schema 会扩展
model _Placeholder {
  id String @id @default(cuid())
}
```

`/api/health` 实现：

```ts
import { db } from '@/lib/db'

export async function GET() {
  let db_ok = false
  try {
    await db.$queryRaw`SELECT 1`
    db_ok = true
  } catch {}
  return Response.json({
    ok: true,
    uptime: process.uptime(),
    db_ok,
    version: process.env.npm_package_version,
  })
}
```

本地开发数据库建议：
- 用 Neon 免费档（推荐，无需本地 Postgres）
- 或 Docker Postgres：`docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=dev postgres:16`

## 完成后

```bash
git add -A
git commit -m "feat(task-04): server nextjs skeleton with /api/health"
python3 .trellis/scripts/task.py archive 05-23-server-nextjs-skeleton
```
