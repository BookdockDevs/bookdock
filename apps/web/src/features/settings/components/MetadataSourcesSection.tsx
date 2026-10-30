import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { MetadataConfiguration, MetadataProvider, PersonalMetadataSourceView } from '@bookdock/shared'

import { apiDelete, apiGet, apiPost, apiPut, apiUpload } from '@/api/client'
import { Button } from '@/components/ui/Button'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Modal from '@/components/ui/Modal'
import MetadataProviderIcon from '@/components/ui/MetadataProviderIcon'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { cn, formatBytes } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'

import AiModelIcon from './AiModelIcon'
import SettingsCard from './SettingsCard'

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  )
}

function ZipIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect width="20" height="5" x="2" y="3" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
      <path d="M10 12h4" />
    </svg>
  )
}

interface IntegrationService {
  id: 'weread' | 'googlebooks'
  nameKey: string
  helpUrl: string
}

const INTEGRATION_SERVICES: IntegrationService[] = [
  {
    id: 'weread',
    nameKey: 'metadataLookup.weread',
    helpUrl: 'https://weread.qq.com/r/weread-skills',
  },
  {
    id: 'googlebooks',
    nameKey: 'Google Books',
    helpUrl: 'https://developers.google.com/books/docs/v1/using#APIKey',
  },
]

// Views of the custom sources card; the add entry offers types matching the
// active view. Only scrape sources exist today; migration sources land later.
const SOURCE_VIEWS = [
  { id: 'scrape', nameKey: 'metadataLookup.sourceViewScrape' },
] as const

type SourceViewId = (typeof SOURCE_VIEWS)[number]['id']

