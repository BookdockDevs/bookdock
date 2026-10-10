import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { StorageConnectionRes, StorageTargetInspectionRes } from '@bookdock/shared'

import {
  STORAGE_BACKEND_CONFIG_KEY,
  useClearStorageBackendCache,
  useInspectStorageTarget,
  usePauseStorageMigration,
  usePauseStorageRestore,
  useStartStorageMigration,
  useStartStorageRestore,
  useStorageBackendConfig,
  useStorageMigrationStatus,
  useStorageRestoreStatus,
  useTestStorageBackend,
  useUpdateStorageBackend,
} from '@/api/hooks/useStorageBackend'
import { useStorageConnections } from '@/api/hooks/useStorageConnections'
import { Button } from '@/components/ui/Button'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Modal from '@/components/ui/Modal'
import QueryErrorState from '@/components/ui/QueryErrorState'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { cn, formatBytes } from '@/lib/utils'

import AiModelIcon from './AiModelIcon'
import SettingsCard from './SettingsCard'
import SettingsFormField from './SettingsFormField'
import { settingsFormClass, settingsInputClass } from './settingsForm'
import StorageConnectionPicker from './StorageConnectionPicker'
import { StorageConnectionDialog } from './StorageConnectionsSection'
import { PROVIDER_MARK } from './storageProviderMark'

const CACHE_CAPS = [1024, 2048, 4096] as const

function splitBytes(bytes: number | undefined): { value: string; unit: string } {
  if (bytes === undefined || bytes === null) return { value: '0', unit: 'B' }
  const formatted = formatBytes(bytes)
  const parts = formatted.split(' ')
  return { value: parts[0] || '0', unit: parts[1] || 'B' }
}

function HardDriveIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="22" x2="12" y1="12" y2="12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      <line x1="6" x2="6.01" y1="16" y2="16" />
      <line x1="10" x2="10.01" y1="16" y2="16" />
    </svg>
  )
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  )
}

