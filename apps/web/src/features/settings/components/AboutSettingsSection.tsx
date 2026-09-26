import { useState } from 'react'

import { useCancelSystemUpdate, useStartSystemUpdate, useSystemInfo, useSystemUpdateCheck, useSystemUpdateStatus } from '@/api/hooks/useSystem'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { useAuthStore } from '@/stores/auth.store'

import SystemUpdateDialog from './SystemUpdateDialog'

function BookdockBrandIcon({ className }: { className?: string }) {
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
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z" />
      <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
    </svg>
  )
}

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  )
}

function TagIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  )
}

function CheckIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

export default function AboutSettingsSection() {
  const _ = useTranslation()
  const { data, isPending, isError, isFetching, refetch } = useSystemInfo()
  const updateCheck = useSystemUpdateCheck()
  const user = useAuthStore((s) => s.user)
  const [updateTarget, setUpdateTarget] = useState<string | null>(null)
  const [updateStartedAt, setUpdateStartedAt] = useState(0)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [copiedVersion, setCopiedVersion] = useState(false)
  const [copiedDiagnostics, setCopiedDiagnostics] = useState(false)
  const updateStatus = useSystemUpdateStatus()
  const startUpdate = useStartSystemUpdate()
  const cancelUpdate = useCancelSystemUpdate()

  const info = data?.data
  const update = updateCheck.data?.data
  const appName = _('app.name')

  const status = updateStatus.data?.data
  const latestVersion = update?.latestVersion
  const taskTarget = updateTarget ?? status?.targetVersion ?? latestVersion
  const updateActive = status?.outcome === 'active'
  const startError = startUpdate.isError ? getUserErrorNotification(startUpdate.error) : null

  const handleOpenUpdateDialog = () => {
    startUpdate.reset()
    setIsModalOpen(true)
  }

  const handleStartUpdate = (overrideTarget?: string) => {
    const target = overrideTarget ?? taskTarget
    if (!target) return
    startUpdate.mutate(
      { targetVersion: target, progressId: `update-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` },
      {
        onSuccess: () => {
          setUpdateTarget(target)
          setUpdateStartedAt(Date.now())
        },
      },
    )
  }

  const handleRetryUpdate = () => {
    startUpdate.reset()
    // A newer release may have appeared since this job settled; replaying the
    // stale target is rejected server-side, so retry follows latest instead.
    const stale = status?.targetVersion && latestVersion && status.targetVersion !== latestVersion
    handleStartUpdate(stale ? latestVersion : undefined)
  }

  const handleCopyVersion = async () => {
    if (!info?.version) return
    try {
      await navigator.clipboard.writeText(info.version)
      setCopiedVersion(true)
      setTimeout(() => setCopiedVersion(false), 2000)
      notify.success(_('settings.aboutVersionCopied'))
    } catch {
      // Fallback silent ignore
    }
  }

  const handleCopyDiagnostics = async () => {
    const diagnostics = [
      '### Bookdock System Diagnostic',
      `- Version: ${info?.version ?? 'unknown'}`,
      `- User Agent: ${navigator.userAgent}`,
      `- Language: ${navigator.language}`,
      `- Viewport: ${window.innerWidth}x${window.innerHeight}`,
      `- User Role: ${user?.role ?? 'anonymous'}${user?.guest ? ' (guest)' : ''}`,
      `- Timestamp: ${new Date().toISOString()}`,
    ].join('\n')

    try {
      await navigator.clipboard.writeText(diagnostics)
      setCopiedDiagnostics(true)
      setTimeout(() => setCopiedDiagnostics(false), 2000)
      notify.success(_('settings.aboutDiagnosticsCopied'))
    } catch {
      // Fallback silent ignore
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-xs dark:border-stone-800 dark:bg-stone-900">
      {isPending ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="h-16 w-16 animate-pulse rounded-2xl bg-stone-100 dark:bg-stone-800" />
          <div className="mt-4 h-4 w-28 animate-pulse rounded-md bg-stone-100 dark:bg-stone-800" />
          <p className="mt-3 text-xs text-stone-400 dark:text-stone-500">{_('settings.aboutLoading')}</p>
        </div>
      ) : isError || !info ? (
        <div className="m-6 flex flex-col items-center justify-center rounded-xl bg-red-50/60 p-6 text-center text-xs text-red-700 dark:bg-red-950/20 dark:text-red-300">
          <p>{_('settings.aboutLoadFailed')}</p>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="mt-3 rounded-lg bg-red-100 px-3 py-1.5 font-medium transition-colors hover:bg-red-200 disabled:opacity-50 dark:bg-red-900/40 dark:hover:bg-red-900/60"
          >
            {isFetching ? _('settings.aboutLoading') : _('settings.aboutRetry')}
          </button>
        </div>
      ) : (
        <>
          {/* Brand Hero Header */}
          <div className="border-b border-stone-100 bg-gradient-to-b from-stone-50/70 via-white to-white px-6 pt-8 pb-7 text-center dark:border-stone-800/80 dark:from-stone-800/25 dark:via-stone-900 dark:to-stone-900">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-stone-900 to-stone-700 text-white shadow-md shadow-stone-900/10 ring-1 ring-black/5 dark:from-stone-800 dark:to-stone-900 dark:text-stone-100 dark:shadow-stone-950/50 dark:ring-white/10">
              <BookdockBrandIcon className="h-8 w-8" />
            </div>

            <h2 className="mt-3.5 font-serif text-2xl font-bold tracking-wider text-stone-900 dark:text-stone-100">
              {appName}
            </h2>

            <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-stone-500 dark:text-stone-400">
              {_('settings.aboutSubtitle')}
            </p>

            {/* Version Badge & Check Update Row */}
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => void handleCopyVersion()}
                title={_('settings.aboutCopyVersion')}
                className="inline-flex items-center gap-1.5 rounded-full border border-stone-200/90 bg-stone-50/90 px-3 py-1 font-mono text-xs font-medium text-stone-700 transition-colors hover:border-stone-300 hover:bg-stone-100 active:scale-95 dark:border-stone-700/80 dark:bg-stone-800/90 dark:text-stone-300 dark:hover:border-stone-600 dark:hover:bg-stone-700"
              >
                {copiedVersion ? (
                  <>
                    <CheckIcon className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                    <span>{_('copied')}</span>
                  </>
                ) : (
                  <span>v{info.version.replace(/^v/, '')}</span>
                )}
              </button>

              <button
                type="button"
                onClick={() => void updateCheck.refetch()}
                disabled={updateCheck.isFetching}
                className="inline-flex items-center gap-1.5 rounded-full border border-stone-200/80 bg-white px-3 py-1 text-xs font-medium text-stone-600 shadow-2xs transition-all hover:bg-stone-50 hover:text-stone-900 active:scale-95 disabled:cursor-wait disabled:opacity-60 dark:border-stone-700/80 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700 dark:hover:text-stone-100"
              >
                {updateCheck.isFetching ? (
                  <svg className="h-3 w-3 animate-spin text-stone-500" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 text-stone-400">
                    <path d="M21 2v6h-6" />
                    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                    <path d="M3 22v-6h6" />
                    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                  </svg>
                )}
                <span>{updateCheck.isFetching ? _('settings.aboutCheckingUpdate') : _('settings.aboutCheckUpdate')}</span>
              </button>
            </div>

            {/* Update Check Feedback */}
            {update && (
              <div className="mt-4 flex justify-center">
                {update.status === 'up-to-date' && (
                  <div className="inline-flex items-center gap-1.5 rounded-full bg-stone-100/80 px-3 py-1 text-xs font-medium text-stone-600 ring-1 ring-stone-200/60 dark:bg-stone-800/80 dark:text-stone-300 dark:ring-stone-700/60">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    <span>{_('settings.aboutUpToDate')}</span>
                  </div>
                )}
                {update.status === 'unavailable' && (
                  <div className="flex max-w-lg flex-col items-start gap-1 rounded-xl bg-amber-50/80 px-3 py-2 text-left text-xs font-medium text-amber-700 ring-1 ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-500/20">
                    <span>{_('settings.aboutUpdateUnavailable')}</span>
                    {update.failureReason && <span className="text-[11px] font-normal leading-5 opacity-85">{update.failureReason}</span>}
                  </div>
                )}
                {update.status === 'update-available' && (
                  <div className="flex w-full max-w-md flex-col items-center gap-2.5 rounded-2xl border border-stone-200/90 bg-stone-50/80 p-3.5 text-xs text-stone-800 shadow-2xs dark:border-stone-800 dark:bg-stone-800/40 dark:text-stone-200">
                    <div className="flex w-full flex-col items-center justify-between gap-2.5 sm:flex-row">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="relative flex h-2 w-2 shrink-0">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
                        </span>
                        <div className="min-w-0 text-left">
                          <div className="flex items-center gap-1 font-medium text-stone-900 dark:text-stone-100">
                            <span>{_('settings.aboutUpdateAvailable', { version: (update.latestVersion ?? '').replace(/^v/, '') })}</span>
                          </div>
                          {update.publishedAt && (
                            <p className="text-[11px] text-stone-400 dark:text-stone-500">
                              {new Date(update.publishedAt).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5">
                        {!status?.outcome ? (
                          <button
                            type="button"
                            onClick={handleOpenUpdateDialog}
                            disabled={startUpdate.isPending}
                            className="inline-flex items-center rounded-lg bg-stone-900 px-3 py-1.5 font-medium text-white shadow-2xs transition-all hover:bg-stone-800 active:scale-95 disabled:opacity-60 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
                          >
                            <span>{startUpdate.isPending ? _('settings.aboutUpdateStarting') : updateActive ? _('settings.aboutUpdateViewProgress') : _('settings.aboutUpdateNow')}</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setIsModalOpen(true)}
                            className="inline-flex items-center rounded-lg border border-stone-200/90 bg-white px-3 py-1.5 font-medium text-stone-700 shadow-2xs transition-all hover:bg-stone-50 active:scale-95 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
                          >
                            <span>{_('settings.aboutUpdateViewProgress')}</span>
                          </button>
                        )}
                        {update.releaseUrl && (
                          <a
                            href={update.releaseUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-lg border border-stone-200/90 bg-white px-2.5 py-1.5 font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 dark:border-stone-700/80 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700 dark:hover:text-stone-100"
                          >
                            <span>{_('settings.aboutOpenRelease')}</span>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                              <path d="M7 17l9.2-9.2M17 17V7H7" />
                            </svg>
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Resources & Links Group */}
          <div className="divide-y divide-stone-100 dark:divide-stone-800">
            <a
              href={info.repositoryUrl}
              target="_blank"
              rel="noreferrer"
              className="group flex items-center justify-between px-6 py-4 transition-colors hover:bg-stone-50/70 dark:hover:bg-stone-800/50"
            >
              <div className="flex items-center gap-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-stone-700 transition-colors group-hover:bg-stone-200/70 group-hover:text-stone-900 dark:bg-stone-800 dark:text-stone-300 dark:group-hover:bg-stone-700 dark:group-hover:text-stone-100">
                  <GitHubIcon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-xs font-medium text-stone-800 transition-colors group-hover:text-stone-900 dark:text-stone-200 dark:group-hover:text-stone-100">
                    {_('settings.aboutRepository')}
                  </h3>
                  <p className="mt-0.5 text-[11px] text-stone-400 dark:text-stone-500">
                    {_('settings.aboutRepositoryDesc')}
                  </p>
                </div>
              </div>
              <span className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-all group-hover:text-stone-700 dark:text-stone-500 dark:group-hover:text-stone-300">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5">
                  <path d="M7 17l9.2-9.2M17 17V7H7" />
                </svg>
              </span>
            </a>

            <a
              href={info.releasesUrl}
              target="_blank"
              rel="noreferrer"
              className="group flex items-center justify-between px-6 py-4 transition-colors hover:bg-stone-50/70 dark:hover:bg-stone-800/50"
            >
              <div className="flex items-center gap-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-stone-700 transition-colors group-hover:bg-stone-200/70 group-hover:text-stone-900 dark:bg-stone-800 dark:text-stone-300 dark:group-hover:bg-stone-700 dark:group-hover:text-stone-100">
                  <TagIcon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-xs font-medium text-stone-800 transition-colors group-hover:text-stone-900 dark:text-stone-200 dark:group-hover:text-stone-100">
                    {_('settings.aboutReleases')}
                  </h3>
                  <p className="mt-0.5 text-[11px] text-stone-400 dark:text-stone-500">
                    {_('settings.aboutReleasesDesc')}
                  </p>
                </div>
              </div>
              <span className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-all group-hover:text-stone-700 dark:text-stone-500 dark:group-hover:text-stone-300">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5">
                  <path d="M7 17l9.2-9.2M17 17V7H7" />
                </svg>
              </span>
            </a>
          </div>

          {/* Bottom Diagnostics & License Bar */}
          <div className="flex items-center justify-between border-t border-stone-100 bg-stone-50/60 px-6 py-3 text-xs dark:border-stone-800 dark:bg-stone-900/60">
            <span className="text-[11px] font-medium text-stone-400 dark:text-stone-500">
              {_('settings.aboutLicense')}
            </span>
            <button
              type="button"
              onClick={() => void handleCopyDiagnostics()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200/90 bg-white px-2.5 py-1 text-xs font-medium text-stone-600 shadow-2xs transition-all hover:bg-stone-50 hover:text-stone-900 active:scale-95 dark:border-stone-700/80 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700 dark:hover:text-stone-100"
            >
              {copiedDiagnostics ? (
                <CheckIcon className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-stone-400 dark:text-stone-400">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
              <span>{copiedDiagnostics ? _('copied') : _('settings.aboutCopyDiagnostics')}</span>
            </button>
          </div>

          <SystemUpdateDialog
            isOpen={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            currentVersion={info.version}
            targetVersion={taskTarget ?? ''}
            publishedAt={update?.publishedAt}
            status={status}
            statusUnavailable={updateStatus.isError}
            statusRefreshing={updateStatus.isFetching}
            isCancelling={cancelUpdate.isPending}
            cancelError={cancelUpdate.isError}
            isStarting={startUpdate.isPending}
            startErrorKey={startError?.key}
            updateStartedAt={updateStartedAt}
            onStartUpdate={handleStartUpdate}
            onRetry={handleRetryUpdate}
            onCancel={() => status?.progressId && cancelUpdate.mutate(status.progressId)}
          />
        </>
      )}
    </section>
  )
}
