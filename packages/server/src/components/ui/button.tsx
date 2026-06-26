import { cn } from '@/lib/utils'
import { Slot } from '@radix-ui/react-slot'
import type { ComponentProps, ReactNode } from 'react'

type ButtonVariant = 'default' | 'secondary' | 'outline' | 'ghost'

const variantClassName: Record<ButtonVariant, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  outline: 'border bg-card text-foreground hover:bg-accent',
  ghost: 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
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
  const Comp = asChild ? Slot : 'button'

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
