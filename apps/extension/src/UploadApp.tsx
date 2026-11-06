import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '../../web/src/components/ui/Button'
import { ToastStack } from '../../web/src/components/ui/ToastStack'
import UploadFilesPanel from '../../web/src/features/library/components/UploadFilesPanel'
import { uploadFeedback } from '../../web/src/features/library/upload-feedback'
import type { UploadItemView } from '../../web/src/features/library/upload-types'
import { useToastStore } from '../../web/src/stores/toast.store'

import { t } from './i18n'
import { CHUNK_BYTES, canRetry, readerUrl, supportedFile } from './model'
import type { UploadJob } from './model'
import { extension } from './platform'
import { appendChunk, cancelBatch, createJobs, finishTransfer, getConnection, interruptTransfer, listJobs, queueBatch, removeBatch, removeJob, sweepJobs } from './store'
import { uploadFile } from './upload-file'
import { translate as _ } from './useTranslation'
import { errorText } from './ui'

const EMPTY_JOBS: UploadJob[] = []

function BookdockLogo({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z" />
      <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
    </svg>
  )
}

export default function UploadApp() {
  const client = useQueryClient()
  const [batchId, setBatchId] = useState(new URLSearchParams(location.search).get('batch') ?? undefined)
  const [dragOver, setDragOver] = useState(false)
  const [adding, setAdding] = useState(false)
  const [progress, setProgress] = useState<Record<string, number>>({})
  const input = useRef<HTMLInputElement>(null)
  const running = useRef(new Map<string, AbortController>())
  const stopped = useRef(false)
  const lastSummary = useRef('')
  const navigation = useRef(false)
  const noticesShown = useRef(new Set<string>())
  const lastSweep = useRef(0)
  const connectionQuery = useQuery({ queryKey: ['extension-connection'], queryFn: getConnection, refetchInterval: 1000 })
  const jobsQuery = useQuery({
    queryKey: ['extension-jobs', batchId], enabled: !!batchId,
    queryFn: async () => {
      if (Date.now() - lastSweep.current > 15_000) { await sweepJobs(); lastSweep.current = Date.now() }
      return (await listJobs()).filter((job) => job.batchId === batchId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    }, refetchInterval: 300,
  })
  const jobs = jobsQuery.data ?? EMPTY_JOBS
  const connection = connectionQuery.data
  // The whole object is re-read every second; the id is what the queue actually keys on.
  const connectionId = connection?.id
  const items: UploadItemView[] = useMemo(() => jobs.map((job) => ({
    id: job.id, name: job.name, bookVersionId: job.result?.bookVersionId,
    status: job.state === 'receiving' ? 'uploading' : job.state === 'ready' ? 'queued' : job.state === 'failed' ? 'error' : job.state === 'uploading' ? ((progress[job.id] ?? 0) >= 100 ? 'processing' : 'uploading') : job.state,
    progress: job.state === 'receiving' ? Math.round(job.received / Math.max(1, job.size) * 100) : progress[job.id] ?? (['success', 'duplicate', 'failed'].includes(job.state) ? 100 : 0),
    message: job.state === 'receiving' ? t('upload.receiving') : job.error,
    // A retry needs both the bytes and a destination to send them to.
    retryable: !!connectionId && canRetry(job, connectionId),
  })), [jobs, progress, connectionId])
  const isUploading = adding || jobs.some((job) => ['receiving', 'ready', 'uploading'].includes(job.state))
  const settled = items.length > 0 && !isUploading && !items.some((item) => item.status === 'pending')
  const readable = settled && items.length === 1 && ['success', 'duplicate'].includes(items[0]!.status) && !!items[0]!.bookVersionId
  const refresh = useCallback(() => client.invalidateQueries({ queryKey: ['extension-jobs'] }), [client])

  useEffect(() => {
    if (stopped.current) return
    for (const job of jobs) {
      if (running.current.size >= 3) break
      if (job.state !== 'ready' || running.current.has(job.id)) continue
      const controller = new AbortController()
      running.current.set(job.id, controller)
      setProgress((previous) => ({ ...previous, [job.id]: 0 }))
      void uploadFile(job.id, (value) => setProgress((previous) => ({ ...previous, [job.id]: value })), controller.signal)
        .catch((error: unknown) => useToastStore.getState().addToast(errorText(error), 'error'))
        .finally(() => { void refresh().finally(() => { running.current.delete(job.id); setProgress((previous) => ({ ...previous })) }) })
    }
  // `progress` is deliberately absent: every tick would re-run this scan, and the 300ms job
  // poll already brings the state this effect depends on.
  }, [jobs, refresh])

  useEffect(() => {
    for (const job of jobs) if (job.batchNotices && !noticesShown.current.has(job.id)) {
      noticesShown.current.add(job.id)
      if (job.batchNotices.ignored) useToastStore.getState().addToast({ key: 'library.uploadIgnored', params: { count: job.batchNotices.ignored } }, 'info')
      if (job.batchNotices.oversized) useToastStore.getState().addToast({ key: 'library.uploadOversized', params: { count: job.batchNotices.oversized } }, 'info')
    }
    if (!settled) { lastSummary.current = ''; return }
    const fingerprint = items.map((item) => `${item.id}:${item.status}`).join(',')
    if (lastSummary.current === fingerprint) return
    lastSummary.current = fingerprint
    if (stopped.current) return
    const feedback = uploadFeedback(items, _)
    if (feedback) useToastStore.getState().addToast(feedback.message, feedback.type, { dedupeKey: `upload:${batchId}` })
  }, [settled, jobs, items, batchId])

  const destination = useMemo(() => {
    if (!connection) return undefined
    if (!readable || !jobs[0]?.result || jobs[0].connectionId !== connection.id) return connection.baseUrl
    // A foreign server's bad id must fall back to the library, not blank the page mid-render.
    try { return readerUrl(connection, jobs[0].result) } catch { return connection.baseUrl }
  }, [connection, readable, jobs])

  useEffect(() => {
    if (!settled || !connection || connection.autoOpen === false || stopped.current || navigation.current || !items.every((item) => ['success', 'duplicate'].includes(item.status)) || !jobs.every((job) => job.connectionId === connection.id)) return
    navigation.current = true
    void removeBatch(batchId!).then(() => location.replace(destination!)).catch((error: unknown) => { navigation.current = false; useToastStore.getState().addToast(errorText(error), 'error') })
  }, [settled, connection, items, jobs, batchId, destination])

  useEffect(() => {
    const active = running.current
    const abort = () => { for (const controller of active.values()) controller.abort() }
    window.addEventListener('pagehide', abort)
    return () => { window.removeEventListener('pagehide', abort); abort() }
  }, [])

  useEffect(() => {
    if (!isUploading) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [isUploading])

  async function addFiles(files: File[], autoStart: boolean) {
    if (adding) return
    if (!connection) { useToastStore.getState().addToast(t('upload.notConnected'), 'error'); return }
    setAdding(true)
    stopped.current = false
    const accepted = files.filter((file) => supportedFile(file.name))
    const inRange = accepted.filter((file) => file.size <= connection.uploadMaxBytes)
    if (files.length !== accepted.length) useToastStore.getState().addToast({ key: 'library.uploadIgnored', params: { count: files.length - accepted.length } }, 'info')
    if (accepted.length !== inRange.length) useToastStore.getState().addToast({ key: 'library.uploadOversized', params: { count: accepted.length - inRange.length } }, 'info')
    try {
      if (!inRange.length) return
      const start = autoStart || isUploading
      const created = await createJobs(connection, inRange.map((file) => ({ name: file.name, size: file.size })), { batchId, sourceTabId: null, autoStart: start })
      const activeBatch = created[0]!.batchId
      setBatchId(activeBatch)
      history.replaceState(null, '', `upload.html?batch=${activeBatch}`)
      if (start) await queueBatch(activeBatch)
      await refresh()
      for (const [position, file] of inRange.entries()) {
        const job = created[position]!
        if (!file.size) continue
        try {
          let index = 0
          for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) await appendChunk(job.id, index++, new Uint8Array(await file.slice(offset, offset + CHUNK_BYTES).arrayBuffer()))
          await finishTransfer(job.id)
        } catch { await interruptTransfer(job.id) }
      }
      await refresh()
    } catch (error) { useToastStore.getState().addToast(errorText(error), 'error') }
    finally { setAdding(false) }
  }

  /** The page exists only for one transfer, so finishing means leaving it. */
  function finish() {
    void Promise.all(jobs.filter((job) => !['receiving', 'ready', 'uploading'].includes(job.state)).map((job) => removeJob(job.id)))
      .then(refresh)
      .finally(() => { void extension.tabs.getCurrent().then((tab) => { if (tab?.id !== undefined) void extension.tabs.remove(tab.id) }) })
  }
  function retry(id?: string) {
    stopped.current = false
    void queueBatch(batchId!, true, id).then((queued) => {
      // Nothing requeued means the bytes went away between paint and click: say so
      // rather than leaving the toast-less, motion-less no-op the button used to be.
      if (queued === 0) useToastStore.getState().addToast(t('error.transferLost'), 'info')
      return refresh()
    }).catch((error: unknown) => useToastStore.getState().addToast(errorText(error), 'error'))
  }
  function openBookdock() {
    const url = destination ?? connection?.baseUrl
    if (url) void extension.tabs.create({ url })
  }

  return <>
    <main
      className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-5 py-8"
      onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }}
      onDrop={(event) => { if (!event.dataTransfer.types.includes('Files')) return; event.preventDefault(); setDragOver(false); void addFiles([...event.dataTransfer.files], true) }}
    >
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <BookdockLogo className="h-6 w-6 shrink-0 text-stone-900 dark:text-stone-100" />
          <span className="font-serif text-base font-semibold tracking-wide text-stone-900 dark:text-stone-100">{t('app.name')}</span>
        </div>
        <div className="flex items-center gap-3">
          {connection && (
            <div className="hidden sm:flex items-center gap-2 rounded-full border border-stone-200/80 bg-stone-50/80 px-2.5 py-1 text-xs text-stone-600 shadow-2xs dark:border-stone-800 dark:bg-stone-850 dark:text-stone-400">
              <span className="relative flex h-1.5 w-1.5 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
              </span>
              <span className="font-medium text-stone-800 dark:text-stone-200">{connection.username}</span>
              <span className="text-stone-300 dark:text-stone-600">·</span>
              <span className="font-mono text-[11px] text-stone-400 dark:text-stone-500">{connection.baseUrl.replace(/^https?:\/\//, '')}</span>
            </div>
          )}
          <Button variant="secondary" size="sm" onClick={openBookdock} disabled={!connection}>{t('upload.open')}</Button>
        </div>
      </header>
      <div className="mt-9">
        <h1 className="text-lg font-semibold tracking-tight">{_('library.upload')}</h1>
        <p className="mt-1 text-sm leading-6 text-stone-500 dark:text-stone-400">
          {isUploading ? t('upload.uploadingNotice') : t('upload.intro')}
        </p>
      </div>
      <div className="mt-5">
        <UploadFilesPanel items={items} maxBytes={connection?.uploadMaxBytes} dragOver={dragOver} setDragOver={setDragOver} isUploading={isUploading} readable={readable}
          onChooseFiles={() => input.current?.click()} onStartUpload={() => { stopped.current = false; void queueBatch(batchId!).then(refresh) }}
          retry={retry} retryAll={() => retry()} continueUpload={() => {}} abortAll={() => { stopped.current = true; for (const controller of running.current.values()) controller.abort(); void cancelBatch(batchId!).then(refresh) }} handleClose={finish} handleRead={openBookdock} toastObstacle={false} />
        <input ref={input} id="file" type="file" accept=".epub,.txt" multiple className="hidden" onChange={(event) => { if (event.target.files?.length) void addFiles([...event.target.files], false); event.target.value = '' }} />
      </div>
    </main>
    <ToastStack />
  </>
}
