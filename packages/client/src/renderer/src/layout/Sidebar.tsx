import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
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
        'relative z-20 flex h-screen shrink-0 flex-col border-r bg-card transition-[width] duration-150',
        collapsed ? 'w-14' : 'w-[188px]',
      )}
    >
      <div
        className={cn(
          'flex shrink-0',
          collapsed
            ? 'h-16 items-center justify-center px-0'
            : 'h-[116px] flex-col items-center justify-center px-5 py-4',
        )}
      >
        <img
          alt=""
          aria-hidden="true"
          className={cn(
            'shrink-0 rounded-md border bg-background object-contain shadow-sm',
            collapsed ? 'h-10 w-10' : 'h-16 w-16',
          )}
          loading="lazy"
          src="brand/brand-logo.svg"
        />
        {collapsed ? null : (
          <p className="brand-wordmark mt-2 text-center text-xl font-semibold leading-none tracking-normal">
            腾域Ai
          </p>
        )}
      </div>

      <nav aria-label="Workbench 主导航" className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {navigationGroups.map((group) => (
          <div className="mb-4 space-y-1 last:mb-0" key={group.label}>
            {collapsed ? null : (
              <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">{group.label}</p>
            )}
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
