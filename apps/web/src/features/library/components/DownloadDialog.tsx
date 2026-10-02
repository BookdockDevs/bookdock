import { useRef, useState } from 'react'

import type { BookFormat } from '@bookdock/shared'

import { useBookReplacements } from '@/api/hooks/useReplacements'
import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorMessage } from '@/lib/error-message'

import { downloadBook, downloadEditedTxt, downloadEpub, downloadOriginalTxt } from '../download'

interface DownloadDialogProps {
  bookId: string
  title: string
  sourceFormat: BookFormat
  versionLabel?: string
  userId: string
  onClose: () => void
}

export default function DownloadDialog({ bookId, title, sourceFormat, versionLabel, userId, onClose }: DownloadDialogProps) {
  const _ = useTranslation()
  const preferenceKey = `bd-download-choice:${userId}`
  const [choice, setChoice] = useState<{ format: 'epub' | 'txt'; edited: boolean }>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(preferenceKey) ?? 'null')
      if (saved?.format === 'epub' || saved?.format === 'txt') return { format: saved.format, edited: saved.edited === true }
    } catch {
      // Device storage is optional.
    }
    return { format: 'epub', edited: false }
  })
  const rules = useBookReplacements(bookId)
  const hasRules = (rules.data?.data ?? []).some((rule) => rule.effectiveEnabled ?? rule.enabled)
  const canEdit = hasRules && (sourceFormat === 'txt' || choice.format === 'txt')
  const edited = choice.edited && canEdit
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)

  async function handleDownload() {
    if (pending.current) return
    pending.current = true
    setPreparing(true)
    setError('')
    try {
      if (choice.format === 'epub') {
        if (sourceFormat === 'epub') await downloadBook(bookId, title)
        else await downloadEpub(bookId, title, { plain: !edited })
      } else if (edited) await downloadEditedTxt(bookId, title)
      else await downloadOriginalTxt(bookId, title)
      try {
        localStorage.setItem(preferenceKey, JSON.stringify({ format: choice.format, edited }))
      } catch {
        // A completed download does not depend on preference storage.
      }
      onClose()
    } catch (err) {
      setError(getUserErrorMessage(err, _, 'errors.downloadFailed'))
    } finally {
      pending.current = false
      setPreparing(false)
    }
  }

  return (
    <Modal title={_('library.downloadTitle', { title })} size="sm" onClose={() => { if (!pending.current) onClose() }} footer={
      <div className="flex w-full justify-end gap-2">
        <Button variant="secondary" disabled={preparing} onClick={onClose}>{_('library.cancel')}</Button>
        <Button disabled={preparing || rules.isPending || rules.isError} onClick={() => void handleDownload()}>
          {_(preparing ? 'library.downloadPreparing' : 'library.download')}
        </Button>
      </div>
    }>
      <div className="space-y-4">
        {versionLabel && <p className="text-xs text-stone-500">{versionLabel}</p>}
        <fieldset disabled={preparing} className="space-y-2">
          <legend className="text-xs text-stone-500">{_('library.downloadFormat')}</legend>
          <div className="flex gap-2">
            {(['epub', 'txt'] as const).map((format) => (
              <button key={format} type="button" aria-pressed={choice.format === format}
                onClick={() => { setChoice({ ...choice, format }); setError('') }}
                className={`flex-1 rounded-xl border px-3 py-2 text-sm transition-colors ${choice.format === format ? 'border-stone-500 bg-stone-100 dark:bg-stone-800' : 'border-stone-200 hover:bg-stone-50 dark:border-stone-700 dark:hover:bg-stone-800'}`}>
                {format.toUpperCase()}
              </button>
            ))}
          </div>
        </fieldset>
        {canEdit && (
          <fieldset disabled={preparing} className="space-y-2">
            <legend className="text-xs text-stone-500">{_('library.downloadContent')}</legend>
            <div className="flex gap-4 text-sm">
              {[false, true].map((value) => (
                <label key={String(value)} className="flex items-center gap-2">
                  <input type="radio" name="download-content" checked={edited === value} onChange={() => { setChoice({ ...choice, edited: value }); setError('') }} />
                  {_('library.' + (value ? 'edited' : 'original'))}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {edited && <p className="text-xs text-stone-500">{_('library.downloadEditedHint')}</p>}
        {rules.isError && <div role="alert" className="space-y-2 text-sm text-red-600">
          <p>{_('library.downloadRulesFailed')}</p>
          <button type="button" onClick={() => void rules.refetch()} className="underline">{_('common.retry')}</button>
        </div>}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  )
}
