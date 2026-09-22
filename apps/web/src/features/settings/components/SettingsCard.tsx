import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface SettingsCardProps {
  id?: string
  icon: ReactNode
  iconBgClass?: string
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  children?: ReactNode
  className?: string
  bodyClassName?: string
}

export default function SettingsCard({
  id,
  icon,
  iconBgClass = 'bg-stone-500/10 text-stone-600 dark:bg-stone-500/20 dark:text-stone-400',
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
}: SettingsCardProps) {
  const hasChildren = children !== null && children !== undefined && children !== false

  return (
    <section
      id={id}
      className={cn(
        'rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6 dark:border-stone-800 dark:bg-stone-900',
        className,
      )}
    >
      <div className={cn('flex justify-between gap-4', description ? 'items-start' : 'items-center')}>
        <div className={cn('flex gap-3 min-w-0', description ? 'items-start' : 'items-center')}>
          <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', iconBgClass)}>
            {icon}
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">{title}</h2>
            {description && (
              <p className="mt-1 text-xs leading-relaxed text-stone-500 text-pretty dark:text-stone-400">
                {description}
              </p>
            )}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>

      {hasChildren && (
        <div className={cn('mt-3.5 border-t border-stone-100 dark:border-stone-800', bodyClassName)}>
          {children}
        </div>
      )}
    </section>
  )
}
