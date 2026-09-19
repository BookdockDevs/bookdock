import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { SettingsRes } from '@bookdock/shared'

import { apiGet, apiPut } from '@/api/client'
import QueryErrorState from '@/components/ui/QueryErrorState'
import Toggle from '@/components/ui/Toggle'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'

export default function TitleSettingsRow() {
  const _ = useTranslation()
  const queryClient = useQueryClient()
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiGet<{ data: SettingsRes }>('/settings'),
  })
  const mutation = useMutation({
    mutationFn: (normalizeTitle: boolean) => apiPut('/settings', { library: { normalizeTitle } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
    onError: (error) => notify.error(getUserErrorNotification(error, 'settings.titleSettingsUpdateFailed')),
  })
  if (settingsQuery.isError) {
    return <QueryErrorState className="py-4" isRetrying={settingsQuery.isFetching} onRetry={settingsQuery.refetch} />
  }
  if (settingsQuery.isLoading) {
    return (
      <div className="flex animate-pulse items-center justify-between gap-4 py-3" aria-busy="true">
        <div className="space-y-1.5">
          <div className="h-4 w-28 rounded bg-stone-200/80 dark:bg-stone-800" />
          <div className="h-3 w-48 rounded bg-stone-100 dark:bg-stone-800/60" />
        </div>
        <div className="h-6 w-11 rounded-full bg-stone-100 dark:bg-stone-800/60" />
      </div>
    )
  }

  // On while settings load or when stored settings predate the toggle.
  const normalizeTitle = settingsQuery.data?.data.library?.normalizeTitle !== false

  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-stone-700 dark:text-stone-200">{_('settings.bookTitleNormalize')}</p>
        <p className="mt-0.5 text-xs text-stone-400 dark:text-stone-500">{_('settings.bookTitleNormalizeHint')}</p>
      </div>
      <Toggle
        checked={normalizeTitle}
        disabled={mutation.isPending}
        ariaLabel={_('settings.bookTitleNormalize')}
        onChange={(v) => mutation.mutate(v)}
      />
    </div>
  )
}
