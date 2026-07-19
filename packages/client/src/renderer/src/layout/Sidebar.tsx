import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { t } from '@/locale/t'
import {
  Download,
  HelpCircle,
  History,
  ImagePlus,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  Rocket,
  Settings2,
  ShieldCheck,
  Type,
  Video,
  Workflow,
} from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'
import { NavLink } from 'react-router-dom'
import { type WorkbenchModule, navigationGroups } from './navigation'

const moduleIcons: Record<WorkbenchModule, ComponentType<SVGProps<SVGSVGElement>>> = {
  collection: Download,
  pipeline: Workflow,
  title: Type,
  generation: ImagePlus,
  detection: ShieldCheck,
  listing: Rocket,
  video: Video,
  ps: Layers,
  settings: Settings2,
  tutorial: HelpCircle,
}

const activeClassName = 'border border-primary/20 bg-primary/10 text-primary'
const inactiveClassName = 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'

interface SidebarProps {
  collapsed: boolean
  onToggleCollapsed: () => void
}

export function Sidebar({ collapsed, onToggleCollapsed }: SidebarProps) {
  return (
    <aside
      className={cn(
        'relative z-50 flex h-screen shrink-0 flex-col border-r bg-card transition-[width] duration-150',
        collapsed ? 'w-14' : 'w-[188px]',
      )}
    >
      <div
        className={cn(
          'flex h-16 shrink-0 items-center',
          collapsed ? 'justify-center px-0' : 'gap-3 px-3',
        )}
      >
        <img
          alt=""
          aria-hidden="true"
          className={cn('size-9 shrink-0 rounded-sm border bg-background object-contain shadow-sm')}
          loading="lazy"
          src="brand/brand-logo.svg"
        />
        {collapsed ? null : (
          <div className="min-w-0">
            <p className="brand-wordmark truncate text-base font-semibold leading-5 tracking-normal">
              腾域Ai
            </p>
            <p className="truncate text-[11px] leading-4 text-muted-foreground">
              {t('运营工作台')}
            </p>
          </div>
        )}
      </div>

      <nav
        aria-label="Workbench 主导航"
        className={cn(
          'min-h-0 flex-1 overflow-y-auto px-2 py-3',
          collapsed ? '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden' : null,
        )}
      >
        {navigationGroups.map((group) => (
          <div className="mb-4 space-y-1 last:mb-0" key={group.label}>
            <p
              aria-hidden={collapsed}
              className={cn(
                'h-5 px-3 pb-1 text-xs font-medium text-muted-foreground',
                collapsed ? 'text-transparent' : null,
              )}
            >
              {group.label}
            </p>
            {group.modules.map((module) => {
              const Icon = module.path === '/pipeline/runs' ? History : moduleIcons[module.key]
              return (
                <NavLink
                  className={({ isActive }) =>
                    cn(
                      'flex h-10 items-center gap-3 rounded-sm px-3 text-sm font-medium transition-colors duration-100',
                      collapsed ? 'justify-center px-0' : null,
                      isActive ? activeClassName : inactiveClassName,
                    )
                  }
                  end
                  key={module.path}
                  title={collapsed ? module.label : undefined}
                  to={module.path}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {collapsed ? null : <span className="truncate">{module.label}</span>}
                </NavLink>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="space-y-1 border-t px-2 py-3">
        <Button
          className={cn(
            'h-10 w-full justify-start gap-3 px-3',
            collapsed ? 'justify-center px-0' : null,
          )}
          onClick={onToggleCollapsed}
          title={collapsed ? '展开侧边栏' : '折叠侧边栏'}
          type="button"
          variant="ghost"
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
          {collapsed ? null : <span>折叠</span>}
        </Button>
      </div>
    </aside>
  )
}
