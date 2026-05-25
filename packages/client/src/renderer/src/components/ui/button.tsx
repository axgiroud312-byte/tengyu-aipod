import { cn } from '@/lib/utils'
import { type VariantProps, cva } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import type { ComponentProps, ReactNode } from 'react'

const buttonVariants = cva(
  'inline-flex h-10 items-center justify-center rounded-sm px-4 py-2 text-sm font-medium transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        outline:
          'border border-input bg-background shadow-xs hover:bg-accent hover:text-accent-foreground',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        destructive: 'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
  children: ReactNode
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
    <Comp className={cn(buttonVariants({ variant }), className)} type={type} {...props}>
      {children}
    </Comp>
  )
}

export { buttonVariants }
