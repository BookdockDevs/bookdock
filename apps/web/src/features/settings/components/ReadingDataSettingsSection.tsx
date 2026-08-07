import { useTranslation } from '@/hooks/useTranslation'
import { useUiStore } from '@/stores/ui.store'
import { cn } from '@/lib/utils'

const TIMER_MODES = ['auto', 'manual', 'off'] as const
const GRACE_MINUTES = [1, 5, 10, 30] as const

const MODE_LABELS: Record<(typeof TIMER_MODES)[number], string> = {
  auto: 'settings.readingTimerModeAuto',
  manual: 'settings.readingTimerModeManual',
  off: 'settings.readingTimerModeOff',
}

const GRACE_LABELS: Record<(typeof GRACE_MINUTES)[number], string> = {
  1: 'settings.readingTimerGrace1',
  5: 'settings.readingTimerGrace5',
  10: 'settings.readingTimerGrace10',
  30: 'settings.readingTimerGrace30',
}

export default function ReadingDataSettingsSection() {
  const _ = useTranslation()
  const readingTimerMode = useUiStore((s) => s.readingTimerMode)
  const setReadingTimerMode = useUiStore((s) => s.setReadingTimerMode)
  const manualTimerGraceMinutes = useUiStore((s) => s.manualTimerGraceMinutes)
  const setManualTimerGraceMinutes = useUiStore((s) => s.setManualTimerGraceMinutes)

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <h2 className="mb-4 text-sm font-medium">{_('settings.readingData')}</h2>
      <div className="py-2">
        <p className="text-sm text-stone-700 dark:text-stone-200">{_('settings.readingTimerMode')}</p>
        <p className="mt-0.5 text-xs text-stone-400 dark:text-stone-500">{_('settings.readingTimerModeHint')}</p>
        <div className="mt-3 inline-flex items-center gap-0.5 rounded-lg bg-stone-100 p-0.5 dark:bg-stone-800" role="group" aria-label={_('settings.readingTimerMode')}>
          {TIMER_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={readingTimerMode === mode}
              onClick={() => setReadingTimerMode(mode)}
              className={cn(
                'flex h-7 items-center justify-center rounded-md px-3 text-xs font-medium transition-all',
                readingTimerMode === mode
                  ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-stone-100'
                  : 'text-stone-500 hover:text-stone-800 dark:hover:text-stone-200',
              )}
            >
              {_(MODE_LABELS[mode])}
            </button>
          ))}
        </div>
      </div>
      {readingTimerMode === 'manual' && (
        <div className="border-t border-stone-200 pt-4 dark:border-stone-800">
          <p className="text-sm text-stone-700 dark:text-stone-200">{_('settings.readingTimerGrace')}</p>
          <p className="mt-0.5 text-xs text-stone-400 dark:text-stone-500">{_('settings.readingTimerGraceHint')}</p>
          <div className="mt-3 inline-flex items-center gap-0.5 rounded-lg bg-stone-100 p-0.5 dark:bg-stone-800" role="group" aria-label={_('settings.readingTimerGrace')}>
            {GRACE_MINUTES.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={manualTimerGraceMinutes === m}
                onClick={() => setManualTimerGraceMinutes(m)}
                className={cn(
                  'flex h-7 items-center justify-center rounded-md px-3 text-xs font-medium transition-all',
                  manualTimerGraceMinutes === m
                    ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-stone-100'
                    : 'text-stone-500 hover:text-stone-800 dark:hover:text-stone-200',
                )}
              >
                {_(GRACE_LABELS[m])}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
