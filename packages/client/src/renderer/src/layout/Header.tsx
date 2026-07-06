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
    <header className="shrink-0 border-b bg-background px-6 py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-normal">{module.title}</h1>
          <p className="mt-1 truncate text-sm text-muted-foreground">{module.description}</p>
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
