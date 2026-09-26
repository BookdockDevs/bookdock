import { useEffect, useId, useRef, useState } from 'react'
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
  statusUnavailable?: boolean
  statusRefreshing?: boolean
  isCancelling?: boolean
  cancelError?: boolean
  updateStartedAt: number
  onStartUpdate: () => void
  onRetry: () => void
  onCancel: () => void
}

const UPDATE_PHASE_KEYS: Record<Exclude<UpdatePhase, 'idle' | 'failed' | 'cancelled'>, string> = {
  check: 'settings.aboutUpdatePhaseCheck',
  snapshot: 'settings.aboutUpdatePhaseSnapshot',
  download: 'settings.aboutUpdatePhaseDownload',
  verify: 'settings.aboutUpdatePhaseVerify',
  extract: 'settings.aboutUpdatePhaseExtract',
  promote: 'settings.aboutUpdatePhasePromote',
  restarting: 'settings.aboutUpdatePhaseRestarting',
}

const UPDATE_STALL_HINT_MS = 90 * 1000

// Server-sent progress details are English-only; map the known closed set to
// i18n keys so the dialog never leaks them (unknown future strings fall back
// to the raw text rather than blanking out).
const SERVER_ACTION_KEYS: Record<string, string> = {
  'Checking the latest release and runtime compatibility': 'settings.aboutUpdateActionCheck',
  'Connecting to release server': 'settings.aboutUpdateConnecting',
  'Release server responded; receiving package data': 'settings.aboutUpdateReceiving',
  'Checking the package SHA-256 checksum': 'settings.aboutUpdateActionVerify',
  'Creating a rollback snapshot of the database': 'settings.aboutUpdateActionSnapshot',
  'Unpacking release files': 'settings.aboutUpdateActionExtract',
  'Preparing the verified release for startup': 'settings.aboutUpdateActionPromote',
  'Waiting for the launcher health check': 'settings.aboutUpdateActionRestarting',
}

