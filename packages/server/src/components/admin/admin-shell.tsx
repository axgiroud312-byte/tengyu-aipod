'use client'

import { cn } from '@/lib/utils'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

type AdminNavItem = {
  description: string
  href: string
  label: string
  marker: string
}

const adminNavItems: AdminNavItem[] = [
  { href: '/admin', label: '首页', description: '运营概览', marker: 'A' },
  { href: '/admin/skills', label: 'Skill', description: '系统提示词', marker: 'S' },
  { href: '/admin/customers', label: '客户', description: '账号和设备', marker: 'C' },
  { href: '/admin/codes', label: '激活码', description: '授权管理', marker: 'K' },
]

function isActivePath(pathname: string, href: string) {
  if (href === '/admin') {
    return pathname === href
  }
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function AdminShell({
  children,
  description,
  eyebrow = '腾域 aipod Server',
  title,
}: {
  children: ReactNode
  description: string
  eyebrow?: string
  title: string
}) {
  const pathname = usePathname()

  return (
    <div className="flex min-h-screen bg-muted/40 text-foreground">
      <aside className="sticky top-0 flex h-screen w-[196px] shrink-0 flex-col border-r bg-card">
        <div className="flex h-16 items-center gap-3 border-b px-4">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary text-sm font-semibold text-primary-foreground shadow-sm">
            TY
          </div>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">腾域 aipod</p>
            <p className="truncate text-xs text-muted-foreground">后台工作台</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-2 py-3">
          {adminNavItems.map((item) => {
            const active = isActivePath(pathname, item.href)
            return (
              <a
                className={cn(
                  'flex min-h-11 items-center gap-3 rounded-sm px-3 text-sm transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
                href={item.href}
                key={item.href}
              >
                <span
                  className={cn(
                    'grid h-6 w-6 shrink-0 place-items-center rounded-sm text-[11px] font-semibold',
                    active ? 'bg-primary-foreground/18' : 'bg-muted text-foreground',
                  )}
                >
                  {item.marker}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{item.label}</span>
                  <span
                    className={cn(
                      'block truncate text-xs',
                      active ? 'text-primary-foreground/80' : 'text-muted-foreground',
                    )}
                  >
                    {item.description}
                  </span>
                </span>
              </a>
            )
          })}
        </nav>

        <div className="border-t px-4 py-3 text-xs leading-5 text-muted-foreground">
          <p>云端只管理账号和 Skill。</p>
          <p>模型、Key、Workflow 均在本地客户端。</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b bg-background/95 px-6">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              {eyebrow}
            </p>
            <h1 className="truncate text-xl font-semibold">{title}</h1>
          </div>
          <button
            className="inline-flex h-9 items-center justify-center rounded-md border bg-card px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={async () => {
              await fetch('/admin/api/logout', { method: 'POST' })
              window.location.href = '/admin/login'
            }}
            type="button"
          >
            退出登录
          </button>
        </header>

        <main className="min-w-0 flex-1 overflow-auto">
          <section className="mx-auto w-full max-w-7xl space-y-6 px-6 py-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">{description}</p>
              </div>
            </div>
            {children}
          </section>
        </main>
      </div>
    </div>
  )
}
