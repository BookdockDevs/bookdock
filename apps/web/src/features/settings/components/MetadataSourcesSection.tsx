import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import type { MetadataConfiguration, MetadataProvider } from '@bookdock/shared'

import { apiGet, apiPost, apiPut } from '@/api/client'
import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import MetadataProviderIcon from '@/components/ui/MetadataProviderIcon'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'

import AiModelIcon from './AiModelIcon'
import SettingsCard from './SettingsCard'

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

export default function MetadataSourcesSection() {
  const _ = useTranslation()
  const queryClient = useQueryClient()
  const userId = useAuthStore((state) => state.user?.id)
  const queryKey = ['metadata-lookup', 'config', userId]
  const configuration = useQuery({
    queryKey,
    queryFn: () => apiGet<{ data: MetadataConfiguration }>('/integrations/metadata-lookup/config'),
  })

  const [open, setOpen] = useState<'googlebooks' | 'weread' | null>(null)
  const configured = open ? Boolean(configuration.data?.data[open]) : false
  const activeService = open ? INTEGRATION_SERVICES.find((s) => s.id === open) : null

  const [key, setKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)

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
            <div className="flex w-full items-center justify-between gap-2">
              <div>
                {configured && (
                  <button
                    type="button"
                    disabled={busy || testing}
                    onClick={() => void save(null)}
                    className="text-xs font-medium text-red-600 transition hover:text-red-700 disabled:opacity-50 dark:text-red-400 dark:hover:text-red-300"
                  >
                    {_('metadataLookup.deleteKey')}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  disabled={busy || testing}
                  onClick={handleClose}
                >
                  {_('metadataLookup.cancel')}
                </Button>
                <Button
                  disabled={busy || testing || !key.trim()}
                  onClick={() => void save(key.trim())}
                >
                  {_('metadataLookup.save')}
                </Button>
              </div>
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
    </>
  )
}
