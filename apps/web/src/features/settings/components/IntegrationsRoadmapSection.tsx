import { useTranslation } from '@/hooks/useTranslation'

export default function IntegrationsRoadmapSection() {
  const _ = useTranslation()

  return (
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
            <span>{_('settings.cloudBackup')}</span>
          </div>
          <p className="mt-1 text-xs text-stone-400 dark:text-stone-500 leading-relaxed">
            {_('settings.cloudBackupDesc')}
          </p>
        </div>
      </div>
    </section>
  )
}
