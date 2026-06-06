import { Button } from '@/components/ui/button'
import { Settings2 } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { moduleVisual } from './module-visuals'
import type { WorkbenchModuleMeta } from './navigation'

interface HeaderProps {
  module: WorkbenchModuleMeta
  rightSlot?: ReactNode
}

export function Header({ module, rightSlot }: HeaderProps) {
  const visual = moduleVisual(module.key)
  const visualStyle: CSSProperties = {
    backgroundImage: `linear-gradient(90deg, rgba(255,255,255,0.96) 0%, rgba(255,255,255,0.88) 42%, rgba(255,255,255,0.36) 100%), url("${visual.image}")`,
    backgroundPosition: 'center',
    backgroundSize: 'cover',
    boxShadow: `inset 0 -1px 0 rgba(255,255,255,0.72), 0 16px 46px ${visual.glow}`,
  }

  return (
    <header className="relative h-[92px] shrink-0 overflow-hidden border-b border-white/70 bg-card/80 px-6 backdrop-blur-xl">
      <div aria-hidden="true" className="absolute inset-0" style={visualStyle} />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-blue-400/40 to-transparent"
      />
      <div className="relative flex h-full items-center justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-2 w-8 rounded-full shadow-[0_0_22px_currentColor]"
              style={{ backgroundColor: visual.accent, color: visual.accent }}
            />
            <span className="text-xs font-semibold uppercase tracking-normal text-primary/70">
              Workbench
            </span>
          </div>
          <h1 className="truncate text-2xl font-semibold leading-8 tracking-normal text-foreground">
            {module.title}
          </h1>
          <p className="truncate text-sm text-muted-foreground">{module.description}</p>
        </div>

        <div className="flex items-center gap-3">
          {rightSlot}
          <Button asChild className="h-10 w-10 px-0" title="设置" type="button" variant="outline">
            <NavLink to="/settings">
              <Settings2 className="h-4 w-4" />
            </NavLink>
          </Button>
        </div>
      </div>
    </header>
  )
}
