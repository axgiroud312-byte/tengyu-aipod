'use client'

import { cn } from '@/lib/utils'
import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react'

type TabsContextValue = {
  value: string
  setValue: (value: string) => void
}

const TabsContext = createContext<TabsContextValue | null>(null)

function useTabsContext() {
  const context = useContext(TabsContext)
  if (!context) {
    throw new Error('Tabs components must be used inside <Tabs>.')
  }
  return context
}

export function Tabs({
  children,
  className,
  defaultValue,
}: {
  children: ReactNode
  className?: string
  defaultValue: string
}) {
  const [value, setValue] = useState(defaultValue)
  const context = useMemo(() => ({ value, setValue }), [value])

  return (
    <TabsContext.Provider value={context}>
      <div className={cn('space-y-4', className)}>{children}</div>
    </TabsContext.Provider>
  )
}

export function TabsList({ children, className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex w-full flex-wrap gap-1 rounded-md border bg-muted/70 p-1',
        className,
      )}
      role="tablist"
      {...props}
    >
      {children}
    </div>
  )
}

export function TabsTrigger({
  children,
  className,
  value,
  ...props
}: ComponentProps<'button'> & { value: string }) {
  const context = useTabsContext()
  const active = context.value === value

  return (
    <button
      aria-selected={active}
      className={cn(
        'inline-flex h-9 items-center justify-center rounded-sm px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        active ? 'bg-card text-foreground shadow-sm' : null,
        className,
      )}
      onClick={() => context.setValue(value)}
      role="tab"
      type="button"
      {...props}
    >
      {children}
    </button>
  )
}

export function TabsContent({
  children,
  className,
  value,
  ...props
}: ComponentProps<'div'> & { value: string }) {
  const context = useTabsContext()
  const active = context.value === value

  return (
    <div
      className={cn(active ? 'block' : 'hidden', className)}
      hidden={!active}
      role="tabpanel"
      {...props}
    >
      {Children.map(children, (child) => (isValidElement(child) ? child : child))}
    </div>
  )
}
