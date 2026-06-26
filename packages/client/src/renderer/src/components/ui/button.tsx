import { cn } from '@/lib/utils'
import { Slot } from '@radix-ui/react-slot'
import { type VariantProps, cva } from 'class-variance-authority'
import type { ComponentProps, ReactNode } from 'react'

const buttonVariants = cva(
  'inline-flex h-10 items-center justify-center rounded-sm px-4 py-2 text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-[linear-gradient(135deg,_hsl(var(--primary))_0%,_hsl(var(--brand-deep))_100%)] text-primary-foreground shadow-[0_10px_24px_rgba(37,99,235,0.22)] hover:-translate-y-px hover:shadow-[0_14px_30px_rgba(37,99,235,0.28)]',
        secondary:
          'border border-white/70 bg-secondary/80 text-secondary-foreground shadow-xs hover:bg-white/90 hover:text-foreground',
        outline:
          'border border-input bg-white/80 shadow-xs backdrop-blur hover:border-primary/30 hover:bg-white hover:text-foreground',
        ghost: 'hover:bg-white/75 hover:text-foreground',
        destructive:
          'bg-destructive text-destructive-foreground shadow-xs hover:-translate-y-px hover:bg-destructive/90',
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
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp className={cn(buttonVariants({ variant }), className)} type={type} {...props}>
      {children}
    </Comp>
  )
}

export { buttonVariants }
