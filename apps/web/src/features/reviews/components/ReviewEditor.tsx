import { useRef, useState } from 'react'

import type { Review, ReviewComposerContext } from '@bookdock/shared'

import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { inputClass } from '@/features/library/components/book-detail/ui'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { cn } from '@/lib/utils'

import { useSaveReview } from '../hooks/useReviews'
import ReviewMarkdown from './ReviewMarkdown'
import StarRating from './StarRating'

function wrapSelection(
  textarea: HTMLTextAreaElement | null,
  value: string,
  onChange: (next: string) => void,
  before: string,
  after = '',
  placeholder = '',
  linePrefix = '',
) {
  if (!textarea) return
  const start = textarea.selectionStart ?? value.length
  const end = textarea.selectionEnd ?? value.length
  const selected = value.slice(start, end) || placeholder
  let next: string
  let caret: [number, number]
  if (linePrefix) {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    const insert = value.slice(lineStart, start).startsWith(linePrefix)
      ? value.slice(lineStart, start).slice(linePrefix.length)
      : `${linePrefix}${value.slice(lineStart, start)}`
    next = `${value.slice(0, lineStart)}${insert}${value.slice(start)}`
    const delta = insert.length - (start - lineStart)
    caret = [start + delta, end + delta]
  } else {
    next = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`
    caret = [start + before.length, start + before.length + selected.length]
  }
  onChange(next)
  requestAnimationFrame(() => {
    textarea.focus()
    textarea.setSelectionRange(caret[0], caret[1])
  })
}

export default function ReviewEditor({
  bookVersionId,
  existing,
  composer,
  onClose,
  onSaved,
}: {
  bookVersionId: string
  existing: Review | null
  composer: ReviewComposerContext
  onClose: () => void
  onSaved?: () => void
}) {
  const _ = useTranslation()
  const save = useSaveReview()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [rating, setRating] = useState<number | null>(existing?.rating ?? null)
  const [body, setBody] = useState(existing?.body ?? '')
  const [visibility, setVisibility] = useState<'private' | 'shared'>(existing?.visibility ?? composer.defaultVisibility)
  // Editing an existing review retains its stored visibility unless the user
  // explicitly picks one: with a stranded source the stored shared choice
  // must survive a body-only edit so recovery can restore shared reads.
  const [visibilityTouched, setVisibilityTouched] = useState(false)
  const [preview, setPreview] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('https://')
  const savedSelection = useRef<{ start: number; end: number } | null>(null)

  const canShare = composer.canPublishShared && composer.anchor === 'source'
  const submittable = rating != null || body.trim() !== ''

  function pickVisibility(next: 'private' | 'shared') {
    setVisibility(next)
    setVisibilityTouched(true)
  }

  function openLinkDialog() {
    const textarea = textareaRef.current
    savedSelection.current = textarea
      ? { start: textarea.selectionStart ?? body.length, end: textarea.selectionEnd ?? body.length }
      : null
    setLinkUrl('https://')
    setLinkOpen(true)
  }

  function confirmLink() {
    const safe = /^https?:\/\//i.test(linkUrl.trim()) ? linkUrl.trim() : ''
    if (!safe) {
      notify.error({ key: 'review.linkUnsafeNotice' })
      return
    }
    const textarea = textareaRef.current
    if (textarea && savedSelection.current) {
      textarea.focus()
      textarea.setSelectionRange(savedSelection.current.start, savedSelection.current.end)
    }
    wrapSelection(textarea, body, setBody, '[', `](${safe})`, _('review.linkTextPlaceholder'))
    setLinkOpen(false)
  }

  async function submit() {
    if (!submittable || save.isPending) return
    // A private anchor can never publish: coerce rather than erroring late.
    // An untouched edit omits visibility so the server retains the row value.
    const chosen = canShare ? visibility : 'private'
    try {
      await save.mutateAsync({
        bookVersionId,
        reviewId: existing?.id ?? null,
        rating,
        body: body.trim() ? body : null,
        visibility: !existing || visibilityTouched ? chosen : undefined,
      })
      notify.success({ key: existing ? 'review.updatedNotice' : 'review.publishedNotice' })
      onSaved?.()
      onClose()
    } catch (error) {
      notify.error(getUserErrorNotification(error, 'review.saveFailed'))
    }
  }

  const tool = 'flex h-7 w-7 items-center justify-center rounded-md text-xs font-semibold text-stone-500 transition-colors hover:bg-stone-200/60 hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-stone-500 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200 dark:disabled:hover:bg-transparent dark:disabled:hover:text-stone-400'

  return (
    <>
      <Modal
        title={existing ? _('review.editTitle') : _('review.composeTitle')}
        onClose={onClose}
        closeLabel={_('library.cancel')}
        size="xl"
        footer={
          <div className="flex w-full items-center justify-between gap-2">
            <div className="flex items-center gap-1" role="radiogroup" aria-label={_('review.visibilityLabel')}>
              <button
                type="button"
                role="radio"
                aria-checked={visibility === 'private'}
                onClick={() => pickVisibility('private')}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
                  visibility === 'private'
                    ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                    : 'bg-stone-100 text-stone-500 hover:text-stone-700 dark:bg-stone-800 dark:text-stone-400',
                )}
              >
                {_('review.visibilityPrivate')}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={visibility === 'shared'}
                disabled={!canShare}
                title={!canShare ? (composer.anchor === 'private' ? _('review.sharePrivateOnlyHint') : _('review.shareUnavailableHint')) : undefined}
                onClick={() => canShare && pickVisibility('shared')}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                  visibility === 'shared'
                    ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                    : 'bg-stone-100 text-stone-500 hover:text-stone-700 dark:bg-stone-800 dark:text-stone-400',
                )}
              >
                {_('review.visibilityShared')}
              </button>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
                {_('library.cancel')}
              </Button>
              <Button onClick={() => void submit()} disabled={!submittable || save.isPending}>
                {save.isPending ? `${existing ? _('library.save') : _('review.publish')}...` : existing ? _('library.save') : _('review.publish')}
              </Button>
            </div>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <StarRating value={rating} onChange={setRating} disabled={save.isPending} />
            {rating == null && <span className="text-[11px] text-stone-400 dark:text-stone-500">{_('review.ratingOptionalHint')}</span>}
          </div>

          <div className="flex items-center gap-1 border-b border-stone-200/70 pb-2 dark:border-stone-800/70">
            <button type="button" disabled={preview} title={_('review.formatBold')} aria-label={_('review.formatBold')} className={tool} onClick={() => wrapSelection(textareaRef.current, body, setBody, '**', '**', _('review.formatPlaceholder'))}>
              <span className="font-bold">B</span>
            </button>
            <button type="button" disabled={preview} title={_('review.formatItalic')} aria-label={_('review.formatItalic')} className={tool} onClick={() => wrapSelection(textareaRef.current, body, setBody, '*', '*', _('review.formatPlaceholder'))}>
              <span className="italic">I</span>
            </button>
            <button type="button" disabled={preview} title={_('review.formatQuote')} aria-label={_('review.formatQuote')} className={tool} onClick={() => wrapSelection(textareaRef.current, body, setBody, '', '', '', '> ')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10 8H6a4 4 0 0 0-4 4v6h8v-8a2 2 0 0 0 0-2zm12 0h-4a4 4 0 0 0-4 4v6h8v-8a2 2 0 0 0 0-2z" opacity="0.9" /></svg>
            </button>
            <button type="button" disabled={preview} title={_('review.formatList')} aria-label={_('review.formatList')} className={tool} onClick={() => wrapSelection(textareaRef.current, body, setBody, '', '', '', '- ')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><circle cx="4" cy="6" r="1" fill="currentColor" /><circle cx="4" cy="12" r="1" fill="currentColor" /><circle cx="4" cy="18" r="1" fill="currentColor" /></svg>
            </button>
            <button type="button" disabled={preview} title={_('review.formatOrderedList')} aria-label={_('review.formatOrderedList')} className={tool} onClick={() => wrapSelection(textareaRef.current, body, setBody, '', '', '', '1. ')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><line x1="10" y1="6" x2="21" y2="6" /><line x1="10" y1="12" x2="21" y2="12" /><line x1="10" y1="18" x2="21" y2="18" /><path d="M4 6h1v4M4 10h2M4 12l2 2-2 2M4 18h2" /></svg>
            </button>
            <button
              type="button"
              disabled={preview}
              title={_('review.formatLink')}
              aria-label={_('review.formatLink')}
              className={tool}
              onClick={openLinkDialog}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
            </button>
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                aria-pressed={preview}
                onClick={() => setPreview((v) => !v)}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
                  preview ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900' : 'bg-stone-100 text-stone-500 hover:text-stone-700 dark:bg-stone-800 dark:text-stone-400',
                )}
              >
                {_('review.preview')}
              </button>
            </div>
          </div>

          {preview ? (
            <div className="max-h-64 min-h-32 overflow-y-auto rounded-lg border border-stone-200/70 bg-stone-50/50 p-3 dark:border-stone-800/70 dark:bg-stone-900/30">
              {body.trim() ? (
                <ReviewMarkdown body={body} format="markdown" />
              ) : (
                <p className="text-xs text-stone-400 dark:text-stone-500">{_('review.previewEmpty')}</p>
              )}
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={20000}
              rows={7}
              disabled={save.isPending}
              placeholder={_('review.bodyPlaceholder')}
              aria-label={_('review.bodyLabel')}
              className="max-h-64 min-h-32 w-full resize-y overflow-y-auto rounded-lg border border-stone-200/70 bg-transparent p-3 text-sm leading-relaxed placeholder:text-stone-400 focus:outline-2 focus:outline-stone-400 dark:border-stone-800/70 dark:placeholder:text-stone-500"
            />
          )}
          {!submittable && (
            <p className="text-[11px] text-stone-400 dark:text-stone-500">{_('review.requiredHint')}</p>
          )}
        </div>
      </Modal>
      {linkOpen && (
        <Modal
          title={_('review.formatLink')}
          onClose={() => setLinkOpen(false)}
          closeLabel={_('library.cancel')}
          size="sm"
          footer={
            <div className="flex w-full items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => setLinkOpen(false)}>
                {_('library.cancel')}
              </Button>
              <Button onClick={confirmLink}>
                {_('review.linkConfirm')}
              </Button>
            </div>
          }
        >
          <label className="block min-w-0">
            <span className="mb-1.5 block text-xs font-medium text-stone-500 dark:text-stone-400">
              {_('review.linkUrlLabel')}
            </span>
            <input
              autoFocus
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  confirmLink()
                }
              }}
              placeholder="https://"
              aria-label={_('review.linkUrlLabel')}
              inputMode="url"
              className={inputClass}
            />
          </label>
        </Modal>
      )}
  </>
  )
}