export default function StorageBackendSection() {
  const _ = useTranslation()

  const configQuery = useStorageBackendConfig()
  const connectionsQuery = useStorageConnections()

  const clearCacheMutation = useClearStorageBackendCache()
  const startMigrationMutation = useStartStorageMigration()
  const pauseMigrationMutation = usePauseStorageMigration()

  const config = configQuery.data?.data
  const connections = connectionsQuery.data?.data ?? []
  const isEnabled = config?.enabled ?? false
  const liveConnection = connections.find((c) => c.id === config?.connectionId)

  const migrationQuery = useStorageMigrationStatus({ enabled: isEnabled })
  const migration = migrationQuery.data?.data

  const queryClient = useQueryClient()

  // Keep dashboard metrics and cache size fresh whenever migration progresses or completes
  useEffect(() => {
    if (migration?.status === 'running' || migration?.status === 'completed') {
      void queryClient.invalidateQueries({ queryKey: STORAGE_BACKEND_CONFIG_KEY })
    }
  }, [migration?.status, migration?.migratedBooks, queryClient])

  const [showConfigModal, setShowConfigModal] = useState(false)
  const [showClearCacheConfirm, setShowClearCacheConfirm] = useState(false)

  const inspectMutation = useInspectStorageTarget()
  const [isMainInspecting, setIsMainInspecting] = useState(false)
  const [hasInspected, setHasInspected] = useState(false)
  const inspectMutateRef = useRef(inspectMutation.mutateAsync)
  inspectMutateRef.current = inspectMutation.mutateAsync

  useEffect(() => {
    if (
      config?.enabled &&
      config.connectionId &&
      (config.totalBookCount || 0) > (config.remoteBookCount || 0) &&
      !hasInspected &&
      !isMainInspecting &&
      migration?.status !== 'running'
    ) {
      setIsMainInspecting(true)
      void inspectMutateRef.current({
        target: 'remote',
        connectionId: config.connectionId,
        basePath: config.basePath || '/Bookdock/storage',
      })
        .then(() => {
          setHasInspected(true)
          void queryClient.invalidateQueries({ queryKey: STORAGE_BACKEND_CONFIG_KEY })
        })
        .catch(() => {
          setHasInspected(true)
        })
        .finally(() => {
          setIsMainInspecting(false)
        })
    }
  }, [config, hasInspected, isMainInspecting, migration?.status, queryClient])

  async function handleClearCache() {
    try {
      const res = await clearCacheMutation.mutateAsync()
      notify.success({
        key: 'settings.storageBackendClearCacheSuccess',
        params: {
          size: formatBytes(res.data.freedBytes),
          count: res.data.freedCount,
        },
      })
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'settings.storageBackendClearCacheFailed'))
    }
  }

  const isLoading = configQuery.isPending && !config

  return (
    <>
      <SettingsCard
        icon={<HardDriveIcon className="h-5 w-5" />}
        iconBgClass="bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400"
        title={_('settings.storageBackendTitle')}
        action={
          config && (
            <button
              type="button"
              disabled={isLoading || configQuery.isError}
              onClick={() => setShowConfigModal(true)}
              aria-label={_('settings.storageBackendConfigure') || '更改存储位置'}
              title={
                config.enabled
                  ? `${config.connectionName || '我的网盘'}${liveConnection ? ` (${PROVIDER_MARK[liveConnection.provider]?.label ?? liveConnection.provider})` : ''}`
                  : (_('settings.storageLocationLocalOption') || '本地磁盘')
              }
              className="group inline-flex h-8 items-center gap-2 rounded-lg border border-stone-200/90 bg-white/90 px-3 text-xs font-medium text-stone-700 shadow-2xs transition-all hover:border-stone-300 hover:bg-stone-50 hover:text-stone-900 active:scale-[0.98] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-700/80 dark:bg-stone-800/80 dark:text-stone-300 dark:hover:border-stone-600 dark:hover:bg-stone-700/90 dark:hover:text-stone-100"
            >
              <span
                className={cn(
                  'h-2 w-2 rounded-full shrink-0',
                  config.enabled
                    ? config.status === 'active'
                      ? 'bg-emerald-500'
                      : 'bg-rose-500'
                    : 'bg-stone-400',
                )}
              />
              <span
                className="truncate max-w-[160px]"
              >
                {config.enabled
                  ? (config.connectionName || '我的网盘')
                  : (_('settings.storageLocationLocalOption') || '本地磁盘')}
              </span>
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0 text-stone-400 transition-transform group-hover:translate-x-0.5 group-hover:text-stone-600 dark:text-stone-500 dark:group-hover:text-stone-300"
                aria-hidden="true"
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          )
        }
        bodyClassName="space-y-4 pt-4"
      >
        {configQuery.isError ? (
          <QueryErrorState
            className="py-4"
            isRetrying={configQuery.isFetching}
            onRetry={configQuery.refetch}
          />
        ) : isLoading || !config ? (
          <div className="grid grid-cols-3 gap-3" aria-busy="true">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="animate-pulse rounded-xl border border-stone-200/60 bg-white p-3 dark:border-stone-800 dark:bg-stone-900"
              >
                <div className="h-3 w-16 rounded bg-stone-200/70 dark:bg-stone-800" />
                <div className="mt-2 h-5 w-20 rounded bg-stone-200/90 dark:bg-stone-700" />
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* Global Storage Capacity Dashboard */}
            <div
              className={cn(
                'grid gap-3 sm:gap-3.5',
                config.enabled ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3',
              )}
            >
              {/* Local Footprint */}
              {(() => {
                const { value, unit } = splitBytes(config.localTotalBytes ?? (config.totalBookBytes + config.totalCoverBytes))
                return (
                  <div className="flex flex-col justify-between rounded-xl border border-stone-200/80 bg-white p-3.5 shadow-xs dark:border-stone-800 dark:bg-stone-900">
                    <div className="flex h-5 items-center justify-between">
                      <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
                        {_('settings.storageBackendMetricsLocalTotal')}
                      </span>
                    </div>
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

              {/* Book Files */}
              {(() => {
                const { value, unit } = splitBytes(config.totalBookBytes)
                return (
                  <div className="flex flex-col justify-between rounded-xl border border-stone-200/80 bg-white p-3.5 shadow-xs dark:border-stone-800 dark:bg-stone-900">
                    <div className="flex h-5 items-center justify-between">
                      <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
                        {_('settings.storageBackendMetricsTotal')}
                      </span>
                    </div>
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

              {/* Available Disk Space (Shown in both Local and External modes) */}
              {config.availableDiskBytes !== undefined && (() => {
                const { value, unit } = splitBytes(config.availableDiskBytes)
                return (
                  <div className="flex flex-col justify-between rounded-xl border border-stone-200/80 bg-white p-3.5 shadow-xs dark:border-stone-800 dark:bg-stone-900">
                    <div className="flex h-5 items-center justify-between">
                      <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
                        {_('settings.storageBackendMetricsAvailableDisk')}
                      </span>
                    </div>
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

              {/* External Storage metrics: Cached Size (4th position) */}
              {config.enabled && (() => {
                const { value, unit } = splitBytes(config.localCachedBytes)
                return (
                  <div className="flex flex-col justify-between rounded-xl border border-stone-200/80 bg-white p-3.5 shadow-xs dark:border-stone-800 dark:bg-stone-900">
                    <div className="flex h-5 items-center justify-between">
                      <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
                        {_('settings.storageBackendMetricsCached')}
                      </span>
                      <button
                        type="button"
                        disabled={clearCacheMutation.isPending || (config.localCachedBytes || 0) === 0}
                        onClick={() => setShowClearCacheConfirm(true)}
                        className="inline-flex h-5 w-5 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-stone-400 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200 cursor-pointer disabled:cursor-not-allowed"
                        aria-label={_('settings.storageBackendClearCache')}
                        title={_('settings.storageBackendClearCache')}
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
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
            </div>

            {/* Sync Failure Alert */}
            {config.enabled && migration?.status === 'failed' && (config.failedTransferCount || 0) > 0 && (
              <div className="rounded-xl border border-amber-200/80 bg-amber-50/60 p-3.5 dark:border-amber-900/50 dark:bg-amber-950/20">
                <div className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-300">
                  <svg className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                    <line x1="12" x2="12" y1="9" y2="13" />
                    <line x1="12" x2="12.01" y1="17" y2="17" />
                  </svg>
                  <span>检测到有 {config.failedTransferCount} 本书籍同步失败，请检查网络连接</span>
                </div>
              </div>
            )}

            {/* Background Reconciling Inspection Card */}
            {config.enabled && isMainInspecting && (
              <div className="rounded-xl border border-stone-200/80 bg-stone-50/50 p-3.5 dark:border-stone-800 dark:bg-stone-900/30">
                <div className="flex items-center gap-2.5 text-xs text-stone-600 dark:text-stone-300">
                  <svg className="h-4 w-4 shrink-0 animate-spin text-stone-500" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  <div>
                    <div className="font-semibold">{_('settings.storageBackendMigrationTitle')}</div>
                    <div className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                      {_('settings.storageBackendMigrationDesc')}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Migration Card (Shown when external storage is enabled and there are local books to migrate) */}
            {config.enabled &&
              !isMainInspecting &&
              (((config.totalBookCount || 0) > (config.remoteBookCount || 0) &&
                migration?.status !== 'completed') ||
                migration?.status === 'running') && (
              <div className="rounded-xl border border-stone-200/80 bg-stone-50/50 p-3.5 dark:border-stone-800 dark:bg-stone-900/30">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-semibold text-stone-800 dark:text-stone-100">
                      {_('settings.storageBackendMigrationTitle')}
                    </h3>
                    <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                      {_('settings.storageBackendMigrationDesc')}
                    </p>
                  </div>
                  <div>
                    {migration?.status === 'running' ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={pauseMigrationMutation.isPending}
                        onClick={() => void pauseMigrationMutation.mutateAsync()}
                      >
                        {_('settings.storageBackendMigrationPause')}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={startMigrationMutation.isPending}
                        onClick={() => void startMigrationMutation.mutateAsync()}
                      >
                        {_('settings.storageBackendMigrationStart')}
                      </Button>
                    )}
                  </div>
                </div>

                {migration && migration.status !== 'idle' && (
                  <div className="mt-3 space-y-1.5">
                    <div className="flex justify-between text-xs text-stone-500">
                      <span>
                        进度: {migration.migratedBooks} / {migration.totalBooks} 本
                      </span>
                      <span className="font-mono">
                        {migration.totalBooks > 0
                          ? `${Math.round((migration.migratedBooks / migration.totalBooks) * 100)}%`
                          : '0%'}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-200/80 dark:bg-stone-700">
                      <div
                        className="h-full rounded-full bg-stone-800 transition-all duration-300 dark:bg-stone-200"
                        style={{
                          width: `${migration.totalBooks > 0 ? (migration.migratedBooks / migration.totalBooks) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </SettingsCard>

      {/* Standard Configuration Modal */}
      {showConfigModal && config && (
        <StorageConfigModal
          config={config}
          connections={connections}
          onClose={() => setShowConfigModal(false)}
        />
      )}

      {/* Clear Cache Confirmation Dialog */}
      {showClearCacheConfirm && (
        <ConfirmDialog
          title={_('settings.storageBackendClearCacheConfirmTitle') || '清理本地缓存'}
          message={
            _('settings.storageBackendClearCacheConfirmMsg') ||
            '确定要清理本地缓存吗？清理后已下载的书籍缓存将被移除以释放磁盘空间，再次阅读时会自动从远端存储按需加载。'
          }
          confirmLabel={_('settings.storageBackendClearCacheConfirmBtn') || '确认清理'}
          confirmVariant="danger"
          onConfirm={async () => {
            await handleClearCache()
            setShowClearCacheConfirm(false)
          }}
          onClose={() => setShowClearCacheConfirm(false)}
        />
      )}
    </>
  )
}

interface StorageConfigModalProps {
  config: NonNullable<ReturnType<typeof useStorageBackendConfig>['data']>['data']
  connections: StorageConnectionRes[]
  onClose: () => void
}

function StorageConfigModal({ config, connections, onClose }: StorageConfigModalProps) {
  const _ = useTranslation()
  const updateMutation = useUpdateStorageBackend()
  const testMutation = useTestStorageBackend()

  const [selectedTarget, setSelectedTarget] = useState<'local' | string>(() =>
    config.enabled && config.connectionId ? config.connectionId : 'local',
  )
  const [basePath, setBasePath] = useState(config.basePath || '/Bookdock/storage')
  const [cacheMaxMb, setCacheMaxMb] = useState(config.cacheMaxMb || 2048)
  const [isCustomCache, setIsCustomCache] = useState(
    !CACHE_CAPS.includes((config.cacheMaxMb || 2048) as (typeof CACHE_CAPS)[number]),
  )
  const [probeLatency, setProbeLatency] = useState<number | null>(null)
  const [showAddConnection, setShowAddConnection] = useState(false)


  const isLocal = selectedTarget === 'local'

  const inspectMutation = useInspectStorageTarget()
  const [targetInspection, setTargetInspection] = useState<StorageTargetInspectionRes | null>(null)
  const [isLocalInspecting, setIsLocalInspecting] = useState(false)
  const inspectMutateRef = useRef(inspectMutation.mutateAsync)
  inspectMutateRef.current = inspectMutation.mutateAsync

  const isSaving = updateMutation.isPending
  const isInspecting = inspectMutation.isPending || isLocalInspecting
  const isTesting = testMutation.isPending || isInspecting
  const isCacheMaxMbValid =
    Number.isInteger(cacheMaxMb) && cacheMaxMb >= 128 && cacheMaxMb <= 1048576
  const cacheError =
    !isLocal && !isCacheMaxMbValid
      ? (_('settings.storageBackendCacheInvalid') || '请输入 128～1048576 之间的整数（MB）')
      : undefined

  const restoreStatus = useStorageRestoreStatus({ enabled: isLocal && config.enabled })
  const startRestoreMutation = useStartStorageRestore()
  const pauseRestoreMutation = usePauseStorageRestore()

  useEffect(() => {
    if (isLocal && config.enabled) {
      setIsLocalInspecting(true)
      void inspectMutateRef.current({ target: 'local' })
        .then((res) => {
          setTargetInspection(res.data)
        })
        .catch(() => {})
        .finally(() => {
          setIsLocalInspecting(false)
        })
    } else {
      setIsLocalInspecting(false)
    }
  }, [isLocal, config.enabled])

  useEffect(() => {
    if (isLocal && config.enabled && restoreStatus.data?.data?.status === 'completed') {
      setIsLocalInspecting(true)
      void inspectMutateRef.current({ target: 'local' })
        .then((res) => {
          setTargetInspection(res.data)
        })
        .catch(() => {})
        .finally(() => {
          setIsLocalInspecting(false)
        })
    }
  }, [isLocal, config.enabled, restoreStatus.data?.data?.status])

  const missingRestoreCount = useMemo(() => {
    if (!isLocal || !config.enabled) return 0
    if (restoreStatus.data?.data && restoreStatus.data.data.status !== 'idle') {
      const rest = restoreStatus.data.data
      if (rest.status === 'completed') return 0
      return Math.max(0, rest.totalBooks - rest.restoredBooks)
    }
    if (targetInspection && targetInspection.target === 'local') {
      return targetInspection.missingBooks
    }
    return Math.max(0, (config.remoteBookCount || 0) - (config.localCachedCount || 0))
  }, [isLocal, config, restoreStatus.data, targetInspection])

  const isRestoring = restoreStatus.data?.data?.status === 'running'
  const isRestoreCompleted =
    !config.enabled ||
    (targetInspection?.target === 'local' && targetInspection.ready) ||
    restoreStatus.data?.data?.status === 'completed'

  const isCrossRemote = !isLocal && config.enabled && selectedTarget !== config.connectionId
  const isCrossRemoteBlocked = isCrossRemote && (targetInspection === null || !targetInspection.ready)

  const isEnablingOrChangingRemote =
    !isLocal &&
    (!config.enabled ||
      selectedTarget !== config.connectionId ||
      basePath.trim() !== (config.basePath || '/Bookdock/storage').trim())
  const needsTest = !isLocal && isEnablingOrChangingRemote && probeLatency === null
  const canSave =
    !isSaving &&
    !isTesting &&
    !isLocalInspecting &&
    (isLocal ? true : isCacheMaxMbValid) &&
    (isLocal
      ? isRestoreCompleted
      : (!isEnablingOrChangingRemote || probeLatency !== null) && !isCrossRemoteBlocked)

  async function handleTestProbe() {
    if (isLocal || !selectedTarget) return
    setProbeLatency(null)
    setTargetInspection(null)
    try {
      const res = await testMutation.mutateAsync({
        connectionId: selectedTarget,
        basePath: basePath.trim() || '/Bookdock/storage',
      })
      setProbeLatency(res.data.latencyMs)
      notify.success({
        key: 'settings.storageBackendProbeSuccess',
        params: { latency: res.data.latencyMs },
      })

      if (isCrossRemote) {
        const inspectRes = await inspectMutation.mutateAsync({
          target: 'remote',
          connectionId: selectedTarget,
          basePath: basePath.trim() || '/Bookdock/storage',
        })
        setTargetInspection(inspectRes.data)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      notify.error({
        key: 'settings.storageBackendProbeFailed',
        params: { message: msg },
      })
    }
  }

  async function handleSave() {
    if (!canSave) return
    try {
      if (isLocal) {
        await updateMutation.mutateAsync({
          enabled: false,
          connectionId: config.connectionId,
          basePath: config.basePath || '/Bookdock/storage',
          cacheMaxMb: config.cacheMaxMb || 2048,
        })
      } else {
        await updateMutation.mutateAsync({
          enabled: true,
          connectionId: selectedTarget,
          basePath: basePath.trim() || '/Bookdock/storage',
          cacheMaxMb,
        })
      }
      notify.success({ key: 'settings.storageBackendSaveSuccess' })
      onClose()
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'settings.storageBackendSaveFailed'))
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (needsTest) {
      void handleTestProbe()
    } else {
      void handleSave()
    }
  }

  function handleConnectionCreated(conn: StorageConnectionRes) {
    setShowAddConnection(false)
    setSelectedTarget(conn.id)
    setProbeLatency(null)
  }

  return (
    <>
      <Modal onClose={onClose} title={_('settings.storageConfigureModalTitle') || '更改存储位置'}>
        <form onSubmit={handleSubmit} className={settingsFormClass}>
          {/* Target selection */}
          <SettingsFormField label={_('settings.storageLocationLabel') || '存储目标'} required as="div">
            <div className="relative">
              <StorageConnectionPicker
                connections={connections}
                value={selectedTarget}
                onChange={(id) => {
                  setSelectedTarget(id)
                  setProbeLatency(null)
                  setTargetInspection(null)
                }}
                showLocalOption
                localLabel={_('settings.storageLocationLocalOption') || '本地磁盘'}
                onAddNew={() => setShowAddConnection(true)}
                addNewLabel={_('settings.storageBackendConnectionAddNew')}
                triggerClassName="border-stone-200/90 bg-stone-50/80 py-1.5 shadow-2xs hover:bg-stone-100 dark:bg-stone-800/80 dark:hover:bg-stone-700 cursor-pointer"
                menuWidth={180}
                menuClassName="!z-[60]"
                ariaLabel={_('settings.storageLocationLabel') || '存储目标'}
              />
            </div>
          </SettingsFormField>

          {/* Base path input with embedded test probe */}
          <SettingsFormField label={_('settings.storageBackendBasePath') || '存储路径'} required={!isLocal}>
            <div className="relative">
              <input
                type="text"
                value={isLocal ? '' : basePath}
                onChange={(e) => {
                  setBasePath(e.target.value)
                  setProbeLatency(null)
                  setTargetInspection(null)
                }}
                placeholder={isLocal ? '-' : '/Bookdock/storage'}
                disabled={isLocal}
                className={cn(
                  settingsInputClass,
                  'font-mono text-xs',
                  !isLocal && probeLatency !== null ? 'pr-20' : 'pr-9',
                  isLocal && 'cursor-not-allowed bg-stone-50 text-stone-400 opacity-60 dark:bg-stone-800/40 dark:text-stone-600',
                )}
                required={!isLocal}
              />
              <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
                {!isLocal && probeLatency !== null && (
                  <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                    {probeLatency}ms
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void handleTestProbe()}
                  disabled={isLocal || isTesting}
                  aria-label={
                    isLocal
                      ? undefined
                      : isTesting
                        ? (_('settings.storageBackendProbing') || '测试中...')
                        : (_('settings.storageBackendProbeBtn') || '测试连通性')
                  }
                  title={
                    isLocal
                      ? undefined
                      : isTesting
                        ? (_('settings.storageBackendProbing') || '测试中...')
                        : (_('settings.storageBackendProbeBtn') || '测试连通性')
                  }
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                >
                  <AiModelIcon
                    kind="test"
                    className={!isLocal && isTesting ? 'h-4 w-4 animate-pulse' : 'h-4 w-4'}
                  />
                </button>
              </div>
            </div>

            {/* Cross-remote inspection feedback */}
            {isCrossRemote && (
              <div className="mt-2 space-y-1.5">
                {isInspecting && (
                  <div className="text-xs text-stone-500 dark:text-stone-400">
                    正在比对目标存储中的历史书籍文件...
                  </div>
                )}
                {targetInspection && !targetInspection.ready && (
                  <div className="rounded-xl border border-red-200/80 bg-red-50/60 p-3.5 dark:border-red-950 dark:bg-red-950/20">
                    <div className="flex items-start gap-2 text-xs text-red-700 dark:text-red-400">
                      <svg className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" />
                        <path d="m15 9-6 6" />
                        <path d="m9 9 6 6" />
                      </svg>
                      <div>
                        <div className="font-semibold">目标存储未检测到历史书籍文件</div>
                        <div className="mt-1 text-xs leading-relaxed text-red-600 dark:text-red-400/90">
                          {targetInspection.message || '请先切换至本地将书籍下载完整，或在外部存储中将旧目录文件复制到新路径。'}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {targetInspection && targetInspection.ready && (
                  <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/60 p-3.5 dark:border-emerald-950 dark:bg-emerald-950/20">
                    <div className="flex items-start gap-2 text-xs text-emerald-700 dark:text-emerald-400">
                      <svg className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                      <div>
                        <div className="font-semibold">目标路径已存在匹配的书籍文件</div>
                        <div className="mt-0.5 text-xs text-emerald-600 dark:text-emerald-400/90">
                          比对通过，新存储路径已具备全量书籍，可直接保存切换。
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </SettingsFormField>

          {/* Cache size limit segmented control */}
          <SettingsFormField label={_('settings.storageBackendCacheMaxMb')} error={cacheError}>
            <div className={cn('flex flex-wrap items-center gap-2', isLocal && 'opacity-50 pointer-events-none')}>
              <div
                className="inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-stone-100 p-0.5 dark:bg-stone-800"
                role="group"
              >
                {CACHE_CAPS.map((cap) => (
                  <button
                    key={cap}
                    type="button"
                    disabled={isLocal}
                    aria-pressed={!isCustomCache && cacheMaxMb === cap}
                    onClick={() => {
                      setCacheMaxMb(cap)
                      setIsCustomCache(false)
                    }}
                    className={cn(
                      'flex h-7 items-center justify-center rounded-md px-2.5 text-xs font-medium transition-all cursor-pointer',
                      !isCustomCache && cacheMaxMb === cap
                        ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-stone-100'
                        : 'text-stone-500 hover:text-stone-800 dark:hover:text-stone-200',
                    )}
                  >
                    {`${cap / 1024} GB`}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={isLocal}
                  aria-pressed={isCustomCache}
                  onClick={() => setIsCustomCache(true)}
                  className={cn(
                    'flex h-7 items-center justify-center rounded-md px-2.5 text-xs font-medium transition-all cursor-pointer',
                    isCustomCache
                      ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-stone-100'
                      : 'text-stone-500 hover:text-stone-800 dark:hover:text-stone-200',
                  )}
                >
                  {_('settings.storagePresetCustom')}
                </button>
              </div>

              {isCustomCache && (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={128}
                    max={1048576}
                    step={128}
                    value={cacheMaxMb}
                    disabled={isLocal}
                    aria-invalid={!isCacheMaxMbValid}
                    onChange={(e) => setCacheMaxMb(Number(e.target.value) || 0)}
                    className={cn(settingsInputClass, 'w-24 font-mono text-xs')}
                  />
                  <span className="text-xs text-stone-400">MB</span>
                </div>
              )}
            </div>
          </SettingsFormField>

          {/* Inspection state and Restore Warning Card */}
          {isLocal && config.enabled && isLocalInspecting && !targetInspection && (
            <div className="text-xs text-stone-500 dark:text-stone-400">
              正在比对本地磁盘和远端存储的书籍文件...
            </div>
          )}

          {isLocal && config.enabled && !isLocalInspecting && targetInspection?.target === 'local' && targetInspection.ready && (
            <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/60 p-3.5 dark:border-emerald-950 dark:bg-emerald-950/20">
              <div className="flex items-start gap-2 text-xs text-emerald-700 dark:text-emerald-400">
                <svg className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                <div>
                  <div className="font-semibold">本地磁盘已具备全量书籍文件</div>
                  <div className="mt-0.5 text-xs text-emerald-600 dark:text-emerald-400/90">
                    比对通过，全部 {targetInspection.totalBooks} 本书籍均已在本地存储，可安全切换。
                  </div>
                </div>
              </div>
            </div>
          )}

          {isLocal && config.enabled && missingRestoreCount > 0 && (
            <div className="rounded-xl border border-amber-200/80 bg-amber-50/60 p-3.5 dark:border-amber-900/50 dark:bg-amber-950/20">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0 flex-1">
                  <svg className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                    <line x1="12" x2="12" y1="9" y2="13" />
                    <line x1="12" x2="12.01" y1="17" y2="17" />
                  </svg>
                  <div className="min-w-0">
                    <h4 className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                      检测到部分书籍仅保存在远端存储
                    </h4>
                    <p className="mt-1 text-xs leading-relaxed text-amber-700 dark:text-amber-300/90">
                      共有 {missingRestoreCount} 本书籍尚未下载到本地{targetInspection?.missingBytes ? `（约 ${formatBytes(targetInspection.missingBytes)}）` : ''}。切回本地存储前需先下载还原，以防书籍无法打开。
                    </p>
                  </div>
                </div>
                <div className="shrink-0 self-start sm:self-auto">
                  {isRestoring ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="whitespace-nowrap"
                      disabled={pauseRestoreMutation.isPending}
                      onClick={() => void pauseRestoreMutation.mutateAsync()}
                    >
                      暂停下载
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      className="whitespace-nowrap"
                      disabled={startRestoreMutation.isPending}
                      onClick={() => void startRestoreMutation.mutateAsync()}
                    >
                      下载还原至本地
                    </Button>
                  )}
                </div>
              </div>

              {restoreStatus.data?.data && restoreStatus.data.data.status !== 'idle' && (
                <div className="mt-3 space-y-1.5 border-t border-amber-200/50 pt-2 dark:border-amber-900/40">
                  <div className="flex justify-between text-xs text-amber-800 dark:text-amber-300">
                    <span>
                      {restoreStatus.data.data.status === 'completed'
                        ? '书籍已全部还原至本地'
                        : `还原进度: ${restoreStatus.data.data.restoredBooks} / ${restoreStatus.data.data.totalBooks} 本`}
                    </span>
                    <span className="font-mono">
                      {restoreStatus.data.data.totalBooks > 0
                        ? `${Math.round((restoreStatus.data.data.restoredBooks / restoreStatus.data.data.totalBooks) * 100)}%`
                        : '0%'}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-amber-200 dark:bg-amber-900/50">
                    <div
                      className="h-full bg-amber-600 transition-all duration-300"
                      style={{
                        width: `${restoreStatus.data.data.totalBooks > 0 ? (restoreStatus.data.data.restoredBooks / restoreStatus.data.data.totalBooks) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Clean Modal Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-stone-100 pt-4 dark:border-stone-800">
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>
              {_('common.cancel') || '取消'}
            </Button>
            {needsTest ? (
              <Button
                type="button"
                size="sm"
                disabled={isTesting || !selectedTarget}
                onClick={() => void handleTestProbe()}
              >
                {isTesting ? (_('settings.storageBackendProbing') || '测试中...') : (_('settings.storageBackendTestBtn') || '测试')}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={!canSave}
                onClick={() => void handleSave()}
              >
                {isSaving ? '保存中...' : (_('settings.storageBackendSaveAndApply') || '保存')}
              </Button>
            )}
          </div>
        </form>
      </Modal>

      {/* Add connection dialog */}
      {showAddConnection && (
        <StorageConnectionDialog
          mode="add"
          onClose={() => setShowAddConnection(false)}
          onSuccess={handleConnectionCreated}
        />
      )}
    </>
  )
}
