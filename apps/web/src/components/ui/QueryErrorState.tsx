import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

import { Button } from './Button'

interface QueryErrorStateProps {
  className?: string
  isRetrying?: boolean
  message?: string
  onRetry?: () => void | Promise<unknown>
}

export default function QueryErrorState({ className, isRetrying = false, message, onRetry }: QueryErrorStateProps) {
  const _ = useTranslation()

  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 py-10 text-center', className)} role="alert">
      <p className="text-sm text-red-600 dark:text-red-400">{message ?? _('errors.loadFailed')}</p>
      {onRetry && (
        <Button type="button" variant="secondary" size="sm" disabled={isRetrying} onClick={() => void onRetry()}>
          {isRetrying ? _('errors.retrying') : _('errors.retry')}
        </Button>
      )}
    </div>
  )
}
