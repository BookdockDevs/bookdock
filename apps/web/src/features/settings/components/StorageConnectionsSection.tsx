import { useMemo, useState } from 'react'
import type { StorageConnectionRes } from '@bookdock/shared'

import {
  useCreateStorageConnection,
  useDeleteStorageConnection,
  useStorageConnections,
  useTestDirectStorageConnection,
  useTestStorageConnection,
  useUpdateStorageConnection,
} from '@/api/hooks/useStorageConnections'
import { useStorageBackendConfig } from '@/api/hooks/useStorageBackend'
import { Button } from '@/components/ui/Button'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Modal from '@/components/ui/Modal'
import SmartMenu from '@/components/ui/SmartMenu'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { computeDropdownPosition } from '@/lib/position'
import { cn } from '@/lib/utils'
import { useContextMenu } from '@/features/library/components/use-context-menu'

import AiModelIcon from './AiModelIcon'
import SettingsCard from './SettingsCard'
import SettingsEmptyState from '@/components/ui/SettingsEmptyState'
import SettingsFormField from './SettingsFormField'
import { settingsFormClass, settingsInputClass } from './settingsForm'
import { PROVIDER_MARK } from './storageProviderMark'

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  )
}

interface EditModalState {
  open: boolean
  mode: 'add' | 'edit'
  connection?: StorageConnectionRes
}

function formatEndpointDisplay(endpoint: string): string {
  try {
    const url = new URL(endpoint)
    const hostParts = url.hostname.split('.')
    // Cloudflare R2 or other endpoints with 32-hex account ID subdomain
    if (hostParts[0]?.length === 32 && /^[a-f0-9]+$/i.test(hostParts[0])) {
      const shortHash = `${hostParts[0].slice(0, 6)}…${hostParts[0].slice(-4)}`
      const shortHost = [shortHash, ...hostParts.slice(1)].join('.')
      return `${url.protocol}//${shortHost}${url.pathname === '/' ? '' : url.pathname}`
    }
  } catch {
    // fallback
  }
  return endpoint
}

