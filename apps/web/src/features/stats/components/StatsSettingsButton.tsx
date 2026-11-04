import { useState } from 'react'

import Modal from '@/components/ui/Modal'
import Toggle from '@/components/ui/Toggle'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui.store'

import StatsModuleSortableList from './StatsModuleSortableList'

const GRACE_MINUTES = [1, 5, 10, 30] as const

const GRACE_LABELS: Record<(typeof GRACE_MINUTES)[number], string> = {
  1: 'settings.readingTimerGrace1',
  5: 'settings.readingTimerGrace5',
  10: 'settings.readingTimerGrace10',
  30: 'settings.readingTimerGrace30',
}

interface StatsSettingsButtonProps {
  bookId?: string
  onBookDeleted?: () => void
}

export default function StatsSettingsButton({ bookId: _bookId, onBookDeleted: _onBookDeleted }: StatsSettingsButtonProps = {}) {
  const _ = useTranslation()
  const [open, setOpen] = useState(false)
  const readingTimerMode = useUiStore((s) => s.readingTimerMode)
  const setReadingTimerMode = useUiStore((s) => s.setReadingTimerMode)
  const manualTimerGraceMinutes = useUiStore((s) => s.manualTimerGraceMinutes)
  const setManualTimerGraceMinutes = useUiStore((s) => s.setManualTimerGraceMinutes)

  const isAuto = readingTimerMode === 'auto' || readingTimerMode === 'both'
  const isManual = readingTimerMode === 'manual' || readingTimerMode === 'both'
  const titleText = _bookId ? _('stats.bookSettings') : _('stats.settings')

  function handleAutoChange(checked: boolean) {
    if (checked) {
      setReadingTimerMode(isManual ? 'both' : 'auto')
    } else {
      setReadingTimerMode(isManual ? 'manual' : 'off')
    }
  }

  function handleManualChange(checked: boolean) {
    if (checked) {
      setReadingTimerMode(isAuto ? 'both' : 'manual')
    } else {
      setReadingTimerMode(isAuto ? 'auto' : 'off')
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label={titleText}
        title={titleText}
        onClick={() => setOpen(true)}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-300 cursor-pointer"
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
        <Modal title={titleText} onClose={() => setOpen(false)} size="default" contentClassName="!pt-1 pb-4">
          <div className="flex flex-col gap-4">
            {/* 计时设置 */}
            <div className="divide-y divide-stone-100 dark:divide-stone-800">
              {/* 1. 自动记录阅读时长 */}
              <div className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0 pr-4">
                  <p className="text-sm font-medium text-stone-800 dark:text-stone-200">
                    {_('settings.readingTimerAuto')}
                  </p>
                  <p className="mt-0.5 text-xs text-stone-400 dark:text-stone-500">
                    {_('settings.readingTimerAutoHint')}
                  </p>
                </div>
                <Toggle
                  checked={isAuto}
                  onChange={handleAutoChange}
                  ariaLabel={_('settings.readingTimerAuto')}
                />
              </div>

              {/* 2. 显示手动计时按钮 */}
              <div className="py-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 pr-4">
                    <p className="text-sm font-medium text-stone-800 dark:text-stone-200">
                      {_('settings.readingTimerManual')}
                    </p>
                    <p className="mt-0.5 text-xs text-stone-400 dark:text-stone-500">
                      {_('settings.readingTimerManualHint')}
                    </p>
                  </div>
                  <Toggle
                    checked={isManual}
                    onChange={handleManualChange}
                    ariaLabel={_('settings.readingTimerManual')}
                  />
                </div>
              </div>

              {/* 3. 共享暂停宽限 */}
              {(isAuto || isManual) && (
                <div className="pt-2.5 pb-1">
                  <div className="flex flex-col gap-2 rounded-xl bg-stone-50/80 p-3 sm:flex-row sm:items-center sm:justify-between dark:bg-stone-800/60">
                    <div className="min-w-0 pr-2">
                      <p className="text-xs font-medium text-stone-700 dark:text-stone-300">
                        {_('settings.readingTimerGrace')}
                      </p>
                      <p className="mt-0.5 text-[11px] text-stone-400 dark:text-stone-500">
                        {_('settings.readingTimerGraceHint')}
                      </p>
                    </div>
                    <div
                      className="inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-stone-200/60 p-0.5 dark:bg-stone-800"
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
                            'flex h-6.5 items-center justify-center rounded-md px-2.5 text-xs font-medium transition-all cursor-pointer',
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
                </div>
              )}
            </div>

            {/* 模块显示与排序 (仅在总览页生效，放置在计时设置下方作为独立设置项) */}
            {!_bookId && (
              <div className="pt-3 border-t border-stone-100 dark:border-stone-800">
                <StatsModuleSortableList />
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  )
}
