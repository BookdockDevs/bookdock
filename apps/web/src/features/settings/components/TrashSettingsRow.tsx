import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { SettingsRes, TrashSettings } from '@bookdock/shared'

import { apiGet, apiPut } from '@/api/client'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import QueryErrorState from '@/components/ui/QueryErrorState'
import Toggle from '@/components/ui/Toggle'
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

const TRASH_CAPS = [0, 1073741824, 2147483648, 5368709120] as const

const CAP_LABEL_KEYS: Record<(typeof TRASH_CAPS)[number], string> = {
  0: 'settings.trashCapUnlimited',
  1073741824: 'settings.trashCap1GB',
  2147483648: 'settings.trashCap2GB',
  5368709120: 'settings.trashCap5GB',
}

export default function TrashSettingsRow() {
  const _ = useTranslation()
  const queryClient = useQueryClient()
  const [disableOpen, setDisableOpen] = useState(false)
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiGet<{ data: SettingsRes }>('/settings'),
  })
  const mutation = useMutation({
    mutationFn: (trash: Partial<TrashSettings>) => apiPut('/settings', { trash }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      // Disabling permanently deletes the trash contents; refresh book lists.
      queryClient.invalidateQueries({ queryKey: ['books'] })
    },
    onError: (error) => notify.error(getUserErrorNotification(error, 'settings.trashSettingsUpdateFailed')),
  })
  if (settingsQuery.isError) {
    return <QueryErrorState className="py-4" isRetrying={settingsQuery.isFetching} onRetry={settingsQuery.refetch} />
  }
  if (settingsQuery.isLoading) {
    return (
      <div className="flex animate-pulse flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between" aria-busy="true">
        <div className="space-y-1.5">
          <div className="h-4 w-28 rounded bg-stone-200/80 dark:bg-stone-800" />
          <div className="h-3 w-48 rounded bg-stone-100 dark:bg-stone-800/60" />
        </div>
        <div className="h-7 w-40 rounded-lg bg-stone-100 dark:bg-stone-800/60" />
      </div>
    )
  }

  const trashSettings = settingsQuery.data?.data.trash
  const enabled = trashSettings?.enabled !== false
  const current = trashSettings?.autoCleanDays ?? 30
  const currentCap = trashSettings?.maxTrashBytes ?? 0

  return (
    <div className="flex flex-col divide-y divide-stone-100 dark:divide-stone-800/80">
      <div className="flex items-center justify-between gap-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-stone-700 dark:text-stone-200">{_('settings.trashEnabled')}</p>
          <p className="mt-0.5 text-xs text-stone-400 dark:text-stone-500">{_('settings.trashEnabledHint')}</p>
        </div>
        <Toggle
          checked={enabled}
          disabled={mutation.isPending}
          ariaLabel={_('settings.trashEnabled')}
          onChange={(v) => {
            if (!v) setDisableOpen(true)
            else mutation.mutate({ enabled: true })
          }}
        />
      </div>
      {enabled && (
        <>
          <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-stone-700 dark:text-stone-200">{_('settings.trashAutoClean')}</p>
              <p className="mt-0.5 text-xs text-stone-400 dark:text-stone-500">{_('settings.trashAutoCleanHint')}</p>
            </div>
            <div className="inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-stone-100 p-0.5 dark:bg-stone-800" role="group" aria-label={_('settings.trashAutoClean')}>
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
          <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-stone-700 dark:text-stone-200">{_('settings.trashCap')}</p>
              <p className="mt-0.5 text-xs text-stone-400 dark:text-stone-500">{_('settings.trashCapHint')}</p>
            </div>
            <div className="inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-stone-100 p-0.5 dark:bg-stone-800" role="group" aria-label={_('settings.trashCap')}>
              {TRASH_CAPS.map((cap) => (
                <button
                  key={cap}
                  type="button"
                  aria-pressed={currentCap === cap}
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate({ maxTrashBytes: cap })}
                  className={cn(
                    'flex h-7 items-center justify-center rounded-md px-3 text-xs font-medium transition-all disabled:opacity-60',
                    currentCap === cap
                      ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-stone-100'
                      : 'text-stone-500 hover:text-stone-800 dark:hover:text-stone-200',
                  )}
                >
                  {_(CAP_LABEL_KEYS[cap])}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      {disableOpen && (
        <ConfirmDialog
          title={_('settings.trashDisable')}
          message={_('settings.trashDisableConfirm')}
          confirmLabel={_('settings.trashDisableConfirmAction')}
          onConfirm={() => {
            setDisableOpen(false)
            mutation.mutate({ enabled: false })
          }}
          onClose={() => setDisableOpen(false)}
        />
      )}
    </div>
  )
}
