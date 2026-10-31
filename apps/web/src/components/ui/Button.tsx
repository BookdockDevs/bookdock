import { cn } from '@/lib/utils'
import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  ref?: React.Ref<HTMLButtonElement>
}

const variants: Record<Variant, string> = {
  primary:
    'bg-stone-900 text-white border border-stone-900/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_1px_2px_rgba(0,0,0,0.12)] hover:bg-stone-800 hover:border-stone-800 active:bg-stone-950 dark:bg-stone-100 dark:text-stone-900 dark:border-white/90 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_1px_2px_rgba(0,0,0,0.25)] dark:hover:bg-white dark:active:bg-stone-200',
  secondary:
    'bg-white text-stone-700 border border-stone-200/90 shadow-2xs hover:bg-stone-50 hover:text-stone-900 hover:border-stone-300 active:bg-stone-100 dark:bg-stone-800 dark:text-stone-200 dark:border-stone-700/80 dark:hover:bg-stone-750 dark:hover:text-stone-100 dark:hover:border-stone-600 dark:active:bg-stone-700',
  ghost:
    'text-stone-600 border border-transparent hover:bg-stone-100 hover:text-stone-900 active:bg-stone-200/60 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100 dark:active:bg-stone-800/80',
  danger:
    'bg-red-600 text-white border border-red-700/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_2px_rgba(153,27,27,0.25)] hover:bg-red-500 hover:border-red-600 active:bg-red-700 dark:bg-red-600 dark:border-red-500/50 dark:hover:bg-red-500 dark:active:bg-red-700',
}

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
  md: 'h-9 px-3.5 text-xs sm:text-sm gap-2 rounded-lg',
  lg: 'h-10 px-4 text-sm gap-2 rounded-xl',
}

export function Button({ variant = 'primary', size = 'md', className, children, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center font-medium tracking-tight transition-all duration-150 ease-out select-none outline-none focus-visible:ring-2 focus-visible:ring-stone-400/50 focus-visible:ring-offset-1 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none disabled:transform-none',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
