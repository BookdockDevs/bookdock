import { useState } from 'react'

import Modal from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui.store'

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

export default function StatsSettingsButton() {
  const _ = useTranslation()
  const [open, setOpen] = useState(false)
  const readingTimerMode = useUiStore((s) => s.readingTimerMode)
  const setReadingTimerMode = useUiStore((s) => s.setReadingTimerMode)
  const manualTimerGraceMinutes = useUiStore((s) => s.manualTimerGraceMinutes)
  const setManualTimerGraceMinutes = useUiStore((s) => s.setManualTimerGraceMinutes)

  return (
    <>
      <button
        type="button"
        aria-label={_('stats.settings')}
        title={_('stats.settings')}
        onClick={() => setOpen(true)}
        className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-300"
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>

      {open && (
        <Modal title={_('stats.settings')} onClose={() => setOpen(false)} size="default">
          <div className="divide-y divide-stone-100 py-1 dark:divide-stone-800">
            {/* Reading Timer Mode */}
            <div className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 pr-4">
                <p className="text-sm font-medium text-stone-800 dark:text-stone-200">
                  {_('settings.readingTimerMode')}
                </p>
                <p className="mt-0.5 text-xs text-stone-400 dark:text-stone-500">
                  {_('settings.readingTimerModeHint')}
                </p>
              </div>
              <div
                className="inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-stone-100 p-0.5 dark:bg-stone-800"
                role="group"
                aria-label={_('settings.readingTimerMode')}
              >
                {TIMER_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={readingTimerMode === mode}
                    onClick={() => setReadingTimerMode(mode)}
                    className={cn(
                      'flex h-7 items-center justify-center rounded-md px-3 text-xs font-medium transition-all',
                      readingTimerMode === mode
                        ? 'bg-white text-stone-900 shadow-xs dark:bg-stone-700 dark:text-stone-100'
                        : 'text-stone-500 hover:text-stone-800 dark:hover:text-stone-200',
                    )}
                  >
                    {_(MODE_LABELS[mode])}
                  </button>
                ))}
              </div>
            </div>

            {/* Grace Minutes (if manual) */}
            {readingTimerMode === 'manual' && (
              <div className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 pr-4">
                  <p className="text-sm font-medium text-stone-800 dark:text-stone-200">
                    {_('settings.readingTimerGrace')}
                  </p>
                  <p className="mt-0.5 text-xs text-stone-400 dark:text-stone-500">
                    {_('settings.readingTimerGraceHint')}
                  </p>
                </div>
                <div
                  className="inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-stone-100 p-0.5 dark:bg-stone-800"
                  role="group"
                  aria-label={_('settings.readingTimerGrace')}
                >
                  {GRACE_MINUTES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={manualTimerGraceMinutes === m}
                      onClick={() => setManualTimerGraceMinutes(m)}
                      className={cn(
                        'flex h-7 items-center justify-center rounded-md px-3 text-xs font-medium transition-all',
                        manualTimerGraceMinutes === m
                          ? 'bg-white text-stone-900 shadow-xs dark:bg-stone-700 dark:text-stone-100'
                          : 'text-stone-500 hover:text-stone-800 dark:hover:text-stone-200',
                      )}
                    >
                      {_(GRACE_LABELS[m])}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  )
}
