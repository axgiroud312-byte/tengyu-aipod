import type { ReactNode } from 'react'
import type { WorkbenchModuleMeta } from './navigation'

interface HeaderProps {
  module: WorkbenchModuleMeta
  rightSlot?: ReactNode
}

export function Header({ module, rightSlot }: HeaderProps) {
  return (
    <header className="shrink-0 border-b bg-background px-5 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold tracking-normal">{module.title}</h1>
          <p className="truncate text-sm text-muted-foreground">{module.description}</p>
        </div>

        <div className="flex items-center gap-3">{rightSlot}</div>
      </div>
    </header>
  )
}
