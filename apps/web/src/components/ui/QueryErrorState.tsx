import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

import { Button } from './Button'

interface QueryErrorStateProps {
  className?: string
  compact?: boolean
  isRetrying?: boolean
  message?: string
  onRetry?: () => void | Promise<unknown>
}

export default function QueryErrorState({ className, compact = false, isRetrying = false, message, onRetry }: QueryErrorStateProps) {
  const _ = useTranslation()

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-2 py-4' : 'gap-3 py-8 sm:py-10',
        className,
      )}
      role="alert"
    >
      <div
        className={cn(
          'flex items-center justify-center rounded-xl bg-stone-100 text-stone-400 dark:bg-stone-800/80 dark:text-stone-500',
          compact ? 'h-8 w-8' : 'h-10 w-10',
        )}
        aria-hidden="true"
      >
        <svg
          width={compact ? 16 : 18}
          height={compact ? 16 : 18}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <p className="max-w-xs text-xs leading-relaxed text-stone-600 dark:text-stone-400">
        {message ?? _('errors.loadFailed')}
      </p>
      {onRetry && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={isRetrying}
          onClick={() => void onRetry()}
          className="mt-0.5"
        >
          {isRetrying && (
            <svg
              className="-ml-0.5 mr-1.5 h-3.5 w-3.5 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          )}
          {isRetrying ? _('errors.retrying') : _('errors.retry')}
        </Button>
      )}
    </div>
  )
}

