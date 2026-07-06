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
  Video,
  Workflow,
} from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'
import { NavLink } from 'react-router-dom'
import { type WorkbenchModule, tutorialModule, workbenchModules } from './navigation'

const moduleIcons: Record<WorkbenchModule, ComponentType<SVGProps<SVGSVGElement>>> = {
  collection: Download,
  pipeline: Workflow,
  title: Type,
  generation: Sparkles,
  detection: ShieldCheck,
  listing: Rocket,
  video: Video,
  ps: Layers,
  settings: Settings2,
  tutorial: HelpCircle,
}

interface SidebarProps {
  collapsed: boolean
  onToggleCollapsed: () => void
}

export function Sidebar({ collapsed, onToggleCollapsed }: SidebarProps) {
  return (
    <aside
      className={cn(
        'relative z-20 flex h-screen shrink-0 flex-col border-r border-white/70 bg-card/90 shadow-[10px_0_34px_rgba(30,64,175,0.08)] backdrop-blur-xl transition-[width] duration-150',
        collapsed ? 'w-[60px]' : 'w-[180px]',
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
            'shrink-0 rounded-md border border-white/70 bg-white/80 object-contain shadow-[0_12px_28px_rgba(37,99,235,0.14)]',
            collapsed ? 'h-10 w-10' : 'h-16 w-16',
          )}
          loading="lazy"
          src="brand/brand-logo.svg"
        />
        {collapsed ? null : (
          <p className="brand-wordmark mt-2 bg-clip-text text-center text-xl font-black leading-none tracking-normal">
            腾域Ai
          </p>
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
                    ? 'bg-[linear-gradient(135deg,_hsl(var(--primary)),_hsl(var(--brand-deep)))] text-primary-foreground shadow-[0_10px_24px_rgba(37,99,235,0.22)]'
                    : 'text-muted-foreground hover:bg-white/75 hover:text-foreground hover:shadow-xs',
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
                ? 'bg-[linear-gradient(135deg,_hsl(var(--primary)),_hsl(var(--brand-deep)))] text-primary-foreground shadow-[0_10px_24px_rgba(37,99,235,0.22)]'
                : 'text-muted-foreground hover:bg-white/75 hover:text-foreground hover:shadow-xs',
            )
          }
          title={collapsed ? '设置' : undefined}
          to="/settings"
        >
          <Settings2 className="h-4 w-4 shrink-0" />
          {collapsed ? null : <span>设置</span>}
        </NavLink>
        <NavLink
          className={({ isActive }) =>
            cn(
              'flex h-10 w-full items-center gap-3 rounded-sm px-3 text-sm font-medium transition-colors duration-100',
              collapsed ? 'justify-center px-0' : null,
              isActive
                ? 'bg-[linear-gradient(135deg,_hsl(var(--primary)),_hsl(var(--brand-deep)))] text-primary-foreground shadow-[0_10px_24px_rgba(37,99,235,0.22)]'
                : 'text-muted-foreground hover:bg-white/75 hover:text-foreground hover:shadow-xs',
            )
          }
          title={collapsed ? '教程' : undefined}
          to={tutorialModule.path}
        >
          <HelpCircle className="h-4 w-4 shrink-0" />
          {collapsed ? null : <span>教程</span>}
        </NavLink>
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
