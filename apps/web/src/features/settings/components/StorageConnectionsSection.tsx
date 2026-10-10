import { useState } from 'react'
import type { ReactNode } from 'react'
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
import Modal from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { cn } from '@/lib/utils'

import AiModelIcon from './AiModelIcon'
import SettingsCard from './SettingsCard'
import SettingsEmptyState from '@/components/ui/SettingsEmptyState'
import SettingsFormField from './SettingsFormField'
import { settingsFormClass, settingsInputClass } from './settingsForm'

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

// Row mark per storage provider, mirroring how file managers badge each
// service (DAV / 115 / Alist …). Only webdav exists today; adding a type
// means adding one entry here, row structure stays untouched. Brand marks
// with their own colors can additionally override the tile background.
const PROVIDER_MARK: Record<string, { label: string; mark: ReactNode }> = {
  webdav: {
    label: 'WebDAV',
    mark: (
      // Italic glyphs lean right, so nudge 1px left for optical centering.
      <span className="-translate-x-px text-[10px] font-black italic leading-none tracking-tighter text-stone-700 dark:text-stone-200">
        DAV
      </span>
    ),
  },
}

interface EditModalState {
  open: boolean
  mode: 'add' | 'edit'
  connection?: StorageConnectionRes
}

export default function StorageConnectionsSection() {
  const _ = useTranslation()
  const { data: connectionsRes, isLoading } = useStorageConnections()
  const connections = connectionsRes?.data ?? []

  const deleteMutation = useDeleteStorageConnection()
  const testMutation = useTestStorageConnection()

  const [modalState, setModalState] = useState<EditModalState>({ open: false, mode: 'add' })
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; latencyMs?: number; message?: string }>>({})

  function handleOpenAdd() {
    setModalState({ open: true, mode: 'add' })
  }

  function handleOpenEdit(conn: StorageConnectionRes) {
    setModalState({ open: true, mode: 'edit', connection: conn })
  }

  async function handleDelete(conn: StorageConnectionRes) {
    if (!window.confirm(_('settings.storageConnectionsDeleteConfirm') || `确定要删除存储连接「${conn.name}」吗？`)) {
      return
    }
    try {
      await deleteMutation.mutateAsync(conn.id)
      notify.success({ key: 'settings.storageConnectionsDeleteSuccess' })
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'settings.storageConnectionsDeleteFailed'))
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
        description={_('settings.storageConnectionsDesc') || '连接外部存储，直接浏览并批量导入图书。'}
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
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400"
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
                    <p className="truncate text-xs font-mono text-stone-400 dark:text-stone-500" title={conn.endpoint}>
                      {conn.endpoint}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                    <button
                      type="button"
                      onClick={() => void handleTest(conn)}
                      disabled={isTesting}
                      aria-label={isTesting ? (_('settings.webdavTesting') || '测试中...') : (_('settings.storageConnectionsTest') || '测试连接')}
                      title={isTesting ? (_('settings.webdavTesting') || '测试中...') : (_('settings.storageConnectionsTest') || '测试连接')}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-blue-50 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-stone-800 dark:hover:text-blue-300"
                    >
                      <AiModelIcon kind="test" className={isTesting ? 'h-4 w-4 animate-pulse' : 'h-4 w-4'} />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenEdit(conn)}
                      aria-label={_('settings.storageConnectionsEdit') || '编辑'}
                      title={_('settings.storageConnectionsEdit') || '编辑'}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                    >
                      <EditIcon />
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleDelete(conn)}
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
  const [endpoint, setEndpoint] = useState(connection?.endpoint || '')
  const [username, setUsername] = useState(connection?.username || '')
  const [password, setPassword] = useState('')
  const [basePath, setBasePath] = useState(connection?.basePath || '')
  const [testLatency, setTestLatency] = useState<number | null>(null)

  const isSaving = createMutation.isPending || updateMutation.isPending
  const isTesting = directTestMutation.isPending || byIdTestMutation.isPending

  // Editing the connection the storage backend is actively using takes
  // effect immediately on save — nudge toward testing when credentials changed.
  const backendConfig = useStorageBackendConfig({
    enabled: mode === 'edit' && !!connection,
  }).data?.data
  const credsChanged =
    endpoint.trim() !== (connection?.endpoint || '') ||
    username.trim() !== (connection?.username || '') ||
    password !== '' ||
    (basePath.trim() || '/') !== (connection?.basePath || '/')
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
      const res = mode === 'edit' && connection
        ? await byIdTestMutation.mutateAsync({
          id: connection.id,
          body: {
            endpoint: endpoint.trim(),
            username: username.trim(),
            ...(password ? { password } : {}),
            basePath: basePath.trim() || '/',
          },
        })
        : await directTestMutation.mutateAsync({
          endpoint: endpoint.trim(),
          username: username.trim(),
          password: password ? password : undefined,
          basePath: basePath.trim() || '/',
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
          provider: 'webdav',
          endpoint: endpoint.trim(),
          username: username.trim(),
          password: password ? password : undefined,
          basePath: effectiveBasePath,
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
        <SettingsFormField label={_('settings.storageConnectionsName') || '显示名称'} required>
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={_('settings.storageConnectionsDefaultName') || '我的存储'}
            className={settingsInputClass}
            disabled={isSaving}
          />
        </SettingsFormField>

        <SettingsFormField label={_('settings.webdavUrl') || 'WebDAV 地址'} required>
          <div className="relative">
            <input
              type="url"
              value={endpoint}
              onChange={(e) => {
                setEndpoint(e.target.value)
                setTestLatency(null)
              }}
              placeholder="http:// 或 https://..."
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
                disabled={!endpoint.trim() || !username.trim() || isTesting || isSaving}
                aria-label={isTesting ? (_('settings.webdavTesting') || '测试中...') : (_('settings.webdavTest') || '测试连接')}
                title={isTesting ? (_('settings.webdavTesting') || '测试中...') : (_('settings.webdavTest') || '测试连接')}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"
              >
                <AiModelIcon kind="test" className={isTesting ? 'h-4 w-4 animate-pulse' : 'h-4 w-4'} />
              </button>
            </div>
          </div>
        </SettingsFormField>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SettingsFormField label={_('settings.webdavUsername') || '用户名'} required>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              className={settingsInputClass}
              disabled={isSaving}
            />
          </SettingsFormField>

          <SettingsFormField label={_('settings.webdavPassword') || '密码'}>
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
            disabled={!endpoint.trim() || !username.trim() || isSaving}
          >
            {isSaving ? _('settings.storageConnectionsSaving') || '保存中...' : _('library.save') || '保存'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
