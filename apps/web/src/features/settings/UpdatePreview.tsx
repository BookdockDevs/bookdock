import { useState } from 'react'

import type { UpdatePhase, UpdateStatusRes } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'

import SystemUpdateDialog from './components/SystemUpdateDialog'

type PreviewScenario = 'checking' | 'snapshot' | 'connecting' | 'download' | 'extract' | 'verify' | 'promote' | 'restarting' | 'failed' | 'cancelled' | 'rolled-back' | 'succeeded' | 'offline'

const SCENARIOS: PreviewScenario[] = ['checking', 'snapshot', 'connecting', 'download', 'extract', 'verify', 'promote', 'restarting', 'failed', 'cancelled', 'rolled-back', 'succeeded', 'offline']

const NOW = Date.now()

function makeStatus(scenario: PreviewScenario, _: ReturnType<typeof useTranslation>): UpdateStatusRes {
  const phaseByScenario: Partial<Record<PreviewScenario, UpdatePhase>> = {
    checking: 'check', snapshot: 'snapshot', connecting: 'download', download: 'download',
    extract: 'extract', verify: 'verify', promote: 'promote', restarting: 'restarting',
    failed: 'failed', cancelled: 'cancelled', 'rolled-back': 'failed', succeeded: 'idle',
  }
  const phase = phaseByScenario[scenario] ?? 'download'
  const terminal = ['failed', 'cancelled', 'rolled-back', 'succeeded'].includes(scenario)
  const status: UpdateStatusRes = {
    phase,
    currentVersion: scenario === 'succeeded' ? '0.3.4' : '0.3.3',
    targetVersion: '0.3.4',
    progressId: 'preview-8f1c2a',
    outcome: scenario === 'succeeded' ? 'succeeded' : scenario === 'rolled-back' ? 'rolled-back' : scenario === 'failed' ? 'failed' : scenario === 'cancelled' ? 'cancelled' : terminal ? undefined : 'active',
    action: scenario === 'checking' ? _('settings.aboutUpdatePhaseCheck') : scenario === 'snapshot' ? _('settings.aboutUpdatePhaseSnapshot') : scenario === 'connecting' ? _('updatePreview.actionConnecting') : scenario === 'download' ? _('updatePreview.actionDownload') : scenario === 'extract' ? _('settings.aboutUpdatePhaseExtract') : scenario === 'verify' ? _('settings.aboutUpdatePhaseVerify') : scenario === 'promote' ? _('settings.aboutUpdatePhasePromote') : scenario === 'restarting' ? _('settings.aboutUpdatePhaseRestarting') : undefined,
    startedAt: NOW - 94_000,
    updatedAt: NOW,
    phaseStartedAt: NOW - (scenario === 'download' ? 37_000 : 12_000),
    elapsedMs: 94_000,
    snapshot: scenario === 'snapshot' ? { pages: 420, totalPages: 960 } : undefined,
    download: ['connecting', 'download'].includes(scenario) ? {
      state: scenario === 'connecting' ? 'connecting' : 'receiving',
      receivedBytes: scenario === 'download' ? 18_874_368 : 0,
      totalBytes: scenario === 'download' ? 52_428_800 : undefined,
      lastDataAt: scenario === 'download' ? NOW - 1_200 : undefined,
    } : undefined,
    extraction: scenario === 'extract' ? { files: 342, bytes: 28_991_488 } : undefined,
    diagnostic: terminal ? {
      requestId: 'preview-8f1c2a', startedAt: NOW - 94_000, updatedAt: NOW,
      phaseStartedAt: NOW - 12_000, finishedAt: NOW, phase,
      errorCode: scenario === 'failed' || scenario === 'rolled-back' ? 'UPDATE_FAILED' : undefined,
      message: scenario === 'failed' ? _('updatePreview.timeoutMessage') : scenario === 'rolled-back' ? _('updatePreview.rollbackMessage') : undefined,
    } : undefined,
    error: scenario === 'failed' ? { code: 'UPDATE_FAILED', message: _('updatePreview.timeoutMessage') } : undefined,
  }
  return status
}

export default function UpdatePreview() {
  const _ = useTranslation()
  const [scenario, setScenario] = useState<PreviewScenario>('download')
  const [status, setStatus] = useState(() => makeStatus('download', _))
  const [isDialogOpen, setIsDialogOpen] = useState(true)

  const selectScenario = (next: PreviewScenario) => {
    setScenario(next)
    setStatus(makeStatus(next, _))
  }

  return (
    <main className="min-h-screen bg-stone-100 p-6 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <div className="mx-auto max-w-4xl rounded-2xl border border-stone-200 bg-white p-8 shadow-sm dark:border-stone-800 dark:bg-stone-900">
        <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Bookdock · { _('updatePreview.eyebrow') }</p>
        <h1 className="mt-2 text-2xl font-semibold">{_('settings.about')} · { _('updatePreview.title') }</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-stone-500 dark:text-stone-400">{_('updatePreview.description')}</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-stone-200 p-5 dark:border-stone-800">
            <div className="text-xs text-stone-500">{_('updatePreview.currentVersion')}</div>
            <div className="mt-1 font-mono text-lg">v0.3.3</div>
          </div>
          <div className="rounded-xl border border-stone-200 p-5 dark:border-stone-800">
            <div className="text-xs text-stone-500">{_('updatePreview.targetVersion')}</div>
            <div className="mt-1 font-mono text-lg">v0.3.4</div>
          </div>
        </div>
        {!isDialogOpen && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100">
            <span>{_('updatePreview.backgroundMessage')}</span>
            <button type="button" onClick={() => setIsDialogOpen(true)} className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-medium text-white dark:bg-stone-100 dark:text-stone-900">
              {_('updatePreview.viewProgress')}
            </button>
          </div>
        )}
      </div>

      <div className="fixed inset-x-3 top-3 z-[60] mx-auto flex max-w-4xl flex-wrap items-center gap-2 rounded-xl border border-stone-300 bg-white/95 p-3 shadow-lg backdrop-blur dark:border-stone-700 dark:bg-stone-900/95">
        <span className="mr-1 text-xs font-semibold">{_('updatePreview.controls')}</span>
        <select
          aria-label={_('updatePreview.scenario')}
          value={scenario}
          onChange={(event) => selectScenario(event.target.value as PreviewScenario)}
          className="min-w-48 rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs dark:border-stone-700 dark:bg-stone-800"
        >
          {SCENARIOS.map((item) => <option key={item} value={item}>{_(`updatePreview.scenario_${item}`)}</option>)}
        </select>
        <span className="text-[11px] text-stone-500">{_('updatePreview.hint')}</span>
      </div>

      <SystemUpdateDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        currentVersion="0.3.3"
        targetVersion="0.3.4"
        publishedAt="2026-09-25T00:00:00.000Z"
        status={scenario === 'offline' ? undefined : status}
        isStarting={false}
        statusUnavailable={scenario === 'offline'}
        statusRefreshing={scenario === 'offline'}
        isCancelling={false}
        cancelError={false}
        updateStartedAt={NOW - 94_000}
        onStartUpdate={() => selectScenario('checking')}
        onRetry={() => selectScenario('checking')}
        onCancel={() => selectScenario('cancelled')}
      />
    </main>
  )
}
