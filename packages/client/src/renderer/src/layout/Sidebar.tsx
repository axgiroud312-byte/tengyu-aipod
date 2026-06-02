import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  Download,
  HelpCircle,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  Rocket,
  Settings2,
  ShieldCheck,
  Sparkles,
  Type,
} from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'
import { NavLink } from 'react-router-dom'
import { type WorkbenchModule, workbenchModules } from './navigation'

const moduleIcons: Record<WorkbenchModule, ComponentType<SVGProps<SVGSVGElement>>> = {
  collection: Download,
  title: Type,
  generation: Sparkles,
  detection: ShieldCheck,
  listing: Rocket,
  ps: Layers,
  settings: Settings2,
}

interface SidebarProps {
  collapsed: boolean
  onToggleCollapsed: () => void
}

export function Sidebar({ collapsed, onToggleCollapsed }: SidebarProps) {
  return (
    <aside
      className={cn(
        'flex h-screen shrink-0 flex-col border-r bg-card transition-[width] duration-150',
        collapsed ? 'w-[60px]' : 'w-[180px]',
      )}
    >
      <div className="flex h-16 items-center gap-3 px-4">
        <img
          alt=""
          aria-hidden="true"
          className="h-8 w-8 shrink-0 rounded-md object-cover shadow-xs"
          src="/brand/tengyu-ai-icon-256.png"
        />
        {collapsed ? null : (
          <div className="min-w-0">
            <p className="truncate text-base font-semibold tracking-normal text-foreground">
              腾域 aipod
            </p>
            <p className="text-xs text-muted-foreground">运营工作台</p>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-1 px-2 py-3">
        {workbenchModules.map((module) => {
          const Icon = moduleIcons[module.key]
          return (
            <NavLink
              className={({ isActive }) =>
                cn(
                  'flex h-10 items-center gap-3 rounded-sm px-3 text-sm font-medium transition-colors duration-100',
                  collapsed ? 'justify-center px-0' : null,
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-xs'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )
              }
              key={module.key}
              title={collapsed ? module.label : undefined}
              to={module.path}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {collapsed ? null : <span className="truncate">{module.label}</span>}
            </NavLink>
          )
        })}
      </nav>

      <div className="space-y-1 border-t px-2 py-3">
        <NavLink
          className={({ isActive }) =>
            cn(
              'flex h-10 w-full items-center gap-3 rounded-sm px-3 text-sm font-medium transition-colors duration-100',
              collapsed ? 'justify-center px-0' : null,
              isActive
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )
          }
          title={collapsed ? '设置' : undefined}
          to="/settings"
        >
          <Settings2 className="h-4 w-4 shrink-0" />
          {collapsed ? null : <span>设置</span>}
        </NavLink>
        <button
          className={cn(
            'flex h-10 w-full items-center gap-3 rounded-sm px-3 text-sm font-medium text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground',
            collapsed ? 'justify-center px-0' : null,
          )}
          title={collapsed ? '教程' : undefined}
          type="button"
        >
          <HelpCircle className="h-4 w-4 shrink-0" />
          {collapsed ? null : <span>教程</span>}
        </button>
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
