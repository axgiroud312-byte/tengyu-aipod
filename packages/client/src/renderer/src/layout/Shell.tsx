import { cn } from '@/lib/utils'
import { type ReactNode, useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { SIDEBAR_COLLAPSED_STORAGE_KEY, moduleMetaFromPath } from './navigation'

interface ShellProps {
  children?: ReactNode
  rightSlot?: ReactNode
}

function readInitialCollapsedState() {
  return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true'
}

export function Shell({ children, rightSlot }: ShellProps) {
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(readInitialCollapsedState)
  const module = moduleMetaFromPath(location.pathname)
  const usesWideContent = module.key === 'pipeline' || module.key === 'listing'

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed))
  }, [collapsed])

  return (
    <div className="workbench-shell flex h-screen overflow-hidden text-foreground">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((current) => !current)}
      />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col" data-workbench-region="central">
        <Header module={module} rightSlot={rightSlot} />
        <main className="min-h-0 flex-1 overflow-auto">
          <section
            className={cn(
              'mx-auto w-full px-6 py-6',
              usesWideContent ? 'max-w-[1720px]' : 'max-w-[1200px]',
            )}
            data-content-width={usesWideContent ? 'wide' : 'constrained'}
          >
            {children ?? <Outlet />}
          </section>
        </main>
      </div>
      <div
        aria-label="任务坞预留区域"
        className="w-0 shrink-0 overflow-hidden"
        data-workbench-region="task-dock"
        role="region"
      />
    </div>
  )
}
