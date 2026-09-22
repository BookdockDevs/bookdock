import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'

import type { UpdatePhase, UpdateStatusRes } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'
import { getErrorKeyByCode } from '@/lib/error-message'

export interface SystemUpdateDialogProps {
  isOpen: boolean
  onClose: () => void
  currentVersion: string
  targetVersion: string
  publishedAt?: string
  status?: UpdateStatusRes
  isStarting: boolean
  startErrorKey?: string | null
  updateStartedAt: number
  onStartUpdate: () => void
  onRetry: () => void
}

const UPDATE_PHASE_KEYS: Record<Exclude<UpdatePhase, 'idle' | 'failed'>, string> = {
  snapshot: 'settings.aboutUpdatePhaseSnapshot',
  download: 'settings.aboutUpdatePhaseDownload',
  verify: 'settings.aboutUpdatePhaseVerify',
  extract: 'settings.aboutUpdatePhaseExtract',
  promote: 'settings.aboutUpdatePhasePromote',
  restarting: 'settings.aboutUpdatePhaseRestarting',
}

const UPDATE_STALL_HINT_MS = 3 * 60 * 1000

type StepStatus = 'pending' | 'active' | 'completed'

function getStepStatuses(phase: UpdatePhase | undefined, isStarting: boolean, isApplied: boolean) {
  if (isApplied) {
    return {
      snapshot: 'completed',
      download: 'completed',
      extract: 'completed',
      restart: 'completed',
    } satisfies Record<string, StepStatus>
  }

  if (isStarting) {
    return {
      snapshot: 'active',
      download: 'pending',
      extract: 'pending',
      restart: 'pending',
    } satisfies Record<string, StepStatus>
  }

  if (!phase || phase === 'idle') {
    return {
      snapshot: 'pending',
      download: 'pending',
      extract: 'pending',
      restart: 'pending',
    } satisfies Record<string, StepStatus>
  }

  return {
    snapshot: phase === 'snapshot' ? 'active' : 'completed',
    download: phase === 'download' || phase === 'verify' ? 'active' : phase === 'snapshot' ? 'pending' : 'completed',
    extract:
      phase === 'extract' || phase === 'promote'
        ? 'active'
        : phase === 'restarting'
          ? 'completed'
          : 'pending',
    restart: phase === 'restarting' ? 'active' : 'pending',
  } satisfies Record<string, StepStatus>
}

