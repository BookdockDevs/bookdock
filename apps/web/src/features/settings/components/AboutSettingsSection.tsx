import { useSystemInfo, useSystemUpdateCheck } from '@/api/hooks/useSystem'
import { useTranslation } from '@/hooks/useTranslation'
import { notify } from '@/lib/notifications'
import { useAuthStore } from '@/stores/auth.store'

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

export default function AboutSettingsSection() {
  const _ = useTranslation()
  const { data, isPending, isError, isFetching, refetch } = useSystemInfo()
  const updateCheck = useSystemUpdateCheck()
  const user = useAuthStore((s) => s.user)

  const info = data?.data
  const update = updateCheck.data?.data
  const appName = _('app.name')

  const handleCopyVersion = async () => {
    if (!info?.version) return
    try {
      await navigator.clipboard.writeText(info.version)
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
          <div className="border-b border-stone-100 bg-gradient-to-b from-stone-50/70 via-white to-white px-6 pt-8 pb-7 text-center dark:border-stone-800/80 dark:from-stone-850/40 dark:via-stone-900 dark:to-stone-900">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-stone-900 to-stone-700 text-white shadow-md shadow-stone-900/10 ring-1 ring-black/5 dark:from-stone-100 dark:to-stone-300 dark:text-stone-900 dark:shadow-stone-950/40 dark:ring-white/10">
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
                className="inline-flex items-center rounded-full border border-stone-200/90 bg-stone-50/90 px-3 py-1 font-mono text-xs font-medium text-stone-700 transition-colors hover:border-stone-300 hover:bg-stone-100 active:scale-95 dark:border-stone-700/80 dark:bg-stone-800/90 dark:text-stone-300 dark:hover:border-stone-600 dark:hover:bg-stone-750"
              >
                v{info.version}
              </button>

              <button
                type="button"
                onClick={() => void updateCheck.refetch()}
                disabled={updateCheck.isFetching}
                className="inline-flex items-center gap-1.5 rounded-full border border-stone-200/80 bg-white px-3 py-1 text-xs font-medium text-stone-600 shadow-2xs transition-all hover:bg-stone-50 hover:text-stone-900 active:scale-95 disabled:cursor-wait disabled:opacity-60 dark:border-stone-700/80 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-750 dark:hover:text-stone-100"
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
                  <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-500/20">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    <span>{_('settings.aboutUpToDate')}</span>
                  </div>
                )}
                {update.status === 'unavailable' && (
                  <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-500/20">
                    <span>{_('settings.aboutUpdateUnavailable')}</span>
                  </div>
                )}
                {update.status === 'update-available' && (
                  <div className="flex w-full max-w-md flex-col items-center justify-between gap-2.5 rounded-xl border border-blue-200/80 bg-blue-50/70 p-3 text-xs text-blue-900 sm:flex-row dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                      <span className="font-medium">
                        {_('settings.aboutUpdateAvailable', { version: update.latestVersion ?? '' })}
                        {update.publishedAt && (
                          <span className="ml-1 text-[11px] font-normal text-stone-500 dark:text-stone-400">
                            ({new Date(update.publishedAt).toLocaleDateString()})
                          </span>
                        )}
                      </span>
                    </div>
                    {update.releaseUrl && (
                      <a
                        href={update.releaseUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
                      >
                        <span>{_('settings.aboutOpenRelease')}</span>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                          <path d="M7 17l9.2-9.2M17 17V7H7" />
                        </svg>
                      </a>
                    )}
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
              className="group flex items-center justify-between px-6 py-4 transition-colors hover:bg-stone-50/70 dark:hover:bg-stone-850/40"
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
              className="group flex items-center justify-between px-6 py-4 transition-colors hover:bg-stone-50/70 dark:hover:bg-stone-850/40"
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
              className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200/90 bg-white px-2.5 py-1 text-xs font-medium text-stone-600 shadow-2xs transition-all hover:bg-stone-50 hover:text-stone-900 active:scale-95 dark:border-stone-700/80 dark:bg-stone-850 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-stone-400 dark:text-stone-400">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              <span>{_('settings.aboutCopyDiagnostics')}</span>
            </button>
          </div>
        </>
      )}
    </section>
  )
}

