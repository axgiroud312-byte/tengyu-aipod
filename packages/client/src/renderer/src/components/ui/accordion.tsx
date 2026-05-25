import { cn } from '@/lib/utils'
import { ChevronDown } from 'lucide-react'
import { Accordion as AccordionPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'

export const Accordion = AccordionPrimitive.Root

export function AccordionItem({
  className,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Item>) {
  return <AccordionPrimitive.Item className={cn('border-b', className)} {...props} />
}

export function AccordionTrigger({
  children,
  className,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        className={cn(
          'flex flex-1 items-center justify-between py-4 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDown className="ml-3 size-4 shrink-0 text-muted-foreground" />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
}

export function AccordionContent({
  className,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Content>) {
  return <AccordionPrimitive.Content className={cn('pb-4', className)} {...props} />
}
