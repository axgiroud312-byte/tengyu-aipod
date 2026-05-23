import { cn } from '@/lib/utils'
import { Slot } from 'radix-ui'
import type { ComponentProps, ReactNode } from 'react'

type ButtonVariant = 'default' | 'secondary'

const variantClassName: Record<ButtonVariant, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-muted text-foreground hover:bg-muted/80',
}

export interface ButtonProps extends ComponentProps<'button'> {
  asChild?: boolean
  children: ReactNode
  variant?: ButtonVariant
}

export function Button({
  asChild = false,
  children,
  className,
  type = 'button',
  variant = 'default',
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button'

  return (
    <Comp
      className={cn(
        'inline-flex h-10 items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50',
        variantClassName[variant],
        className,
      )}
      type={type}
      {...props}
    >
      {children}
    </Comp>
  )
}
