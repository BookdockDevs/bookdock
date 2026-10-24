import { useEffect, useRef, useState } from 'react'
import { useQueries } from '@tanstack/react-query'

import type { BookFormat } from '@bookdock/shared'

import { apiGet } from '@/api/client'
import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorMessage } from '@/lib/error-message'
import { useAuthStore } from '@/stores/auth.store'

import { createBooksArchive, deliverBlob, prepareBookFile, type BookDownloadRequest, type PreparedBookFile } from '../download'

interface DownloadBookTarget {
  id: string
  title: string
  format: BookFormat
  versionLabel?: string
}

interface DownloadDialogProps {
  books: DownloadBookTarget[]
  userId: string
  onClose: () => void
}

type DownloadChoice = { format: 'keep' | 'epub' | 'txt'; edited: boolean }
type ReplacementResponse = { data: Array<{ enabled: boolean; effectiveEnabled?: boolean }> }

function savedChoice(userId: string, batch: boolean): DownloadChoice {
  try {
    const key = batch ? `bd-download-choice:batch:${userId}` : `bd-download-choice:${userId}`
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (batch && saved?.format === 'keep') return { format: 'keep', edited: saved.edited === true }
    if (saved?.format === 'epub' || saved?.format === 'txt') return { format: saved.format, edited: saved.edited === true }
  } catch {
    // Device storage is optional.
  }
  return { format: batch ? 'keep' : 'epub', edited: false }
}

