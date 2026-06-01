import { Button } from '@/components/ui/button'
import { Settings2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import type { WorkbenchModuleMeta } from './navigation'

interface HeaderProps {
  module: WorkbenchModuleMeta
  rightSlot?: ReactNode
}

export function Header({ module, rightSlot }: HeaderProps) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b bg-background/95 px-6">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold tracking-normal text-foreground">
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
    </header>
  )
}