function localizeServerAction(t: (key: string) => string, action?: string): string | undefined {
  if (!action) return undefined
  const key = SERVER_ACTION_KEYS[action]
  return key ? t(key) : action
}

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
    snapshot: phase === 'check' ? 'pending' : phase === 'snapshot' ? 'active' : 'completed',
    download: phase === 'download' || phase === 'verify' ? 'active' : phase === 'check' || phase === 'snapshot' ? 'pending' : 'completed',
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
  statusUnavailable = false,
  statusRefreshing = false,
  isCancelling = false,
  cancelError = false,
  updateStartedAt,
  onStartUpdate,
  onRetry,
  onCancel,
}: SystemUpdateDialogProps) {
  const _ = useTranslation()
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [copiedDiagnostic, setCopiedDiagnostic] = useState(false)

  const isUpdating = isStarting || status?.outcome === 'active'
  const isApplied = status?.outcome === 'succeeded' || (status?.phase === 'idle' && status.currentVersion === targetVersion)
  const isReverted = status?.outcome === 'rolled-back'
  const isCancelled = status?.outcome === 'cancelled'
  const isFailed = status?.outcome === 'failed' || (status?.phase === 'failed' && !isReverted)
  const isSettled = isApplied || isReverted || isCancelled || isFailed
  const hasStarted = isUpdating || isSettled

  const isStalled =
    !isSettled &&
    status?.phase === 'restarting' &&
    Date.now() - (status?.startedAt ?? updateStartedAt) > UPDATE_STALL_HINT_MS

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
  } else if (isCancelled) {
    activeMessage = _('settings.aboutUpdateCancelled')
  } else if (status?.phase && status.phase in UPDATE_PHASE_KEYS) {
    activeMessage = _(UPDATE_PHASE_KEYS[status.phase as keyof typeof UPDATE_PHASE_KEYS])
  } else if (isStarting) {
    activeMessage = _('settings.aboutUpdateStarting')
  }

  // A failed start attempt supersedes the stale settled box: showing both
  // produced duplicate banners and duplicate Close buttons.
  const visibleSettled = isSettled && !startErrorKey
  const serverActionText = status?.action && status.action !== activeMessage
    ? localizeServerAction(_, status.action)
    : undefined

  const handleCopyDiagnostic = async () => {
    if (!status?.diagnostic) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(status.diagnostic, null, 2))
      setCopiedDiagnostic(true)
      setTimeout(() => setCopiedDiagnostic(false), 2000)
    } catch {
      // Fallback
    }
  }

  // Keyboard navigation & Esc handling: allow closing in any state (background execution)
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const failureDetail = status?.error?.message ?? status?.diagnostic?.message

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-xs transition-opacity animate-in fade-in"
      onClick={onClose}
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
          <div className="flex items-center gap-3.5">
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

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            aria-label={_('settings.aboutUpdateClose')}
            title={_('settings.aboutUpdateClose')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Content Body */}
        <div className="mt-5 space-y-4">
          {/* Start Error Banner */}
          {startErrorKey && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-medium text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
              {activeMessage}
            </div>
          )}

          {/* Settled / Terminal State Notification Banner (Unified, no nested boxes) */}
          {visibleSettled && (
            <div
              role={isFailed ? 'alert' : 'status'}
              className={`rounded-xl border p-4 text-xs leading-relaxed ${
                isFailed
                  ? 'border-red-200 bg-red-50/90 text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200'
                  : isReverted
                    ? 'border-amber-200 bg-amber-50/90 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200'
                    : isApplied
                      ? 'border-emerald-200 bg-emerald-50/90 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200'
                      : 'border-stone-200 bg-stone-50 text-stone-700 dark:border-stone-800 dark:bg-stone-800/50 dark:text-stone-300'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <div className="mt-0.5 shrink-0">
                  {isApplied ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-emerald-600 dark:text-emerald-400">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : isFailed ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-red-600 dark:text-red-400">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                  ) : isReverted ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-amber-600 dark:text-amber-400">
                      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                      <polyline points="9 22 9 12 15 12 15 22" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-stone-500">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="15" y1="9" x2="9" y2="15" />
                      <line x1="9" y1="9" x2="15" y2="15" />
                    </svg>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{activeMessage}</p>
                  {isFailed && failureDetail && (
                    <p className="mt-1.5 break-words font-mono text-[11px] opacity-90">{failureDetail}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Connection Stalled / Reconnecting Banner */}
          {statusUnavailable && (isUpdating || !status) && (
            <div role="alert" className="flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
              <svg className="h-4 w-4 shrink-0 animate-spin text-amber-600 dark:text-amber-400" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              <span>{_('settings.aboutUpdateStatusUnavailable')}{statusRefreshing ? ` ${_('settings.aboutUpdateReconnecting')}` : ''}</span>
            </div>
          )}

          {/* Active Updating Progress Panel (Unified single status box, replaces previous dual status rows) */}
          {isUpdating && !startErrorKey && (
            <div className="rounded-xl border border-stone-200/90 bg-stone-50/70 p-4 dark:border-stone-800 dark:bg-stone-800/50">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-600 dark:bg-blue-400" />
                  </span>
                  <span className="truncate text-xs font-semibold text-stone-900 dark:text-stone-100">
                    {activeMessage}
                  </span>
                </div>
                {status?.phaseStartedAt && (
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-stone-400 dark:text-stone-500">
                    {_('settings.aboutUpdateElapsed', { time: formatElapsed(status.phaseStartedAt) })}
                  </span>
                )}
              </div>

              {/* Sub-action description: only display standalone when no progress bar is active */}
              {!['snapshot', 'download', 'extract'].includes(status?.phase ?? '') && serverActionText && (
                <p className="mt-1.5 text-xs text-stone-500 dark:text-stone-400">
                  {serverActionText}
                </p>
              )}

              {/* Real-time Progress Bar & Metrics */}
              {status?.phase === 'snapshot' && status.snapshot && (
                <div className="mt-3">
                  <ProgressBar
                    current={status.snapshot.pages}
                    total={status.snapshot.totalPages}
                  />
                  <div className="mt-1.5">
                    <ProgressText
                      label={_('settings.aboutUpdateSnapshotProgress')}
                      current={status.snapshot.pages}
                      total={status.snapshot.totalPages}
                      action={status.action !== activeMessage ? status.action : undefined}
                    />
                  </div>
                </div>
              )}

              {status?.phase === 'download' && status.download && (
                <div className="mt-3">
                  <DownloadProgressBar download={status.download} />
                  <div className="mt-1.5">
                    <DownloadProgress
                      download={status.download}
                      action={serverActionText}
                    />
                  </div>
                </div>
              )}

              {status?.phase === 'extract' && status.extraction && (
                <div className="mt-3">
                  <ExtractionProgressBar extraction={status.extraction} />
                  <div className="mt-1.5">
                    <ExtractionProgress
                      extraction={status.extraction}
                      action={status.action !== activeMessage ? status.action : undefined}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Stepper Pipeline (Clean vertical timeline flow) */}
          {!startErrorKey && (
            <div className="rounded-xl border border-stone-200/90 bg-white p-3.5 dark:border-stone-800 dark:bg-stone-900/60">
              <div className="space-y-1">
                <PipelineStepItem
                  step={1}
                  status={stepStatuses.snapshot}
                  title={_('settings.aboutUpdateStepSnapshot')}
                  desc={_('settings.aboutUpdateStepSnapshotDesc')}
                  isLast={false}
                />
                <PipelineStepItem
                  step={2}
                  status={stepStatuses.download}
                  title={_('settings.aboutUpdateStepDownload')}
                  desc={_('settings.aboutUpdateStepDownloadDesc')}
                  isLast={false}
                />
                <PipelineStepItem
                  step={3}
                  status={stepStatuses.extract}
                  title={_('settings.aboutUpdateStepDeploy')}
                  desc={_('settings.aboutUpdateStepDeployDesc')}
                  isLast={false}
                />
                <PipelineStepItem
                  step={4}
                  status={stepStatuses.restart}
                  title={_('settings.aboutUpdateStepStart')}
                  desc={_('settings.aboutUpdateStepStartDesc')}
                  isLast={true}
                />
              </div>

              {isStalled && (
                <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
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
        </div>

        {/* Footer Actions */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-4 dark:border-stone-800">
          {/* Left Footer Utilities: Diagnostic Log button */}
          <div className="flex items-center gap-2">
            {hasStarted && status?.diagnostic && (
              <button
                type="button"
                onClick={() => void handleCopyDiagnostic()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
              >
                {copiedDiagnostic ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
                <span>{copiedDiagnostic ? _('copied') : _('settings.aboutUpdateCopyDiagnostic')}</span>
              </button>
            )}
            {cancelError && (
              <span role="alert" className="text-xs text-red-600 dark:text-red-400">
                {_('settings.aboutUpdateCancelFailed')}
              </span>
            )}
          </div>

          {/* Right Action Buttons: Always paired & aligned */}
          <div className="flex items-center gap-2.5">
            {!hasStarted && !startErrorKey && (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-stone-200/90 bg-white px-3.5 py-2 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-50 hover:text-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
                >
                  {_('settings.aboutUpdateLater')}
                </button>
                <button
                  type="button"
                  onClick={() => onStartUpdate()}
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
              <>
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={isCancelling || !status?.progressId || ['promote', 'restarting'].includes(status?.phase ?? '')}
                  className="rounded-lg border border-stone-200/90 bg-white px-3.5 py-2 text-xs font-medium text-stone-600 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:pointer-events-none disabled:opacity-40 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-red-950/20 dark:hover:text-red-400"
                >
                  {isCancelling ? _('settings.aboutUpdateCancelling') : _('settings.aboutUpdateCancel')}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-4 py-2 text-xs font-medium text-white shadow-xs transition-all hover:bg-stone-800 active:scale-95 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
                >
                  <span>{_('settings.aboutUpdateRunInBackground')}</span>
                </button>
              </>
            )}

            {isApplied && (
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
              </>
            )}

            {(isFailed || isReverted || isCancelled) && !startErrorKey && (
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
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function formatElapsed(start?: number) {
  if (!start) return ''
  const seconds = Math.max(0, Math.floor((Date.now() - start) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = units[0]
  for (let i = 1; value >= 1024 && i < units.length; i += 1) {
    value /= 1024
    unit = units[i]
  }
  return `${value.toFixed(1)} ${unit}`
}

function ProgressBar({ current, total }: { current?: number; total?: number }) {
  const percent = total && total > 0 ? Math.min(100, Math.max(0, Math.floor(((current ?? 0) * 100) / total))) : null
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-200/80 dark:bg-stone-700">
      <div
        className="h-full rounded-full bg-stone-900 transition-all duration-300 dark:bg-stone-100"
        style={{ width: percent !== null ? `${percent}%` : '100%' }}
      />
    </div>
  )
}

function DownloadProgressBar({ download }: { download: NonNullable<UpdateStatusRes['download']> }) {
  const percent = download.totalBytes && download.totalBytes > 0
    ? Math.min(100, Math.max(0, Math.floor((download.receivedBytes * 100) / download.totalBytes)))
    : null
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-200/80 dark:bg-stone-700">
      <div
        className="h-full rounded-full bg-stone-900 transition-all duration-300 dark:bg-stone-100"
        style={{ width: percent !== null ? `${percent}%` : '35%' }}
      />
    </div>
  )
}

function ExtractionProgressBar({ extraction }: { extraction: NonNullable<UpdateStatusRes['extraction']> }) {
  const percent = extraction.totalBytes && extraction.totalBytes > 0
    ? Math.min(100, Math.max(0, Math.floor((extraction.bytes * 100) / extraction.totalBytes)))
    : extraction.totalFiles && extraction.totalFiles > 0
      ? Math.min(100, Math.max(0, Math.floor((extraction.files * 100) / extraction.totalFiles)))
      : null
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-200/80 dark:bg-stone-700">
      <div
        className="h-full rounded-full bg-stone-900 transition-all duration-300 dark:bg-stone-100"
        style={{ width: percent !== null ? `${percent}%` : '50%' }}
      />
    </div>
  )
}

function ProgressText({ label, current, total, action }: { label: string; current?: number; total?: number; action?: string }) {
  return (
    <p className="flex justify-between text-[11px] text-stone-500 dark:text-stone-400">
      <span className="truncate pr-2">{action || label}</span>
      <span className="shrink-0 tabular-nums">
        {current?.toLocaleString() ?? 0}
        {total !== undefined ? ` / ${total.toLocaleString()} (${total ? Math.floor(((current ?? 0) * 100) / total) : 0}%)` : ''}
      </span>
    </p>
  )
}

function DownloadProgress({
  download,
  action,
}: {
  download: NonNullable<UpdateStatusRes['download']>
  action?: string
}) {
  const _ = useTranslation()
  const percent = download.totalBytes ? Math.floor((download.receivedBytes * 100) / download.totalBytes) : null
  const stateLabel = action || (download.state === 'connecting' ? _('settings.aboutUpdateConnecting') : _('settings.aboutUpdateReceiving'))
  return (
    <p className="flex justify-between text-[11px] text-stone-500 dark:text-stone-400">
      <span className="truncate pr-2">{stateLabel}</span>
      <span className="shrink-0 tabular-nums">
        {formatBytes(download.receivedBytes)}
        {download.totalBytes ? ` / ${formatBytes(download.totalBytes)} (${percent}%)` : ''}
      </span>
    </p>
  )
}

function ExtractionProgress({
  extraction,
  action,
}: {
  extraction: NonNullable<UpdateStatusRes['extraction']>
  action?: string
}) {
  const _ = useTranslation()
  const percent = extraction.totalBytes ? Math.floor((extraction.bytes * 100) / extraction.totalBytes) : null
  const progressText = _('settings.aboutUpdateExtractProgress', {
    files: extraction.totalFiles ? `${extraction.files} / ${extraction.totalFiles}` : extraction.files,
    bytes: formatBytes(extraction.bytes),
  })
  return (
    <p className="flex justify-between text-[11px] text-stone-500 dark:text-stone-400">
      <span className="truncate pr-2">{action || progressText}</span>
      <span className="shrink-0 tabular-nums">
        {action ? progressText : ''}
        {percent !== null ? ` · ${percent}%` : ''}
      </span>
    </p>
  )
}

function PipelineStepItem({
  step,
  status,
  title,
  desc,
  isLast,
}: {
  step: number
  status: StepStatus
  title: string
  desc: string
  isLast: boolean
}) {
  return (
    <div className="relative flex items-start gap-3 py-1.5">
      {/* Connecting Vertical Line */}
      {!isLast && (
        <div
          className={`absolute left-[11px] top-6 w-[2px] bottom-0 -mb-1 ${
            status === 'completed'
              ? 'bg-emerald-500/80 dark:bg-emerald-500/60'
              : 'bg-stone-200 dark:bg-stone-800'
          }`}
        />
      )}

      {/* Step Indicator Icon */}
      <div className="relative z-10 shrink-0 mt-0.5">
        {status === 'completed' ? (
          <div className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-emerald-500 text-white shadow-2xs">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        ) : status === 'active' ? (
          <div className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-stone-900 text-white shadow-xs ring-4 ring-stone-900/10 dark:bg-stone-100 dark:text-stone-900 dark:ring-stone-100/10">
            <span className="text-[10px] font-bold">{step}</span>
          </div>
        ) : (
          <div className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-stone-300 bg-white text-[10px] font-semibold text-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-500">
            {step}
          </div>
        )}
      </div>

      {/* Step Texts */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <h4 className={`text-xs ${status === 'active' ? 'font-semibold text-stone-900 dark:text-stone-100' : status === 'completed' ? 'font-medium text-stone-800 dark:text-stone-200' : 'font-medium text-stone-500 dark:text-stone-400'}`}>
            {title}
          </h4>
          <div className="shrink-0 flex items-center">
            {status === 'completed' && (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {status === 'active' && (
              <svg className="h-3.5 w-3.5 animate-spin text-blue-600 dark:text-blue-400" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            )}
          </div>
        </div>
        <p className="mt-0.5 text-[11px] leading-tight text-stone-400 dark:text-stone-500">{desc}</p>
      </div>
    </div>
  )
}
