import { type VirtualItem, useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useRef, useState } from 'react'

export type VirtualGridBreakpoint = {
  query: string
  columns: number
}

export type VirtualGridOptions = {
  count: number
  defaultColumns: number
  breakpoints: VirtualGridBreakpoint[]
  estimateRowHeight: number
  gap: number
  overscan?: number
}

export type VirtualGridResult = {
  parentRef: React.RefObject<HTMLDivElement | null>
  columns: number
  virtualRows: VirtualItem[]
  totalSize: number
  measureElement: (node: HTMLDivElement | null) => void
}

export function useVirtualGrid({
  count,
  defaultColumns,
  breakpoints,
  estimateRowHeight,
  gap,
  overscan = 4,
}: VirtualGridOptions): VirtualGridResult {
  const parentRef = useRef<HTMLDivElement | null>(null)
  const [columns, setColumns] = useState(() =>
    resolveVirtualGridColumns(defaultColumns, breakpoints),
  )
  const rowCount = Math.ceil(count / columns)
  const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rowCount,
    estimateSize: () => estimateRowHeight,
    gap,
    getScrollElement: () => parentRef.current,
    overscan,
  })

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return
    }
    const queries = breakpoints.map((breakpoint) => window.matchMedia(breakpoint.query))
    const updateColumns = () => {
      setColumns(resolveVirtualGridColumns(defaultColumns, breakpoints))
    }

    updateColumns()
    for (const query of queries) {
      query.addEventListener('change', updateColumns)
    }
    return () => {
      for (const query of queries) {
        query.removeEventListener('change', updateColumns)
      }
    }
  }, [breakpoints, defaultColumns])

  return {
    parentRef,
    columns,
    virtualRows: rowVirtualizer.getVirtualItems(),
    totalSize: rowVirtualizer.getTotalSize(),
    measureElement: rowVirtualizer.measureElement,
  }
}

function resolveVirtualGridColumns(defaultColumns: number, breakpoints: VirtualGridBreakpoint[]) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return defaultColumns
  }
  return (
    breakpoints.find((breakpoint) => window.matchMedia(breakpoint.query).matches)?.columns ??
    defaultColumns
  )
}
