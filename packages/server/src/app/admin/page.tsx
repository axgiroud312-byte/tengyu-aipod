import { AdminShell } from '@/components/admin/admin-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

type CountPair = {
  active: number | null
  total: number | null
}

type DashboardStats = {
  activationCodes: CountPair
  customers: CountPair
  dbOk: boolean
  skills: CountPair
}

const emptyStats: DashboardStats = {
  activationCodes: { active: null, total: null },
  customers: { active: null, total: null },
  dbOk: false,
  skills: { active: null, total: null },
}

async function getDashboardStats(): Promise<DashboardStats> {
  try {
    const [
      totalSkills,
      enabledSkills,
      totalCustomers,
      activeCustomers,
      totalCodes,
      activatedCodes,
    ] = await Promise.all([
      db.skill.count(),
      db.skill.count({ where: { enabled: true } }),
      db.customer.count(),
      db.customer.count({ where: { is_active: true } }),
      db.activationCode.count(),
      db.activationCode.count({ where: { activated_at: { not: null } } }),
    ])

    return {
      activationCodes: { active: activatedCodes, total: totalCodes },
      customers: { active: activeCustomers, total: totalCustomers },
      dbOk: true,
      skills: { active: enabledSkills, total: totalSkills },
    }
  } catch {
    return emptyStats
  }
}

function formatCount(value: number | null) {
  return value === null ? '-' : new Intl.NumberFormat('zh-CN').format(value)
}

function formatPair(pair: CountPair, activeLabel: string) {
  return `${formatCount(pair.active)} ${activeLabel} / ${formatCount(pair.total)} 总数`
}

const moduleLinks = [
  {
    description: '维护生图、提取、侵权检测等固定业务 Skill 槽位，每个槽位只保存系统提示词。',
    href: '/admin/skills',
    label: '系统提示词',
    statKey: 'skills',
    statLabel: '启用',
    title: 'Skill 管理',
  },
  {
    description: '查看客户、设备使用、封号状态和客户名下激活码情况。',
    href: '/admin/customers',
    label: '客户账号',
    statKey: 'customers',
    statLabel: '活跃',
    title: '客户管理',
  },
  {
    description: '生成激活码、批量预绑客户、查看激活与设备占用。',
    href: '/admin/codes',
    label: '授权入口',
    statKey: 'activationCodes',
    statLabel: '已激活',
    title: '激活码管理',
  },
] as const

export default async function AdminHomePage() {
  const stats = await getDashboardStats()

  return (
    <AdminShell
      description="云端后台只保留账号授权和 Skill 系统提示词；模型、密钥和 Workflow 都由客户端本地管理。"
      title="后台管理"
    >
      <section className="flex flex-wrap items-start justify-between gap-4 rounded-md border bg-card p-5 shadow-[0_10px_28px_rgba(37,99,235,0.06)]">
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">云端轻配置中心</p>
          <h2 className="text-xl font-semibold">只管理账号体系和业务系统提示词</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Grsai、百炼、晨羽 API Key、模型清单和本地 Workflow 都留在客户端，服务器不保存用户密钥。
          </p>
        </div>
        <Button asChild>
          <a href="/admin/skills">配置 Skill</a>
        </Button>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>数据库</CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={
                stats.dbOk
                  ? 'text-sm font-medium text-green-700'
                  : 'text-sm font-medium text-red-700'
              }
            >
              {stats.dbOk ? '连接正常' : '连接异常'}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {stats.dbOk ? '统计数据来自当前数据库。' : '页面可访问，统计数据暂不可用。'}
            </p>
          </CardContent>
        </Card>

        {[
          { label: '启用', pair: stats.skills, title: 'Skill' },
          { label: '活跃', pair: stats.customers, title: '客户' },
          { label: '已激活', pair: stats.activationCodes, title: '激活码' },
        ].map((item) => (
          <Card key={item.title}>
            <CardHeader className="pb-3">
              <CardTitle>{item.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="tabular-nums text-2xl font-semibold">{formatCount(item.pair.active)}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {formatPair(item.pair, item.label)}
              </p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {moduleLinks.map((item) => (
          <Card key={item.href} className="flex flex-col">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>{item.title}</CardTitle>
                <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                  {item.label}
                </span>
              </div>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-4">
              <p className="min-h-12 text-sm text-muted-foreground">{item.description}</p>
              <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <span className="tabular-nums text-sm text-muted-foreground">
                  {formatPair(stats[item.statKey], item.statLabel)}
                </span>
                <Button asChild variant="secondary">
                  <a href={item.href}>进入</a>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>
    </AdminShell>
  )
}
