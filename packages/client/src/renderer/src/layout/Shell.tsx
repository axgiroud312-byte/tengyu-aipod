import { type ReactNode, useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import {
  LAST_ROUTE_STORAGE_KEY,
  SIDEBAR_COLLAPSED_STORAGE_KEY,
  isWorkbenchRoute,
  moduleMetaFromPath,
} from './navigation'

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

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed))
  }, [collapsed])

  useEffect(() => {
    if (isWorkbenchRoute(location.pathname)) {
      window.localStorage.setItem(LAST_ROUTE_STORAGE_KEY, location.pathname)
    }
  }, [location.pathname])

  return (
    <div className="workbench-shell flex h-screen overflow-hidden text-foreground">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((current) => !current)}
      />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <Header module={module} rightSlot={rightSlot} />
        <main className="min-h-0 flex-1 overflow-auto">
          <section className="mx-auto w-full max-w-[1440px] px-6 py-6">
            {children ?? <Outlet />}
          </section>
        </main>
      </div>
    </div>
  )
}