export default function MetadataSourcesSection() {
  const _ = useTranslation()
  const queryClient = useQueryClient()
  const userId = useAuthStore((state) => state.user?.id)
  const queryKey = ['metadata-lookup', 'config', userId]
  const configuration = useQuery({
    queryKey,
    queryFn: () => apiGet<{ data: MetadataConfiguration }>('/integrations/metadata-lookup/config'),
  })

  const sourcesQueryKey = ['personal-metadata-sources', userId]
  const sourcesQuery = useQuery({
    queryKey: sourcesQueryKey,
    queryFn: () => apiGet<{ data: PersonalMetadataSourceView[] }>('/integrations/personal-sources'),
  })
  const personalSources = Array.isArray(sourcesQuery.data?.data) ? sourcesQuery.data.data : []

  const [open, setOpen] = useState<'googlebooks' | 'weread' | null>(null)
  const activeService = open ? INTEGRATION_SERVICES.find((s) => s.id === open) : null

  const [key, setKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)

  const savedKey = (open ? configuration.data?.data?.keys?.[open] : '') ?? ''
  const trimmedKey = key.trim()
  const hasChanged = trimmedKey !== savedKey

  const [addOpen, setAddOpen] = useState(false)
  const [mode, setMode] = useState<'github' | 'zip'>('github')
  const [url, setUrl] = useState('')
  const [zipFile, setZipFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [installing, setInstalling] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<PersonalMetadataSourceView | null>(null)

  const [view, setView] = useState<SourceViewId>('scrape')
  const [viewMenuOpen, setViewMenuOpen] = useState(false)
  const viewMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!viewMenuOpen) return

    function handlePointerDown(event: PointerEvent) {
      if (viewMenuRef.current && !viewMenuRef.current.contains(event.target as Node)) {
        setViewMenuOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setViewMenuOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [viewMenuOpen])

  function openAddDialog() {
    setMode('github')
    setUrl('')
    setZipFile(null)
    setDragOver(false)
    setAddOpen(true)
  }

  function handleZipSelect(file: File | null | undefined) {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.zip')) {
      notify.error({ key: 'metadataLookup.sourceZipOnly' })
      return
    }
    setZipFile(file)
  }

  const deleteSource = useMutation({
    mutationFn: (sourceId: string) => apiDelete<{ data: { success: boolean } }>(`/integrations/personal-sources/${sourceId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sourcesQueryKey })
      setPendingDelete(null)
      notify.success({ key: 'metadataLookup.deleteSourceSuccess' })
    },
    onError: (err) => notify.error(getUserErrorNotification(err, 'metadataLookup.deleteSourceError')),
  })

  async function install() {
    if (installing || (mode === 'github' ? !url.trim() : !zipFile)) return
    setInstalling(true)
    try {
      if (mode === 'github') await apiPost('/integrations/personal-sources/install/github', { url: url.trim() })
      else await apiUpload('/integrations/personal-sources/install/zip', zipFile!)
      void queryClient.invalidateQueries({ queryKey: sourcesQueryKey })
      notify.success({ key: 'metadataLookup.installSuccess' })
      setAddOpen(false)
      setUrl('')
      setZipFile(null)
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'metadataLookup.installError'))
    } finally {
      setInstalling(false)
    }
  }

  function handleOpen(providerId: 'googlebooks' | 'weread') {
    const savedKey = configuration.data?.data?.keys?.[providerId] ?? ''
    setKey(savedKey)
    setShowKey(false)
    setOpen(providerId)
  }

  function handleClose() {
    if (!busy && !testing) {
      setOpen(null)
      setKey('')
      setShowKey(false)
    }
  }

  async function save(value: string | null) {
    setBusy(true)
    try {
      const result = await apiPut<{ data: MetadataConfiguration }>('/integrations/metadata-lookup/config', {
        provider: open,
        key: value,
      })
      queryClient.setQueryData(queryKey, result)
      setKey('')
      setShowKey(false)
      setOpen(null)
      notify.success({ key: value ? 'metadataLookup.saveSuccess' : 'metadataLookup.keyDeleted' })
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'metadataLookup.saveError'))
    } finally {
      setBusy(false)
    }
  }

  async function test() {
    if (!key.trim()) return
    setTesting(true)
    try {
      await apiPost('/integrations/metadata-lookup/test', {
        provider: open,
        key: key.trim(),
      })
      notify.success({
        key: 'metadataLookup.testSuccess',
        params: { name: resolveName(activeService?.nameKey ?? '') },
      })
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'metadataLookup.testFailure'))
    } finally {
      setTesting(false)
    }
  }

  function resolveName(nameKey: string) {
    return nameKey.startsWith('metadataLookup.') ? _(nameKey) : nameKey
  }

  return (
    <>
      <SettingsCard
        title={_('metadataLookup.settingsTitle')}
        description={_('metadataLookup.settingsDescription')}
        icon={
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="7" height="7" x="3" y="3" rx="1.5" />
            <rect width="7" height="7" x="14" y="3" rx="1.5" />
            <rect width="7" height="7" x="14" y="14" rx="1.5" />
            <rect width="7" height="7" x="3" y="14" rx="1.5" />
          </svg>
        }
        iconBgClass="bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400"
        bodyClassName="pt-1"
        action={
          <div className="flex shrink-0 items-center gap-2">
            {SOURCE_VIEWS.length > 1 && (
              <div ref={viewMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setViewMenuOpen((value) => !value)}
                  aria-haspopup="menu"
                  aria-expanded={viewMenuOpen}
                  aria-label={_('metadataLookup.viewSwitcher')}
                  className="inline-flex items-center gap-1 rounded-lg border border-stone-200 px-3 py-2 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
                >
                  <span>{resolveName(SOURCE_VIEWS.find((item) => item.id === view)!.nameKey)}</span>
                  <svg
                    width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    className={cn('shrink-0 text-stone-400 transition-transform duration-150', viewMenuOpen && 'rotate-180')}
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                {viewMenuOpen && (
                  <div role="menu" aria-label={_('metadataLookup.viewSwitcher')} className="absolute right-0 z-10 mt-2 w-max min-w-full overflow-hidden rounded-xl border border-stone-200 bg-white py-1 shadow-lg dark:border-stone-700 dark:bg-stone-900">
                    {SOURCE_VIEWS.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={view === item.id}
                        onClick={() => {
                          setView(item.id)
                          setViewMenuOpen(false)
                        }}
                        className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-left text-xs text-stone-700 transition-colors hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-800"
                      >
                        <span className="flex-1 truncate">{resolveName(item.nameKey)}</span>
                        {view === item.id && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-900 dark:text-stone-100">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={openAddDialog}
              className="gap-1.5"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14" />
                <path d="M12 5v14" />
              </svg>
              <span>{_('metadataLookup.addSource')}</span>
            </Button>
          </div>
        }
      >
        <div className="divide-y divide-stone-100 text-sm dark:divide-stone-800/80">
          {INTEGRATION_SERVICES.map((service) => {
            const isConfigured = Boolean(configuration.data?.data[service.id])

            return (
              <div key={service.id} className="flex items-center justify-between gap-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-stone-50 border border-stone-200/70 p-1 dark:border-stone-800 dark:bg-stone-800/60">
                    <MetadataProviderIcon provider={service.id as MetadataProvider} size={20} />
                  </div>
                  <span className="font-medium text-stone-900 dark:text-stone-100 truncate">
                    {resolveName(service.nameKey)}
                  </span>
                </div>

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleOpen(service.id)}
                  className="gap-1.5"
                >
                  <span
                    className={cn(
                      'size-1.5 rounded-full',
                      isConfigured ? 'bg-emerald-500' : 'bg-stone-300 dark:bg-stone-600'
                    )}
                  />
                  <span>{_(isConfigured ? 'metadataLookup.configured' : 'metadataLookup.notConfigured')}</span>
                </Button>
              </div>
            )
          })}

          {configuration.isError && !open && (
            <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50/60 p-3 text-xs text-red-600 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400">
              {_('metadataLookup.configError')}
            </div>
          )}

          {personalSources.map((source) => (
            <div key={source.sourceId} className="group flex items-center justify-between gap-4 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-stone-50 border border-stone-200/70 p-1 dark:border-stone-800 dark:bg-stone-800/60">
                  <MetadataProviderIcon provider={`personal:${source.sourceId}`} label={source.name} size={20} />
                </div>
                <span className="font-medium text-stone-900 dark:text-stone-100 truncate">
                  {source.name}
                </span>
              </div>
              <div className="flex shrink-0 items-center transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:has-[:focus-visible]:opacity-100">
                <button
                  type="button"
                  onClick={(e) => {
                    if (e.detail > 0) e.currentTarget.blur()
                    setPendingDelete(source)
                  }}
                  aria-label={_('metadataLookup.deleteSource')}
                  title={_('metadataLookup.deleteSource')}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      </SettingsCard>

      {open && activeService && (
        <Modal
          title={
            <div className="flex items-center gap-2.5">
              <MetadataProviderIcon provider={open} size={22} />
              <span>{resolveName(activeService.nameKey)}</span>
            </div>
          }
          onClose={handleClose}
          size="sm"
          footer={
            <div className="flex w-full items-center justify-end gap-2">
              <Button
                variant="secondary"
                disabled={busy || testing}
                onClick={handleClose}
              >
                {_('metadataLookup.cancel')}
              </Button>
              <Button
                disabled={busy || testing || !hasChanged}
                onClick={() => void save(trimmedKey || null)}
              >
                {_('metadataLookup.save')}
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between">
                <label className="block text-xs font-medium text-stone-700 dark:text-stone-300">
                  API Key
                </label>
                {activeService.helpUrl && (
                  <a
                    href={activeService.helpUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 hover:underline dark:text-blue-400"
                  >
                    <span>{_('metadataLookup.getKey')}</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                )}
              </div>
              <div className="relative mt-1.5">
                <input
                  type={showKey ? 'text' : 'password'}
                  autoComplete="off"
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                  className="w-full rounded-xl border border-stone-200 bg-stone-50/60 px-3 py-2 pr-16 text-sm text-stone-900 focus:border-stone-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-stone-400/10 dark:border-stone-700 dark:bg-stone-800/60 dark:text-stone-100 dark:focus:border-stone-500 dark:focus:bg-stone-900 dark:focus:ring-stone-500/20"
                />
                <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                    tabIndex={-1}
                    title={showKey ? '隐藏密钥' : '显示密钥'}
                  >
                    {showKey ? (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => void test()}
                    disabled={busy || testing || !key.trim()}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                    title={testing ? _('metadataLookup.statusTesting') : _('metadataLookup.test')}
                    aria-label={_('metadataLookup.test')}
                  >
                    <AiModelIcon
                      kind="test"
                      className={testing ? 'h-4 w-4 animate-pulse text-stone-700 dark:text-stone-200' : 'h-4 w-4'}
                    />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {addOpen && (
        <Modal
          title={_('metadataLookup.addSourceTitle')}
          onClose={() => { if (!installing) setAddOpen(false) }}
          size="idea"
          footer={
            <div className="flex w-full items-center justify-end gap-2">
              <Button variant="secondary" disabled={installing} onClick={() => setAddOpen(false)}>
                {_('metadataLookup.cancel')}
              </Button>
              <Button
                disabled={installing || (mode === 'github' ? !url.trim() : !zipFile)}
                onClick={() => void install()}
                className="gap-1.5"
              >
                {installing && (
                  <svg className="size-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                )}
                <span>{installing ? _('metadataLookup.installing') : _('metadataLookup.install')}</span>
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <div role="group" className="grid grid-cols-2 gap-1 rounded-xl bg-stone-100 p-1 dark:bg-stone-800/80">
              {(['github', 'zip'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={mode === item}
                  disabled={installing}
                  onClick={() => setMode(item)}
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-lg py-1.5 text-xs font-medium transition-all duration-150 disabled:opacity-50',
                    mode === item
                      ? 'bg-white text-stone-900 shadow-2xs dark:bg-stone-700 dark:text-stone-100'
                      : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200'
                  )}
                >
                  {item === 'github' ? <GitHubIcon className="size-3.5" /> : <ZipIcon className="size-3.5" />}
                  <span>{_(item === 'github' ? 'metadataLookup.sourceModeGitHub' : 'metadataLookup.sourceModeZip')}</span>
                </button>
              ))}
            </div>

            {mode === 'github' ? (
              <div className="space-y-2">
                <label className="block text-xs font-medium text-stone-700 dark:text-stone-300">
                  {_('metadataLookup.sourceUrlLabel')}
                </label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-stone-400">
                    <GitHubIcon className="size-4" />
                  </div>
                  <input
                    type="text"
                    value={url}
                    disabled={installing}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder={_('metadataLookup.sourceUrlPlaceholder')}
                    className="w-full rounded-xl border border-stone-200 bg-stone-50/60 pl-9 pr-8 py-2 text-sm text-stone-900 transition-colors focus:border-stone-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-stone-400/10 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-800/60 dark:text-stone-100 dark:focus:border-stone-500 dark:focus:bg-stone-900 dark:focus:ring-stone-500/20"
                    autoFocus
                  />
                  {url && !installing && (
                    <button
                      type="button"
                      onClick={() => setUrl('')}
                      className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-stone-400 transition-colors hover:text-stone-600 dark:hover:text-stone-200"
                      title={_('metadataLookup.clear')}
                      aria-label={_('metadataLookup.clear')}
                    >
                      <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="block text-xs font-medium text-stone-700 dark:text-stone-300">
                  {_('metadataLookup.sourceZipLabel')}
                </label>
                {zipFile ? (
                  <div className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-3.5 shadow-2xs dark:border-stone-700 dark:bg-stone-800/80">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 font-mono text-xs font-bold text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400">
                      ZIP
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-stone-900 dark:text-stone-100" title={zipFile.name}>
                        {zipFile.name}
                      </p>
                      <p className="mt-0.5 text-xs text-stone-400 dark:text-stone-500">
                        {formatBytes(zipFile.size)}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={installing}
                      onClick={() => setZipFile(null)}
                      className="shrink-0 rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600 disabled:opacity-40 dark:hover:bg-stone-700 dark:hover:text-stone-200"
                      title={_('metadataLookup.removeFile')}
                      aria-label={_('metadataLookup.removeFile')}
                    >
                      <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        fileInputRef.current?.click()
                      }
                    }}
                    onDragOver={(e) => {
                      e.preventDefault()
                      setDragOver(true)
                    }}
                    onDragLeave={(e) => {
                      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
                      setDragOver(false)
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      setDragOver(false)
                      handleZipSelect(e.dataTransfer.files?.[0])
                    }}
                    className={cn(
                      'group flex h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-4 text-center transition-all duration-150',
                      dragOver
                        ? 'border-stone-500 bg-stone-100/80 dark:border-stone-400 dark:bg-stone-800/60'
                        : 'border-stone-200 bg-stone-50/50 hover:border-stone-300 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800/20 dark:hover:border-stone-600 dark:hover:bg-stone-800/40'
                    )}
                  >
                    <div className="flex size-10 items-center justify-center rounded-xl bg-stone-100 text-stone-500 transition-transform duration-200 group-hover:scale-105 dark:bg-stone-800 dark:text-stone-400">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                    </div>
                    <p className="text-xs font-medium text-stone-700 dark:text-stone-200">
                      {_('metadataLookup.sourceDropHint')}
                    </p>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".zip,application/zip"
                  disabled={installing}
                  onChange={(event) => {
                    handleZipSelect(event.target.files?.[0])
                    event.target.value = ''
                  }}
                  className="sr-only"
                />
              </div>
            )}
          </div>
        </Modal>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={_('metadataLookup.deleteSourceConfirmTitle')}
          message={_('metadataLookup.deleteSourceConfirmMessage', { name: pendingDelete.name })}
          confirmLabel={_('metadataLookup.deleteSourceConfirmAction')}
          confirmVariant="danger"
          confirmDisabled={deleteSource.isPending}
          onConfirm={() => deleteSource.mutate(pendingDelete.sourceId)}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </>
  )
}
