import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import QRCode from 'qrcode'

import type { IntegrationsSettings, LegadoAccessKeyCreateRes, LegadoAccessKeyInfo, SettingsRes } from '@bookdock/shared'

import { apiGet, apiPost, apiPut } from '@/api/client'
import { Button } from '@/components/ui/Button'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Modal from '@/components/ui/Modal'
import QueryErrorState from '@/components/ui/QueryErrorState'
import Toggle from '@/components/ui/Toggle'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'

export default function LegadoSettingsSection() {
  const _ = useTranslation()
  const queryClient = useQueryClient()
  const [copied, setCopied] = useState(false)
  const [confirmRotateOpen, setConfirmRotateOpen] = useState(false)
  const [qrModalOpen, setQrModalOpen] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiGet<{ data: SettingsRes }>('/settings'),
  })

  const integrations = settingsQuery.data?.data.integrations
  const enabled = integrations?.legado?.enabled === true
  const authMode = integrations?.legado?.authMode === 'accessKey' ? 'accessKey' : 'login'
  const includeEpubMedia = integrations?.legado?.includeEpubMedia !== false

  const mutation = useMutation({
    mutationFn: (nextIntegrations: IntegrationsSettings) => apiPut('/settings', { integrations: nextIntegrations }),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: ['legado-access-key'] })
      await queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
    onError: (error) => notify.error(getUserErrorNotification(error, 'settings.integrationsUpdateFailed')),
  })

  const accessKeyQuery = useQuery({
    queryKey: ['legado-access-key'],
    queryFn: () => apiGet<{ data: LegadoAccessKeyInfo }>('/legado/access-key'),
    enabled: enabled && authMode === 'accessKey' && !mutation.isPending,
  })

  const rotateMutation = useMutation({
    mutationFn: () => apiPost<{ data: LegadoAccessKeyCreateRes }>('/legado/access-key', {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['legado-access-key'] })
      notify.success({ key: 'settings.legadoRotated' })
    },
    onError: (error) => notify.error(getUserErrorNotification(error, 'settings.integrationsUpdateFailed')),
  })

  const publicSourceUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/v1/legado/source.json` : ''
  const sourceUrl = authMode === 'accessKey' ? (accessKeyQuery.data?.data.sourceUrl ?? '') : publicSourceUrl
  const importHref = sourceUrl ? `legado://import/bookSource?src=${encodeURIComponent(sourceUrl)}` : ''
  const isMobile = typeof navigator !== 'undefined' && /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent)
  const isLoadingKey = authMode === 'accessKey' && accessKeyQuery.isLoading

  useEffect(() => {
    if (!sourceUrl || !qrModalOpen) return
    let active = true
    QRCode.toDataURL(sourceUrl, { width: 240, margin: 2 })
      .then((url) => {
        if (active) setQrDataUrl(url)
      })
      .catch(() => {
        if (active) setQrDataUrl(null)
      })
    return () => {
      active = false
    }
  }, [sourceUrl, qrModalOpen])

  if (settingsQuery.isError) {
    return <QueryErrorState className="py-4" isRetrying={settingsQuery.isFetching} onRetry={settingsQuery.refetch} />
  }

  if (settingsQuery.isLoading) {
    return (
      <div className="flex animate-pulse flex-col gap-3 py-4" aria-busy="true">
        <div className="h-5 w-40 rounded bg-stone-200/80 dark:bg-stone-800" />
        <div className="h-4 w-72 rounded bg-stone-100 dark:bg-stone-800/60" />
      </div>
    )
  }

  async function handleCopy() {
    if (!sourceUrl) return
    try {
      await navigator.clipboard.writeText(sourceUrl)
      setCopied(true)
      notify.success({ key: 'settings.legadoCopied' })
      setTimeout(() => setCopied(false), 2000)
    } catch {
      notify.error({ key: 'settings.integrationsUpdateFailed' })
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Legado Service Card */}
      <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6 dark:border-stone-800 dark:bg-stone-900">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#568FCC]/12 text-[#4478b2] dark:bg-[#568FCC]/20 dark:text-[#7eafe9]">
              <LegadoAppIcon className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">{_('settings.legado')}</h2>
              <p className="mt-1 text-xs leading-relaxed text-stone-500 text-pretty dark:text-stone-400">{_('settings.legadoDesc')}</p>
            </div>
          </div>
          <Toggle
            checked={enabled}
            disabled={mutation.isPending || rotateMutation.isPending}
            ariaLabel={_('settings.legadoEnabled')}
            onChange={(v) => mutation.mutate({ legado: { enabled: v } })}
          />
        </div>

        {enabled && (
          <div className="mt-2.5 space-y-3.5 border-t border-stone-100 pt-2.5 dark:border-stone-800">
            {/* Source URL Box & Action Buttons */}
            <div className="space-y-2.5">
              <label htmlFor="legado-source-url" className="text-xs font-medium text-stone-500 dark:text-stone-400">
                {_('settings.legadoSourceUrl')}
              </label>

              <div className="flex items-center gap-2">
                <div className="relative flex min-w-0 flex-1 items-center">
                  <input
                    id="legado-source-url"
                    type="text"
                    readOnly
                    value={sourceUrl}
                    aria-busy={isLoadingKey}
                    className="h-9 min-w-0 w-full rounded-xl border border-stone-200 bg-stone-50/60 px-3.5 text-xs font-mono text-stone-800 select-text outline-none transition-colors focus:border-stone-400 dark:border-stone-700 dark:bg-stone-800/50 dark:text-stone-200"
                  />
                  {isLoadingKey && (
                    <div className="pointer-events-none absolute inset-0 flex items-center gap-2 px-3.5 text-xs text-stone-400 dark:text-stone-500">
                      <svg
                        className="h-3.5 w-3.5 animate-spin text-stone-400 dark:text-stone-500"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        aria-hidden="true"
                      >
                        <path d="M12 3a9 9 0 1 0 9 9" />
                      </svg>
                      <span className="font-sans font-normal">
                        {_('settings.legadoLoadingKey')}
                      </span>
                    </div>
                  )}
                  {authMode === 'accessKey' && accessKeyQuery.isError && !isLoadingKey && (
                    <div className="pointer-events-none absolute inset-0 flex items-center gap-2 px-3.5 text-xs text-rose-500 dark:text-rose-400">
                      <span className="font-sans font-normal">
                        {_('settings.legadoLoadKeyFailed')}
                      </span>
                    </div>
                  )}
                </div>

                {authMode === 'accessKey' && (
                  <button
                    type="button"
                    onClick={() => setConfirmRotateOpen(true)}
                    disabled={rotateMutation.isPending || isLoadingKey}
                    aria-label={_('settings.legadoRotateKey')}
                    title={_('settings.legadoRotateKey')}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-stone-200/90 bg-white text-stone-600 shadow-xs transition-colors hover:bg-stone-50 hover:text-stone-900 active:scale-95 disabled:pointer-events-none disabled:opacity-40 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-750 dark:hover:text-stone-100"
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={rotateMutation.isPending ? 'animate-spin' : ''}
                    >
                      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                      <path d="M3 3v5h5" />
                      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                      <path d="M16 16h5v5" />
                    </svg>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  disabled={!sourceUrl}
                  aria-label={_('settings.legadoCopy')}
                  title={_('settings.legadoCopy')}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-stone-200/90 bg-white text-stone-600 shadow-xs transition-colors hover:bg-stone-50 hover:text-stone-900 active:scale-95 disabled:pointer-events-none disabled:opacity-40 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-750 dark:hover:text-stone-100"
                >
                  {copied ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                    </svg>
                  )}
                </button>

                {isMobile ? (
                  <a
                    href={importHref || undefined}
                    title={_('settings.legadoOneClickImportHint')}
                    aria-label={_('settings.legadoOneClickImport')}
                    aria-disabled={!sourceUrl}
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl shadow-xs transition-all ${
                      sourceUrl
                        ? 'bg-stone-900 text-white hover:bg-stone-800 active:scale-95 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200'
                        : 'pointer-events-none bg-stone-200 text-stone-400 dark:bg-stone-800 dark:text-stone-600'
                    }`}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => setQrModalOpen(true)}
                    disabled={!sourceUrl}
                    aria-label={_('settings.legadoQrCode')}
                    title={_('settings.legadoQrCode')}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-stone-200/90 bg-white text-stone-600 shadow-xs transition-colors hover:bg-stone-50 hover:text-stone-900 active:scale-95 disabled:pointer-events-none disabled:opacity-40 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-750 dark:hover:text-stone-100"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect width="5" height="5" x="3" y="3" rx="1" />
                      <rect width="5" height="5" x="16" y="3" rx="1" />
                      <rect width="5" height="5" x="3" y="16" rx="1" />
                      <path d="M21 16v5" />
                      <path d="M16 21h5" />
                      <path d="M12 7v3a2 2 0 0 1-2 2H7" />
                      <path d="M3 12h.01" />
                      <path d="M12 3h.01" />
                      <path d="M12 16v.01" />
                      <path d="M16 12h1" />
                      <path d="M21 12v.01" />
                      <path d="M12 21v-1" />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {/* Feature Switches Block - Consolidated into a single divided container */}
            <div className="rounded-xl border border-stone-200/80 bg-stone-50/50 divide-y divide-stone-200/60 dark:border-stone-800 dark:bg-stone-850/40 dark:divide-stone-800">
              {/* Sign-in-free Access Toggle */}
              <div className="flex items-center justify-between gap-4 p-3.5 sm:px-4">
                <div className="space-y-0.5">
                  <span className="text-sm font-medium text-stone-800 dark:text-stone-200">
                    {_('settings.legadoAccessModeKey')}
                  </span>
                  <p className="text-xs leading-relaxed text-stone-500 dark:text-stone-400">
                    {_('settings.legadoAccessModeKeyDesc')}
                  </p>
                </div>
                <Toggle
                  checked={authMode === 'accessKey'}
                  disabled={mutation.isPending || rotateMutation.isPending}
                  ariaLabel={_('settings.legadoAccessModeKey')}
                  onChange={(v) => mutation.mutate({ legado: { authMode: v ? 'accessKey' : 'login' } })}
                />
              </div>

              {/* EPUB Media Toggle */}
              <div className="flex items-center justify-between gap-4 p-3.5 sm:px-4">
                <div className="space-y-0.5">
                  <span className="text-sm font-medium text-stone-800 dark:text-stone-200">
                    {_('settings.legadoIncludeEpubMedia')}
                  </span>
                  <p className="text-xs leading-relaxed text-stone-500 dark:text-stone-400">
                    {_('settings.legadoIncludeEpubMediaDesc')}
                  </p>
                </div>
                <Toggle
                  checked={includeEpubMedia}
                  disabled={mutation.isPending}
                  ariaLabel={_('settings.legadoIncludeEpubMedia')}
                  onChange={(v) => mutation.mutate({ legado: { includeEpubMedia: v } })}
                />
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Confirm Regenerate Dialog */}
      {confirmRotateOpen && (
        <ConfirmDialog
          title={_('settings.legadoRotateConfirmTitle')}
          message={_('settings.legadoRotateConfirmMessage')}
          warning={_('settings.legadoRotateConfirmWarning')}
          confirmLabel={_('settings.legadoRotateConfirmAction')}
          confirmVariant="danger"
          confirmDisabled={rotateMutation.isPending}
          onConfirm={() => {
            rotateMutation.mutate()
            setConfirmRotateOpen(false)
          }}
          onClose={() => setConfirmRotateOpen(false)}
        />
      )}

      {/* QR Code Modal */}
      {qrModalOpen && (
        <Modal
          title={_('settings.legadoQrCodeModalTitle')}
          onClose={() => setQrModalOpen(false)}
          size="sm"
        >
          <div className="flex flex-col items-center gap-4 p-6 text-center">
            {qrDataUrl ? (
              <div className="rounded-2xl border border-stone-200/80 bg-white p-3 shadow-xs dark:border-stone-700">
                <img src={qrDataUrl} alt={_('settings.legadoQrCodeModalTitle')} className="h-48 w-48 object-contain" />
              </div>
            ) : (
              <div className="flex h-48 w-48 items-center justify-center rounded-2xl border border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900">
                <span className="text-xs text-stone-400">{_('settings.legadoGeneratingQr')}</span>
              </div>
            )}
            <div className="space-y-1 px-2 text-center text-balance">
              <p className="text-xs font-medium text-stone-800 dark:text-stone-200">
                {_('settings.legadoQrScanTip')}
              </p>
              <p className="text-xs leading-relaxed text-stone-500 dark:text-stone-400">
                {_('settings.legadoQrScanSubTip')}
              </p>
            </div>
            <div className="pt-1">
              <Button size="sm" variant="secondary" onClick={() => void handleCopy()} className="gap-1.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1 0-2 2-2h10c1.1 0 2 .9 2 2" />
                </svg>
                <span>{_('settings.legadoCopy')}</span>
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Roadmap & Future Integrations Preview */}
      <section className="rounded-2xl border border-dashed border-stone-200/80 bg-stone-50/40 p-4 sm:p-5 dark:border-stone-800/80 dark:bg-stone-900/30">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
              {_('settings.integrationsComingSoon')}
            </h3>
            <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
              {_('settings.integrationsComingSoonDesc')}
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-stone-200/60 bg-white/70 p-3 shadow-xs dark:border-stone-800/60 dark:bg-stone-900/50">
            <div className="flex items-center gap-2 text-xs font-medium text-stone-700 dark:text-stone-300">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-stone-400">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              <span>{_('settings.opds')}</span>
            </div>
            <p className="mt-1 text-xs text-stone-400 dark:text-stone-500 leading-relaxed">
              {_('settings.opdsDesc')}
            </p>
          </div>

          <div className="rounded-xl border border-stone-200/60 bg-white/70 p-3 shadow-xs dark:border-stone-800/60 dark:bg-stone-900/50">
            <div className="flex items-center gap-2 text-xs font-medium text-stone-700 dark:text-stone-300">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-stone-400">
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M16 16h5v5" />
              </svg>
              <span>{_('settings.koreaderSync')}</span>
            </div>
            <p className="mt-1 text-xs text-stone-400 dark:text-stone-500 leading-relaxed">
              {_('settings.koreaderSyncDesc')}
            </p>
          </div>

          <div className="rounded-xl border border-stone-200/60 bg-white/70 p-3 shadow-xs dark:border-stone-800/60 dark:bg-stone-900/50">
            <div className="flex items-center gap-2 text-xs font-medium text-stone-700 dark:text-stone-300">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-stone-400">
                <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
              </svg>
              <span>{_('settings.webdav')}</span>
            </div>
            <p className="mt-1 text-xs text-stone-400 dark:text-stone-500 leading-relaxed">
              {_('settings.webdavDesc')}
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}

function LegadoAppIcon({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="22 22 64 64" fill="currentColor" className={className} aria-hidden="true">
      {/* Outer head arc */}
      <path d="M55.659 79.068c-1.258 0-2.521-.094-3.753-.279-.773-.115-1.307-.838-1.19-1.611.117-.773.841-1.311 1.612-1.191 1.093.164 2.214.248 3.331.248 12.261 0 22.235-9.975 22.235-22.235 0-12.26-9.975-22.234-22.235-22.234-10.531 0-19.695 7.479-21.79 17.781-.155.768-.902 1.262-1.671 1.107-.767-.156-1.263-.904-1.106-1.672 2.361-11.618 12.693-20.051 24.567-20.051 13.823 0 25.069 11.246 25.069 25.068 0 13.822-11.247 25.068-25.07 25.068z" />
      {/* Eyes */}
      <circle cx="53.445" cy="48.757" r="3.5" />
      <circle cx="66.861" cy="48.757" r="3.5" />
      {/* Reading book in hands */}
      <path d="M30.986 53.461s-3.656-1.06-3.656 1.636c0 2.693 0 15.295 0 15.295s-.674 2.598 2.598 3.369c3.271.77 7.697 2.404 7.697 2.404s3.464.387 5.58-.479c2.116-.867 7.505-2.215 7.505-2.215s2.213-.383 2.213-3.656c0-3.271 0-14.24 0-14.24s-.771-3.366-4.233-1.922c-3.464 1.444-5.869 2.118-5.869 2.118s-4.33.48-6.157-.385c-1.826-.863-5.674-1.921-5.674-1.921zm8.772 20.547c-.783 0-1.418-.635-1.418-1.418v-12.5c0-.783.635-1.416 1.418-1.416s1.418.633 1.418 1.416v12.5c0 .783-.635 1.418-1.418 1.418z" />
    </svg>
  )
}
