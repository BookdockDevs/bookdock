import { useQueryClient } from '@tanstack/react-query'

import { useInstanceInfo, useUpdateInstance } from '@/features/auth/hooks'
import QueryErrorState from '@/components/ui/QueryErrorState'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import { notify } from '@/lib/notifications'

const UPLOAD_CAPS = [104857600, 524288000, 1073741824, 2147483648, 5368709120] as const

const CAP_LABEL_KEYS: Record<(typeof UPLOAD_CAPS)[number], string> = {
  104857600: 'settings.uploadCap100MB',
  524288000: 'settings.uploadCap500MB',
  1073741824: 'settings.uploadCap1GB',
  2147483648: 'settings.uploadCap2GB',
  5368709120: 'settings.uploadCap5GB',
}

export default function UploadSettingsSection() {
  const _ = useTranslation()
  const queryClient = useQueryClient()
  const instanceQuery = useInstanceInfo()
  const updateInstance = useUpdateInstance()

  if (instanceQuery.isError) {
    return <QueryErrorState className="border-t border-stone-100 py-4 dark:border-stone-800" isRetrying={instanceQuery.isFetching} onRetry={instanceQuery.refetch} />
  }
  const instance = instanceQuery.data?.data
  if (!instance) return null

  const current = instance.uploadMaxBytes

  function save(cap: number) {
    updateInstance.mutate(
      { uploadMaxBytes: cap },
      {
        // The upload dialog pre-checks against GET /settings, so refresh it too.
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
        onError: (error) => notify.error(getUserErrorNotification(error, 'settings.uploadSettingsUpdateFailed')),
      },
    )
  }

  return (
    <div className="border-t border-stone-100 dark:border-stone-800">
      <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-stone-700 dark:text-stone-200">{_('settings.uploadCap')}</p>
          <p className="mt-0.5 text-xs text-stone-400 dark:text-stone-500">{_('settings.uploadCapHint')}</p>
        </div>
        <div className="inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-stone-100 p-0.5 dark:bg-stone-800" role="group" aria-label={_('settings.uploadCap')}>
          {UPLOAD_CAPS.map((cap) => (
            <button
              key={cap}
              type="button"
              aria-pressed={current === cap}
              disabled={updateInstance.isPending}
              onClick={() => save(cap)}
              className={cn(
                'flex h-7 items-center justify-center rounded-md px-3 text-xs font-medium transition-all disabled:opacity-60',
                current === cap
                  ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-stone-100'
                  : 'text-stone-500 hover:text-stone-800 dark:hover:text-stone-200',
              )}
            >
              {_(CAP_LABEL_KEYS[cap])}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