export default function StorageConnectionsSection() {
  const _ = useTranslation()
  const { data: connectionsRes, isLoading } = useStorageConnections()
  const connections = connectionsRes?.data ?? []

  const deleteMutation = useDeleteStorageConnection()
  const testMutation = useTestStorageConnection()

  const [modalState, setModalState] = useState<EditModalState>({ open: false, mode: 'add' })
  const [pendingDelete, setPendingDelete] = useState<StorageConnectionRes | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; latencyMs?: number; message?: string }>>({})

  function handleOpenAdd() {
    setModalState({ open: true, mode: 'add' })
  }

  function handleOpenEdit(conn: StorageConnectionRes) {
    setModalState({ open: true, mode: 'edit', connection: conn })
  }

  function handleDeleteClick(e: React.MouseEvent<HTMLButtonElement>, conn: StorageConnectionRes) {
    if (e.detail > 0) e.currentTarget.blur()
    setPendingDelete(conn)
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    try {
      await deleteMutation.mutateAsync(pendingDelete.id)
      notify.success({ key: 'settings.storageConnectionsDeleteSuccess' })
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'settings.storageConnectionsDeleteFailed'))
    } finally {
      setPendingDelete(null)
    }
  }

  async function handleTest(conn: StorageConnectionRes) {
    setTestingId(conn.id)
    try {
      const res = await testMutation.mutateAsync({ id: conn.id })
      setTestResults((prev) => ({
        ...prev,
        [conn.id]: { success: true, latencyMs: res.data.latencyMs },
      }))
      notify.success({
        key: 'settings.storageConnectionsTestSuccess',
        params: { name: conn.name, latency: res.data.latencyMs },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setTestResults((prev) => ({
        ...prev,
        [conn.id]: { success: false, message: msg },
      }))
      notify.error({
        key: 'settings.storageConnectionsTestFailed',
        params: { message: msg },
      })
    } finally {
      setTestingId(null)
    }
  }

  return (
    <>
      <SettingsCard
        id="storage-connections-settings"
        icon={
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
          </svg>
        }
        iconBgClass="bg-sky-500/10 text-sky-600 dark:bg-sky-500/20 dark:text-sky-400"
        title={_('settings.storageConnectionsTitle') || '外部存储'}
        description={_('settings.storageConnectionsDesc') || '连接 WebDAV、S3 等存储服务，浏览并批量导入图书。'}
        action={
          <Button type="button" variant="secondary" size="sm" onClick={handleOpenAdd} className="shrink-0 whitespace-nowrap gap-1.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14" />
              <path d="M12 5v14" />
            </svg>
            {_('settings.storageConnectionsAdd') || '添加存储'}
          </Button>
        }
        bodyClassName="pt-3"
      >
        {isLoading ? (
          <div className="flex flex-col gap-2.5 pt-1" aria-busy="true" aria-label={_('settings.storageConnectionsLoading') || '正在加载存储…'}>
            {[1, 2].map((i) => (
              <div
                key={i}
                className="flex animate-pulse items-center justify-between rounded-xl border border-stone-200/50 bg-stone-50/30 p-3 sm:gap-4 dark:border-stone-800/60 dark:bg-stone-800/20"
              >
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-28 rounded-md bg-stone-200/70 dark:bg-stone-800" />
                    <div className="h-3.5 w-12 rounded-md bg-stone-200/50 dark:bg-stone-800/60" />
                  </div>
                  <div className="h-3 w-52 rounded bg-stone-200/40 dark:bg-stone-800/40" />
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <div className="h-7 w-7 rounded-lg bg-stone-200/50 dark:bg-stone-800/50" />
                  <div className="h-7 w-7 rounded-lg bg-stone-200/50 dark:bg-stone-800/50" />
                  <div className="h-7 w-7 rounded-lg bg-stone-200/50 dark:bg-stone-800/50" />
                </div>
              </div>
            ))}
          </div>
        ) : connections.length === 0 ? (
          <SettingsEmptyState>
            {_('settings.storageConnectionsEmpty') || '暂无外部存储'}
          </SettingsEmptyState>
        ) : (
          <div className="space-y-2.5">
            {connections.map((conn) => {
              const testRes = testResults[conn.id]
              const isTesting = testingId === conn.id

              return (
                <div
                  key={conn.id}
                  className="group flex items-center gap-3 rounded-xl border border-stone-200/80 bg-stone-50/50 p-3 transition-colors hover:border-stone-300 dark:border-stone-800/80 dark:bg-stone-900/40 dark:hover:border-stone-700"
                >
                  <span
                    title={PROVIDER_MARK[conn.provider]?.label ?? conn.provider}
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg shadow-2xs',
                      PROVIDER_MARK[conn.provider]?.tileClassName ??
                        'border border-stone-200/80 bg-stone-100 text-stone-500 dark:border-stone-800 dark:bg-stone-800 dark:text-stone-400',
                    )}
                  >
                    {PROVIDER_MARK[conn.provider]?.mark ?? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect width="20" height="7" x="2" y="3" rx="2" />
                        <rect width="20" height="7" x="2" y="14" rx="2" />
                        <line x1="6" x2="6.01" y1="6.5" y2="6.5" />
                        <line x1="6" x2="6.01" y1="17.5" y2="17.5" />
                      </svg>
                    )}
                  </span>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-stone-900 dark:text-stone-100 truncate" title={conn.name}>{conn.name}</span>
                      {testRes?.success && (
                        <span
                          className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                          title={_('settings.storageConnectionsTestSuccess', { name: conn.name, latency: testRes.latencyMs ?? 0 }) || `连接成功：${conn.name}（${testRes.latencyMs}ms）`}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          {testRes.latencyMs}ms
                        </span>
                      )}
                      {testRes && !testRes.success && (
                        <span className="inline-flex items-center gap-1 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-400" title={testRes.message}>
                          <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                          {_('settings.storageConnectionsTestFailedBadge') || '失败'}
                        </span>
                      )}
                    </div>
                    <div className="truncate text-xs font-mono text-stone-400 dark:text-stone-500" title={conn.provider === 's3' && conn.bucket ? `${conn.bucket} · ${conn.endpoint}` : conn.endpoint}>
                      {formatEndpointDisplay(conn.endpoint)}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:has-[:focus-visible]:opacity-100">
                    <button
                      type="button"
                      onClick={(e) => {
                        if (e.detail > 0) e.currentTarget.blur()
                        void handleTest(conn)
                      }}
                      disabled={isTesting}
                      aria-label={isTesting ? (_('settings.webdavTesting') || '测试中...') : (_('settings.storageConnectionsTest') || '测试连接')}
                      title={isTesting ? (_('settings.webdavTesting') || '测试中...') : (_('settings.storageConnectionsTest') || '测试连接')}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-blue-50 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-stone-800 dark:hover:text-blue-300"
                    >
                      <AiModelIcon kind="test" className={isTesting ? 'h-4 w-4 animate-pulse' : 'h-4 w-4'} />
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        if (e.detail > 0) e.currentTarget.blur()
                        handleOpenEdit(conn)
                      }}
                      aria-label={_('settings.storageConnectionsEdit') || '编辑'}
                      title={_('settings.storageConnectionsEdit') || '编辑'}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                    >
                      <EditIcon />
                    </button>

                    <button
                      type="button"
                      onClick={(e) => handleDeleteClick(e, conn)}
                      disabled={deleteMutation.isPending}
                      aria-label={_('settings.storageConnectionsDelete') || '删除'}
                      title={_('settings.storageConnectionsDelete') || '删除'}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </SettingsCard>

      {pendingDelete && (
        <ConfirmDialog
          title={_('settings.confirmDeleteTitle') || '确认删除'}
          message={_('settings.storageConnectionsDeleteConfirm', { name: pendingDelete.name }) || `确定要删除存储连接「${pendingDelete.name}」吗？`}
          confirmLabel={_('settings.confirmDeleteAction') || '删除'}
          onConfirm={confirmDelete}
          onClose={() => setPendingDelete(null)}
        />
      )}

      {modalState.open && (
        <StorageConnectionDialog
          mode={modalState.mode}
          connection={modalState.connection}
          onClose={() => setModalState({ open: false, mode: 'add' })}
        />
      )}
    </>
  )
}

export interface StorageConnectionDialogProps {
  mode: 'add' | 'edit'
  connection?: StorageConnectionRes
  onClose: () => void
  onSuccess?: (connection: StorageConnectionRes) => void
}

export function StorageConnectionDialog({ mode, connection, onClose, onSuccess }: StorageConnectionDialogProps) {
  const _ = useTranslation()
  const createMutation = useCreateStorageConnection()
  const updateMutation = useUpdateStorageConnection()
  const directTestMutation = useTestDirectStorageConnection()
  const byIdTestMutation = useTestStorageConnection()

  const [name, setName] = useState(connection?.name || '')
  const [provider, setProvider] = useState<'webdav' | 's3'>(connection?.provider || 'webdav')
  const [endpoint, setEndpoint] = useState(connection?.endpoint || '')
  const [username, setUsername] = useState(connection?.username || '')
  const [password, setPassword] = useState('')
  const [basePath, setBasePath] = useState(connection?.basePath || '')
  const [region, setRegion] = useState(connection?.region || '')
  const [bucket, setBucket] = useState(connection?.bucket || '')
  const [testLatency, setTestLatency] = useState<number | null>(null)
  const providerMenu = useContextMenu()
  const providerAnchor = providerMenu.btnRef.current?.getBoundingClientRect()
  const providerPosition = useMemo(
    () => (providerMenu.open && providerAnchor ? computeDropdownPosition(providerAnchor, 200, 110) : null),
    [providerMenu.open, providerAnchor],
  )

  const isSaving = createMutation.isPending || updateMutation.isPending
  const isTesting = directTestMutation.isPending || byIdTestMutation.isPending
  const isS3 = provider === 's3'

  // Editing the connection the storage backend is actively using takes
  // effect immediately on save — nudge toward testing when credentials changed.
  const backendConfig = useStorageBackendConfig({
    enabled: mode === 'edit' && !!connection,
  }).data?.data
  const credsChanged =
    endpoint.trim() !== (connection?.endpoint || '') ||
    username.trim() !== (connection?.username || '') ||
    password !== '' ||
    (basePath.trim() || '/') !== (connection?.basePath || '/') ||
    (isS3 && (region.trim() !== (connection?.region || '') || bucket.trim() !== (connection?.bucket || '')))
  const canSubmit = endpoint.trim() !== '' && username.trim() !== '' && (!isS3 || bucket.trim() !== '') && !isSaving
  const showActiveBackendHint =
    mode === 'edit' &&
    !!connection &&
    !!backendConfig?.enabled &&
    backendConfig.connectionId === connection.id &&
    credsChanged

  async function handleTest() {
    setTestLatency(null)
    try {
      // Edit mode tests against the stored connection: blank password falls
      // back to the saved secret server-side, so testing no longer forces
      // re-entering it. Add mode has nothing stored, test the raw fields.
      const s3Override = isS3
        ? { region: region.trim(), bucket: bucket.trim() }
        : {}
      const res = mode === 'edit' && connection
        ? await byIdTestMutation.mutateAsync({
          id: connection.id,
          body: {
            endpoint: endpoint.trim(),
            username: username.trim(),
            ...(password ? { password } : {}),
            basePath: basePath.trim() || '/',
            ...s3Override,
          },
        })
        : await directTestMutation.mutateAsync({
          provider,
          endpoint: endpoint.trim(),
          username: username.trim(),
          password: password ? password : undefined,
          basePath: basePath.trim() || '/',
          ...s3Override,
        })
      const latency = res.data.latencyMs
      setTestLatency(latency)
      notify.success({
        key: 'settings.storageConnectionsTestSuccess',
        params: { name: name.trim() || (_('settings.storageConnectionsDefaultName') || '我的存储'), latency },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      notify.error({
        key: 'settings.storageConnectionsTestFailed',
        params: { message: msg },
      })
    }
  }

  async function handleSave(event?: React.FormEvent) {
    if (event) event.preventDefault()
    setTestLatency(null)
    const effectiveName = name.trim() || (_('settings.storageConnectionsDefaultName') || '我的存储')
    const effectiveBasePath = basePath.trim() || '/'
    try {
      if (mode === 'add') {
        const res = await createMutation.mutateAsync({
          name: effectiveName,
          provider,
          endpoint: endpoint.trim(),
          username: username.trim(),
          password: password ? password : undefined,
          basePath: effectiveBasePath,
          ...(isS3 ? { region: region.trim(), bucket: bucket.trim() } : {}),
        })
        if (res?.data) onSuccess?.(res.data)
      } else if (connection) {
        await updateMutation.mutateAsync({
          id: connection.id,
          body: {
            name: effectiveName,
            endpoint: endpoint.trim(),
            username: username.trim(),
            password: password ? password : undefined,
            basePath: effectiveBasePath,
            ...(isS3 ? { region: region.trim(), bucket: bucket.trim() } : {}),
          },
        })
      }
      notify.success({ key: 'settings.storageConnectionsSaved' })
      onClose()
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'settings.storageConnectionsSaveFailed'))
    }
  }

  return (
    <Modal
      title={
        mode === 'add'
          ? _('settings.storageConnectionsAdd') || '添加存储'
          : _('settings.storageConnectionsEdit') || '编辑存储'
      }
      onClose={onClose}
      size="default"
    >
      <form onSubmit={handleSave} className={settingsFormClass}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-5">
          <SettingsFormField label={_('settings.storageConnectionsName') || '显示名称'} required className="sm:col-span-3">
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={settingsInputClass}
              disabled={isSaving}
            />
          </SettingsFormField>

          {mode === 'add' ? (
            <SettingsFormField label={_('settings.storageConnectionsProvider') || '存储类型'} required className="sm:col-span-2" as="div">
              <button
                ref={providerMenu.btnRef}
                type="button"
                onClick={providerMenu.toggleFromButton}
                aria-haspopup="listbox"
                aria-expanded={providerMenu.open}
                disabled={isSaving}
                className={cn(settingsInputClass, 'flex items-center justify-between gap-2', providerMenu.open && 'border-stone-400 dark:border-stone-500')}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0" title={PROVIDER_MARK[provider].label}>
                    {PROVIDER_MARK[provider].badge}
                  </span>
                  <span className="truncate">
                    {provider === 's3'
                      ? (_('settings.storageConnectionsProviderS3') || 'S3 Compatible')
                      : (_('settings.storageConnectionsProviderWebdav') || 'WebDAV')}
                  </span>
                </span>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={cn('shrink-0 text-stone-400 transition-transform dark:text-stone-500', providerMenu.open && 'rotate-180')}
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              {providerMenu.open && (
                <SmartMenu
                  triggerRef={providerMenu.btnRef}
                  innerRef={providerMenu.menuRef}
                  position={providerPosition}
                  onClose={providerMenu.close}
                  width={200}
                  className="!z-[60]"
                >
                  <div className="py-1">
                    {(['webdav', 's3'] as const).map((id) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          setProvider(id)
                          setTestLatency(null)
                          providerMenu.close()
                        }}
                        className={cn(
                          'flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer',
                          provider === id
                            ? 'bg-stone-100 font-medium text-stone-900 dark:bg-stone-800 dark:text-stone-100'
                            : 'text-stone-600 hover:bg-stone-100/70 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800/70 dark:hover:text-stone-100',
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="shrink-0" title={PROVIDER_MARK[id].label}>
                            {PROVIDER_MARK[id].badge}
                          </span>
                          <span className="truncate">
                            {id === 's3'
                              ? (_('settings.storageConnectionsProviderS3') || 'S3 Compatible')
                              : (_('settings.storageConnectionsProviderWebdav') || 'WebDAV')}
                          </span>
                        </span>
                        {provider === id && (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-600 dark:text-stone-300">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                </SmartMenu>
              )}
            </SettingsFormField>
          ) : (
            <SettingsFormField label={_('settings.storageConnectionsProvider') || '存储类型'} className="sm:col-span-2">
              <input
                type="text"
                value={isS3 ? (_('settings.storageConnectionsProviderS3') || 'S3 Compatible') : (_('settings.storageConnectionsProviderWebdav') || 'WebDAV')}
                className={settingsInputClass}
                disabled
                readOnly
              />
            </SettingsFormField>
          )}
        </div>

        <SettingsFormField label={isS3 ? (_('settings.storageConnectionsEndpoint') || 'Endpoint URL') : (_('settings.webdavUrl') || 'WebDAV 地址')} required>
          <div className="relative">
            <input
              type="url"
              value={endpoint}
              onChange={(e) => {
                setEndpoint(e.target.value)
                setTestLatency(null)
              }}
              placeholder={isS3 ? 'https://s3.amazonaws.com' : 'http:// 或 https://...'}
              className={cn(settingsInputClass, testLatency !== null ? 'pr-20' : 'pr-9')}
              disabled={isSaving}
            />
            <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
              {testLatency !== null && (
                <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                  {testLatency}ms
                </span>
              )}
              <button
                type="button"
                onClick={handleTest}
                disabled={!canSubmit || isTesting}
                aria-label={isTesting ? (_('settings.webdavTesting') || '测试中...') : (_('settings.webdavTest') || '测试连接')}
                title={isTesting ? (_('settings.webdavTesting') || '测试中...') : (_('settings.webdavTest') || '测试连接')}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"
              >
                <AiModelIcon kind="test" className={isTesting ? 'h-4 w-4 animate-pulse' : 'h-4 w-4'} />
              </button>
            </div>
          </div>
        </SettingsFormField>

        {isS3 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SettingsFormField label={_('settings.storageConnectionsRegion') || 'Region'}>
              <input
                type="text"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder="us-east-1"
                className={settingsInputClass}
                disabled={isSaving}
              />
            </SettingsFormField>

            <SettingsFormField label={_('settings.storageConnectionsBucket') || 'Bucket'} required>
              <input
                type="text"
                value={bucket}
                onChange={(e) => setBucket(e.target.value)}
                placeholder="my-bucket"
                className={settingsInputClass}
                disabled={isSaving}
              />
            </SettingsFormField>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SettingsFormField label={isS3 ? (_('settings.storageConnectionsAccessKey') || 'Access Key') : (_('settings.webdavUsername') || '用户名')} required>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              className={settingsInputClass}
              disabled={isSaving}
            />
          </SettingsFormField>

          <SettingsFormField label={isS3 ? (_('settings.storageConnectionsSecretKey') || 'Secret Key') : (_('settings.webdavPassword') || '密码')}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={connection?.hasSecrets ? '•••••••• (留空不修改)' : undefined}
              autoComplete="current-password"
              className={settingsInputClass}
              disabled={isSaving}
            />
          </SettingsFormField>
        </div>

        <SettingsFormField label={_('settings.webdavBasePath') || '起始路径'}>
          <input
            type="text"
            value={basePath}
            onChange={(e) => setBasePath(e.target.value)}
            placeholder="/"
            className={settingsInputClass}
            disabled={isSaving}
          />
        </SettingsFormField>

        {showActiveBackendHint && (
          <div className="rounded-xl border border-amber-200/80 bg-amber-50/60 p-3.5 dark:border-amber-900/50 dark:bg-amber-950/20">
            <div className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300">
              <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                <line x1="12" x2="12" y1="9" y2="13" />
                <line x1="12" x2="12.01" y1="17" y2="17" />
              </svg>
              <div>
                <div className="font-semibold">
                  {_('settings.storageConnectionActiveHintTitle') || '正在使用的存储连接'}
                </div>
                <div className="mt-0.5 text-xs leading-relaxed text-amber-700 dark:text-amber-300/90">
                  {_('settings.storageConnectionActiveHintMsg') || '修改地址或账号后，建议先点地址栏右侧按钮测试连通性。'}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-stone-100 pt-4 dark:border-stone-800">
          <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={isSaving}>
            {_('library.cancel') || '取消'}
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={!canSubmit}
          >
            {isSaving ? _('settings.storageConnectionsSaving') || '保存中...' : _('library.save') || '保存'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