export default function SystemUpdateDialog({
  isOpen,
  onClose,
  currentVersion,
  targetVersion,
  publishedAt,
  status,
  isStarting,
  startErrorKey,
  updateStartedAt,
  onStartUpdate,
  onRetry,
}: SystemUpdateDialogProps) {
  const _ = useTranslation()
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)

  const isUpdating = isStarting || (status !== undefined && status.phase !== 'idle' && status.phase !== 'failed')
  const isApplied = status?.phase === 'idle' && status.currentVersion === targetVersion
  const isReverted = status?.phase === 'idle' && status.currentVersion !== targetVersion
  const isFailed = status?.phase === 'failed'
  const isSettled = isApplied || isReverted || isFailed
  const hasStarted = isUpdating || isSettled

  const isStalled =
    !isSettled &&
    status?.phase === 'restarting' &&
    Date.now() - updateStartedAt > UPDATE_STALL_HINT_MS

  const stepStatuses = getStepStatuses(status?.phase, isStarting, isApplied)

  let activeMessage = ''
  if (startErrorKey) {
    activeMessage = _(startErrorKey)
  } else if (isApplied) {
    activeMessage = _('settings.aboutUpdateApplied', { version: targetVersion.replace(/^v/, '') })
  } else if (isReverted) {
    activeMessage = _('settings.aboutUpdateReverted', { version: (status?.currentVersion ?? currentVersion).replace(/^v/, '') })
  } else if (isFailed) {
    activeMessage = _(getErrorKeyByCode(status?.error?.code) ?? 'errors.updateFailed')
  } else if (status?.phase && status.phase in UPDATE_PHASE_KEYS) {
    activeMessage = _(UPDATE_PHASE_KEYS[status.phase as keyof typeof UPDATE_PHASE_KEYS])
  } else if (isStarting) {
    activeMessage = _('settings.aboutUpdateStarting')
  }

  // Keyboard navigation & Esc handling
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isUpdating) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isUpdating, onClose])

  if (!isOpen) return null

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-xs transition-opacity animate-in fade-in"
      onClick={() => {
        if (!isUpdating) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white p-6 shadow-2xl transition-all dark:border-stone-800 dark:bg-stone-900"
      >
        {/* Header Bar */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-stone-900 text-white shadow-xs dark:bg-stone-100 dark:text-stone-900">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z" />
                <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
              </svg>
            </div>
            <div>
              <h2 id={titleId} className="text-base font-semibold text-stone-900 dark:text-stone-100">
                {_('settings.aboutUpdateDialogTitle')}
              </h2>
              <div className="mt-1 flex items-center gap-2 text-xs">
                <span className="font-mono text-stone-500 dark:text-stone-400">v{currentVersion.replace(/^v/, '')}</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 text-stone-400">
                  <path d="M5 12h14" />
                  <path d="m12 5 7 7-7 7" />
                </svg>
                <span className="rounded-md bg-stone-100 px-1.5 py-0.5 font-mono font-semibold text-stone-800 dark:bg-stone-800 dark:text-stone-200">
                  v{targetVersion.replace(/^v/, '')}
                </span>
                {publishedAt && (
                  <span className="text-stone-400 dark:text-stone-500">
                    ({new Date(publishedAt).toLocaleDateString()})
                  </span>
                )}
              </div>
            </div>
          </div>

          {!isUpdating && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
              aria-label={_('settings.aboutUpdateClose')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        {/* Content Body */}
        <div className="mt-6 space-y-5">
          {hasStarted && !startErrorKey && (
            <div
              role={isFailed ? 'alert' : 'status'}
              className={`flex items-start gap-2.5 rounded-xl p-3.5 text-xs leading-relaxed ${
                isFailed
                  ? 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300'
                  : isReverted
                    ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200'
                    : isApplied
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                      : 'bg-stone-50 text-stone-700 dark:bg-stone-850/50 dark:text-stone-300'
              }`}
            >
              {isUpdating && (
                <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
              )}
              <span className="font-medium">{activeMessage}</span>
            </div>
          )}

          {/* Stepper Timeline */}
          {!startErrorKey && (
            <div className="rounded-xl border border-stone-200/90 bg-stone-50/70 p-4 dark:border-stone-800 dark:bg-stone-850/50">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <StepItem
                  step={1}
                  status={stepStatuses.snapshot}
                  title={_('settings.aboutUpdateStepSnapshot')}
                  desc={_('settings.aboutUpdateStepSnapshotDesc')}
                />
                <StepItem
                  step={2}
                  status={stepStatuses.download}
                  title={_('settings.aboutUpdateStepDownload')}
                  desc={_('settings.aboutUpdateStepDownloadDesc')}
                />
                <StepItem
                  step={3}
                  status={stepStatuses.extract}
                  title={_('settings.aboutUpdateStepDeploy')}
                  desc={_('settings.aboutUpdateStepDeployDesc')}
                />
                <StepItem
                  step={4}
                  status={stepStatuses.restart}
                  title={_('settings.aboutUpdateStepStart')}
                  desc={_('settings.aboutUpdateStepStartDesc')}
                />
              </div>

              {isStalled && (
                <div className="mt-3.5 flex items-start gap-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span>{_('settings.aboutUpdateStalled')}</span>
                </div>
              )}
            </div>
          )}

          {/* Start Error Banner */}
          {startErrorKey && (
            <div className="rounded-xl bg-red-50 p-4 text-center text-xs font-medium text-red-700 dark:bg-red-950/30 dark:text-red-300">
              {activeMessage}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="mt-6 flex flex-wrap items-center justify-end gap-2.5 border-t border-stone-100 pt-4 dark:border-stone-800">
          {!hasStarted && !startErrorKey && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-stone-200/90 bg-white px-3.5 py-2 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-50 hover:text-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-750"
              >
                {_('settings.aboutUpdateLater')}
              </button>
              <button
                type="button"
                onClick={onStartUpdate}
                disabled={isStarting}
                className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-4 py-2 text-xs font-medium text-white shadow-xs transition-all hover:bg-stone-800 active:scale-95 disabled:opacity-60 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
              >
                {isStarting && (
                  <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                )}
                <span>{isStarting ? _('settings.aboutUpdateStarting') : _('settings.aboutUpdateConfirm')}</span>
              </button>
            </>
          )}

          {hasStarted && isUpdating && !startErrorKey && (
            <div className="flex items-center gap-2 text-xs text-stone-400 dark:text-stone-500">
              <svg className="h-3.5 w-3.5 animate-spin text-stone-500" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              <span>{_('settings.aboutUpdateWorking')}</span>
            </div>
          )}

          {isApplied && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white shadow-xs transition-all hover:bg-emerald-700 active:scale-95 dark:bg-emerald-500 dark:hover:bg-emerald-600"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                <path d="M21 2v6h-6" />
                <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                <path d="M3 22v-6h6" />
                <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
              </svg>
              <span>{_('settings.aboutUpdateRefresh')}</span>
            </button>
          )}

          {(isFailed || isReverted) && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-stone-200/90 bg-white px-3.5 py-2 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300"
              >
                {_('settings.aboutUpdateClose')}
              </button>
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-4 py-2 text-xs font-medium text-white shadow-xs transition-all hover:bg-stone-800 active:scale-95 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
              >
                <span>{_('settings.aboutRetry')}</span>
              </button>
            </>
          )}

          {startErrorKey && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-stone-200/90 bg-white px-3.5 py-2 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300"
            >
              {_('settings.aboutUpdateClose')}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function StepItem({
  step,
  status,
  title,
  desc,
}: {
  step: number
  status: StepStatus
  title: string
  desc: string
}) {
  return (
    <div
      className={`flex items-start gap-2.5 rounded-lg p-2.5 transition-colors ${
        status === 'active'
          ? 'bg-white shadow-2xs dark:bg-stone-800'
          : 'opacity-75'
      }`}
    >
      <div className="mt-0.5 shrink-0">
        {status === 'completed' ? (
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950/80 dark:text-emerald-400">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        ) : status === 'active' ? (
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900">
            <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          </div>
        ) : (
          <div className="flex h-5 w-5 items-center justify-center rounded-full border border-stone-300 text-[10px] font-semibold text-stone-400 dark:border-stone-700 dark:text-stone-500">
            {step}
          </div>
        )}
      </div>
      <div className="min-w-0">
        <h4 className={`text-xs font-medium ${status === 'active' ? 'text-stone-900 dark:text-stone-100 font-semibold' : 'text-stone-700 dark:text-stone-300'}`}>
          {title}
        </h4>
        <p className="mt-0.5 text-[11px] leading-tight text-stone-400 dark:text-stone-500">{desc}</p>
      </div>
    </div>
  )
}
