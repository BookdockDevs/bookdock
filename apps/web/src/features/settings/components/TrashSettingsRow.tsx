import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { SettingsRes, TrashSettings } from '@bookdock/shared'

import { apiGet, apiPut } from '@/api/client'
import QueryErrorState from '@/components/ui/QueryErrorState'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import { notify } from '@/lib/notifications'

const AUTO_CLEAN_DAYS = [0, 7, 30] as const

const LABEL_KEYS: Record<TrashSettings['autoCleanDays'], string> = {
  0: 'settings.trashCleanNever',
  7: 'settings.trashClean7Days',
  30: 'settings.trashClean30Days',
}

export default function TrashSettingsRow() {
  const _ = useTranslation()
  const queryClient = useQueryClient()
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiGet<{ data: SettingsRes }>('/settings'),
  })
  const mutation = useMutation({
    mutationFn: (trash: TrashSettings) => apiPut('/settings', { trash }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
    onError: (error) => notify.error(getUserErrorNotification(error, 'errors.updateFailed')),
  })
  if (settingsQuery.isError) {
    return <QueryErrorState className="py-4" isRetrying={settingsQuery.isFetching} onRetry={settingsQuery.refetch} />
  }
  if (settingsQuery.isLoading) {
    return <div className="py-2 text-sm text-stone-500">{_('reader.loading')}</div>
  }

  const current = settingsQuery.data?.data.trash?.autoCleanDays ?? 30

  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="text-sm text-stone-700 dark:text-stone-200">{_('settings.trashAutoClean')}</p>
      </div>
      <div className="inline-flex items-center gap-0.5 rounded-lg bg-stone-100 p-0.5 dark:bg-stone-800" role="group" aria-label={_('settings.trashAutoClean')}>
        {AUTO_CLEAN_DAYS.map((days) => (
          <button
            key={days}
            type="button"
            aria-pressed={current === days}
            disabled={mutation.isPending}
            onClick={() => mutation.mutate({ autoCleanDays: days })}
            className={cn(
              'flex h-7 items-center justify-center rounded-md px-3 text-xs font-medium transition-all disabled:opacity-60',
              current === days
                ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-stone-100'
                : 'text-stone-500 hover:text-stone-800 dark:hover:text-stone-200',
            )}
          >
            {_(LABEL_KEYS[days])}
          </button>
        ))}
      </div>
    </div>
  )
}