export default function DownloadDialog({ books, userId, onClose }: DownloadDialogProps) {
  const _ = useTranslation()
  const batch = books.length > 1
  const preferenceKey = batch ? `bd-download-choice:batch:${userId}` : `bd-download-choice:${userId}`
  const [choice, setChoice] = useState<DownloadChoice>(() => savedChoice(userId, batch))
  const ruleQueries = useQueries({
    queries: books.map((book) => ({
      queryKey: ['replacements', 'book', book.id],
      queryFn: () => apiGet<ReplacementResponse>(`/replacements?bookId=${book.id}`),
    })),
  })
  const rulesFailed = ruleQueries.some((query) => query.isError)
  const hasRules = ruleQueries.map((query) => (query.data?.data ?? []).some((rule) => rule.effectiveEnabled ?? rule.enabled))
  const effectiveFormat = (book: DownloadBookTarget) => choice.format === 'keep' ? book.format : choice.format
  const requiresRuleLookup = (book: DownloadBookTarget) => book.format === 'txt' || effectiveFormat(book) === 'txt'
  const supportsEdited = books.some((book, index) => hasRules[index] && (book.format === 'txt' || effectiveFormat(book) === 'txt'))
  const edited = choice.edited && supportsEdited
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState(0)
  const [failedIds, setFailedIds] = useState<string[]>([])
  const [files, setFiles] = useState<Record<string, PreparedBookFile>>({})
  const filesRef = useRef(files)
  filesRef.current = files
  const pending = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const userAtStart = useRef(userId)

  useEffect(() => () => {
    controller.current?.abort()
    controller.current = null
    filesRef.current = {}
  }, [])
  function close() {
    controller.current?.abort()
    controller.current = null
    filesRef.current = {}
    setFiles({})
    onClose()
  }

  function currentUser() {
    return userAtStart.current === userId && useAuthStore.getState().user?.id === userId
  }

  async function deliver(prepared: Record<string, PreparedBookFile>, signal?: AbortSignal) {
    if (!currentUser()) return
    if (batch) {
      const archive = await createBooksArchive(Object.values(prepared), signal)
      if (signal?.aborted || !currentUser()) return
      const now = new Date()
      const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
      const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
      deliverBlob(archive, `bookdock-books-${date}-${time}-${Object.keys(prepared).length}-books.zip`)
    } else {
      const file = Object.values(prepared)[0]
      if (signal?.aborted || !currentUser()) return
      if (file) deliverBlob(file.blob, file.filename)
    }
    try {
      localStorage.setItem(preferenceKey, JSON.stringify({ format: choice.format, edited }))
    } catch {
      // A completed download does not depend on preference storage.
    }
    close()
  }

  async function prepare(ids: string[]) {
    const targets = ids.map((id) => books.findIndex((book) => book.id === id)).filter((index) => index >= 0)
    const ruleLookupPending = choice.edited && targets.some((index) => requiresRuleLookup(books[index]!) && (ruleQueries[index]?.isPending || ruleQueries[index]?.isFetching))
    if (pending.current || ruleLookupPending || !currentUser()) return
    pending.current = true
    setPreparing(true)
    setError('')
    setProgress(0)
    const abortController = new AbortController()
    controller.current = abortController
    const nextFiles = { ...filesRef.current }
    const failed: string[] = []
    let completed = 0
    try {
      for (const id of ids) {
        if (abortController.signal.aborted || !currentUser()) return
        const bookIndex = books.findIndex((book) => book.id === id)
        const book = books[bookIndex]
        if (!book) continue
        if (choice.edited && requiresRuleLookup(book) && ruleQueries[bookIndex]?.isError) {
          failed.push(id)
          setError(_('library.downloadRulesFailed'))
          completed++
          setProgress(completed)
          continue
        }
        try {
          const request: BookDownloadRequest = {
            id: book.id,
            title: book.title,
            sourceFormat: book.format,
            format: effectiveFormat(book),
            edited: edited && Boolean(hasRules[bookIndex]) && (book.format === 'txt' || effectiveFormat(book) === 'txt'),
          }
          nextFiles[id] = await prepareBookFile(request, abortController.signal)
        } catch (err) {
          if (abortController.signal.aborted) return
          failed.push(id)
          setError(getUserErrorMessage(err, _, 'errors.downloadFailed'))
        }
        completed++
        setProgress(completed)
      }
      if (abortController.signal.aborted || !currentUser()) return
      filesRef.current = nextFiles
      setFiles(nextFiles)
      setFailedIds(failed)
      if (failed.length === 0) await deliver(nextFiles, abortController.signal)
    } catch (err) {
      if (!abortController.signal.aborted) setError(getUserErrorMessage(err, _, 'errors.downloadFailed'))
    } finally {
      if (controller.current === abortController) controller.current = null
      pending.current = false
      setPreparing(false)
    }
  }

  async function deliverSuccessful() {
    if (pending.current) return
    pending.current = true
    setPreparing(true)
    setError('')
    const abortController = new AbortController()
    controller.current = abortController
    try {
      await deliver(filesRef.current, abortController.signal)
    } catch (err) {
      if (!abortController.signal.aborted && currentUser()) setError(getUserErrorMessage(err, _, 'errors.downloadFailed'))
    } finally {
      if (controller.current === abortController) controller.current = null
      pending.current = false
      setPreparing(false)
    }
  }

  const total = books.length
  const failureCount = failedIds.length
  const successCount = Object.keys(files).length
  const idsToPrepare = failureCount > 0 ? failedIds : books.filter((book) => !files[book.id]).map((book) => book.id)
  const ruleLookupPending = choice.edited && idsToPrepare.some((id) => {
    const index = books.findIndex((book) => book.id === id)
    return index >= 0 && requiresRuleLookup(books[index]!) && (ruleQueries[index]?.isPending || ruleQueries[index]?.isFetching)
  })
  const title = batch
    ? _('library.downloadSelectedTitle', { count: books.length })
    : _('library.downloadTitle', { title: books[0]?.title ?? '' })

  return (
    <Modal title={title} size="sm" onClose={close} footer={
      <div className="flex w-full justify-end gap-2">
        <Button variant="secondary" onClick={close}>{_('library.cancel')}</Button>
        {failureCount > 0 && successCount > 0 && (
          <Button variant="secondary" disabled={preparing} onClick={() => void deliverSuccessful()}>{_('library.downloadSuccessCount', { count: successCount })}</Button>
        )}
        <Button disabled={preparing || ruleLookupPending} onClick={() => void (failureCount === 0 && successCount === total && successCount > 0 ? deliverSuccessful() : prepare(idsToPrepare))}>
          {preparing ? (batch ? _('library.downloadProgress', { current: progress, total }) : _('library.downloadPreparing')) : failureCount > 0 ? _('library.retryFailedCount', { count: failureCount }) : _('library.download')}
        </Button>
      </div>
    }>
      <div className="space-y-4">
        {books[0]?.versionLabel && !batch && <p className="text-xs text-stone-500">{books[0].versionLabel}</p>}
        <fieldset disabled={preparing} className="space-y-2">
          <legend className="text-xs text-stone-500">{_('library.downloadFormat')}</legend>
          <div className="flex gap-2">
            {(batch ? ['keep', 'epub', 'txt'] as const : ['epub', 'txt'] as const).map((format) => (
              <button key={format} type="button" aria-pressed={choice.format === format}
                onClick={() => { setChoice({ ...choice, format }); setError(''); setFailedIds([]); filesRef.current = {}; setFiles({}) }}
                className={`flex-1 rounded-xl border px-3 py-2 text-sm transition-colors ${choice.format === format ? 'border-stone-500 bg-stone-100 dark:bg-stone-800' : 'border-stone-200 hover:bg-stone-50 dark:border-stone-700 dark:hover:bg-stone-800'}`}>
                {format === 'keep' ? _('library.downloadKeepFormats') : format.toUpperCase()}
              </button>
            ))}
          </div>
        </fieldset>
        {supportsEdited && (
          <fieldset disabled={preparing} className="space-y-2">
            <legend className="text-xs text-stone-500">{_('library.downloadContent')}</legend>
            <div className="flex gap-4 text-sm">
              {[false, true].map((value) => (
                <label key={String(value)} className="flex items-center gap-2">
                  <input type="radio" name="download-content" checked={edited === value} onChange={() => { setChoice({ ...choice, edited: value }); setError(''); setFailedIds([]); filesRef.current = {}; setFiles({}) }} />
                  {_('library.' + (value ? 'edited' : 'original'))}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {edited && !batch && <p className="text-xs text-stone-500">{_('library.downloadEditedHint')}</p>}
        {rulesFailed && <div role="alert" className="space-y-2 text-sm text-red-600">
          <p>{_('library.downloadRulesFailed')}</p>
          <button type="button" onClick={() => { for (const query of ruleQueries) void query.refetch() }} className="underline">{_('common.retry')}</button>
        </div>}
        {failureCount > 0 && <p role="status" className="text-sm text-stone-600 dark:text-stone-300">{_('library.downloadBatchResult', { succeeded: successCount, failed: failureCount })}</p>}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  )
}
