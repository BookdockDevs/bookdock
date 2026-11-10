import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'

import QueryErrorState from '@/components/ui/QueryErrorState'
import { DEVICE_VAULT_SCOPE, deviceCatalogOperations } from '@/features/local-library/catalog'
import { catalogQueryKey } from '@/features/reading-data/catalog'
import { useLocalCatalog } from '@/features/reading-data/catalog-source-context'
import { useTranslation } from '@/hooks/useTranslation'
import { formatBytes } from '@/lib/utils'

import SettingsCard from './SettingsCard'

function splitBytes(bytes: number): { value: string; unit: string } {
  const parts = formatBytes(bytes).split(' ')
  return { value: parts[0] || '0', unit: parts[1] || 'B' }
}

function DeviceDriveIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14a9 3 0 0 0 18 0V5" />
      <path d="M3 12a9 3 0 0 0 18 0" />
    </svg>
  )
}

interface DeviceStorageSectionProps {
  active?: boolean
}

export default function DeviceStorageSection({ active = true }: DeviceStorageSectionProps) {
  const _ = useTranslation()
  const local = useLocalCatalog()
  const scope = local?.scope ?? DEVICE_VAULT_SCOPE
  const operations = local?.operations ?? deviceCatalogOperations()

  const summaryQuery = useQuery({
    queryKey: catalogQueryKey(scope, 'storage-summary'),
    queryFn: () => operations.inspectStorage(),
    networkMode: 'always',
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  })
  const { refetch } = summaryQuery
  const wasActiveRef = useRef(active)
  useEffect(() => {
    if (active && !wasActiveRef.current) {
      void refetch()
    }
    wasActiveRef.current = active
  }, [active, refetch])

  const summary = summaryQuery.data

  return (
    <SettingsCard
      icon={<DeviceDriveIcon />}
      iconBgClass="bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400"
      title={_('settings.deviceStorageTitle')}
      bodyClassName="pt-4"
    >
      {summaryQuery.isError ? (
        <QueryErrorState className="py-4" isRetrying={summaryQuery.isFetching} onRetry={summaryQuery.refetch} />
      ) : summaryQuery.isLoading || !summary ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-busy="true">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="animate-pulse rounded-xl border border-stone-200/60 bg-white p-3.5 dark:border-stone-800 dark:bg-stone-900 motion-reduce:animate-none"
            >
              <div className="h-3 w-16 rounded bg-stone-200/70 dark:bg-stone-800" />
              <div className="mt-2.5 h-6 w-20 rounded bg-stone-200/90 dark:bg-stone-700" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex flex-col rounded-xl border border-stone-200/80 bg-white p-3.5 shadow-xs dark:border-stone-800 dark:bg-stone-900">
            <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
              {_('settings.deviceStorageBooks')}
            </span>
            <div className="mt-2.5 flex items-baseline">
              <span className="text-2xl font-bold tracking-tight tabular-nums text-stone-900 dark:text-stone-100 whitespace-nowrap">
                {summary.activeBooks}
              </span>
              <span className="ml-1 text-xs font-medium text-stone-400 dark:text-stone-500 whitespace-nowrap">
                {_('settings.deviceStorageBooksUnit')}
              </span>
            </div>
          </div>

          {(() => {
            const { value, unit } = splitBytes(summary.totalBytes)
            return (
              <div className="flex flex-col rounded-xl border border-stone-200/80 bg-white p-3.5 shadow-xs dark:border-stone-800 dark:bg-stone-900">
                <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
                  {_('settings.deviceStorageBookBytes')}
                </span>
                <div className="mt-2.5 flex items-baseline">
                  <span className="text-2xl font-bold tracking-tight tabular-nums text-stone-900 dark:text-stone-100 whitespace-nowrap">
                    {value}
                  </span>
                  <span className="ml-1 text-xs font-medium text-stone-400 dark:text-stone-500 whitespace-nowrap">
                    {unit}
                  </span>
                </div>
              </div>
            )
          })()}

          <div className="flex flex-col rounded-xl border border-stone-200/80 bg-white p-3.5 shadow-xs dark:border-stone-800 dark:bg-stone-900">
            <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
              {_('settings.deviceStorageBrowserUsage')}
            </span>
            {summary.browserUsage !== null ? (
              (() => {
                const { value, unit } = splitBytes(summary.browserUsage)
                return (
                  <div className="mt-2.5 flex items-baseline">
                    <span className="text-2xl font-bold tracking-tight tabular-nums text-stone-900 dark:text-stone-100 whitespace-nowrap">
                      {value}
                    </span>
                    <span className="ml-1 text-xs font-medium text-stone-400 dark:text-stone-500 whitespace-nowrap">
                      {unit}
                    </span>
                  </div>
                )
              })()
            ) : (
              <div className="mt-2.5 flex items-baseline">
                <span className="text-2xl font-bold tracking-tight text-stone-400 dark:text-stone-500">—</span>
              </div>
            )}
          </div>
        </div>
      )}
    </SettingsCard>
  )
}
