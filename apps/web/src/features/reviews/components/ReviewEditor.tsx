import { lazy, Suspense, useRef, useState } from 'react'

import { toMarkdown } from 'mdast-util-to-markdown'

import {
  CONTENT_FILES_MAX_COUNT, CONTENT_IMAGE_MAX_BYTES,
  reviewNeedsSourceEditor, reviewTextLength,
  REVIEW_BODY_MAX_LENGTH, REVIEW_TITLE_MAX_LENGTH,
  type ContentFile, type Review, type ReviewComposerContext,
} from '@bookdock/shared'

import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import VisibilityControl from '@/components/ui/VisibilityControl'
import ContentUpload from '@/features/content-files/components/ContentUpload'
import { useContentDraft } from '@/features/content-files/hooks/useContentDraft'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'

import { cn } from '@/lib/utils'

import { useSaveReview } from '../hooks/useReviews'
import StarRating from './StarRating'

const ReviewRichEditor = lazy(() => import('./ReviewRichEditor'))

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
  const [toolbarContainer, setToolbarContainer] = useState<HTMLDivElement | null>(null)
  const [rating, setRating] = useState<number | null>(existing?.rating ?? null)
  const [title, setTitle] = useState(existing?.title ?? '')
  const [body, setBody] = useState(existing?.body ?? '')
  // Editing an existing review retains its stored visibility unless the user
  // explicitly picks one: with a stranded source the stored shared choice
  // must survive a body-only edit so recovery can restore shared reads.
  const [visibilityTouched, setVisibilityTouched] = useState(false)
  const [visibility, setVisibility] = useState<'private' | 'shared'>(existing?.visibility ?? composer.defaultVisibility)
  const [bodyFormat, setBodyFormat] = useState<'plain' | 'markdown'>(existing?.bodyFormat ?? 'markdown')
  const [source, setSource] = useState(existing?.bodyFormat === 'plain')
  const [unsupported, setUnsupported] = useState(false)
  const richInsert = useRef<((text: string) => void) | null>(null)
  const unsafeEmbeds = bodyFormat === 'markdown' && reviewNeedsSourceEditor(body)
  const visualAvailable = bodyFormat === 'markdown' && !unsupported && !unsafeEmbeds
  const isSource = source || !visualAvailable

  function insertFile(file: ContentFile) {
    const node = { type: 'image' as const, url: file.url, alt: file.name }
    const markdown = toMarkdown({ type: 'root', children: [{ type: 'paragraph', children: [node] }] }).trimEnd()
    if (!isSource && richInsert.current) richInsert.current(markdown)
    else {
      const position = textareaRef.current?.selectionStart ?? body.length
      setBody((current) => current.slice(0, position) + '\n\n' + markdown + '\n\n' + current.slice(position))
    }
  }
  const draft = useContentDraft({ domain: 'review', bookVersionId, targetId: existing?.id }, insertFile)
  function convertPlain() {
    setBody(toMarkdown({ type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', value: body }] }] }).trimEnd())
    setBodyFormat('markdown')
    setSource(false)
  }

  const canShare = composer.canPublishShared && composer.anchor === 'source'
  const submittable = rating != null || body.trim() !== ''

  function toggleSource() {
    if (isSource) {
      if (visualAvailable) setSource(false)
    } else {
      setSource(true)
    }
  }

  function pickVisibility(next: 'private' | 'shared') {
    setVisibility(next)
    setVisibilityTouched(true)
  }

  const shareHint = composer.anchor === 'private' ? _('review.sharePrivateOnlyHint') : _('review.shareUnavailableHint')

  function handlePasteCapture(event: React.ClipboardEvent) {
    if (bodyFormat !== 'markdown') return
    const target = event.target as HTMLElement
    if (target.tagName === 'INPUT') return

    const items = Array.from(event.clipboardData?.items ?? [])
    const imageItems = items.filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    if (imageItems.length === 0) return

    event.preventDefault()
    event.stopPropagation()

    const remaining = Math.max(0, CONTENT_FILES_MAX_COUNT - draft.entries.length)
    if (imageItems.length > remaining) {
      notify.error({ key: 'contentFiles.tooMany' })
    }

    for (const item of imageItems.slice(0, remaining)) {
      const file = item.getAsFile()
      if (!file) continue
      if (file.size > CONTENT_IMAGE_MAX_BYTES) {
        notify.error({ key: 'contentFiles.tooLarge' })
        continue
      }
      draft.add(file, 'image')
    }
  }

  function handleDropCapture(event: React.DragEvent) {
    if (bodyFormat !== 'markdown') return
    const target = event.target as HTMLElement
    if (target.tagName === 'INPUT') return

    const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.type.startsWith('image/'))
    if (files.length === 0) return

    event.preventDefault()
    event.stopPropagation()

    const remaining = Math.max(0, CONTENT_FILES_MAX_COUNT - draft.entries.length)
    if (files.length > remaining) {
      notify.error({ key: 'contentFiles.tooMany' })
    }

    for (const file of files.slice(0, remaining)) {
      if (file.size > CONTENT_IMAGE_MAX_BYTES) {
        notify.error({ key: 'contentFiles.tooLarge' })
        continue
      }
      draft.add(file, 'image')
    }
  }

  const textLength = reviewTextLength(body, bodyFormat)
  const isOverLimit = body.length > REVIEW_BODY_MAX_LENGTH || textLength > REVIEW_BODY_MAX_LENGTH || title.trim().length > REVIEW_TITLE_MAX_LENGTH

  async function submit() {
    if (!submittable || save.isPending || draft.uploading || isOverLimit) return
    // A private anchor can never publish: coerce rather than erroring late.
    // An untouched edit omits visibility so the server retains the row value.
    const chosen = canShare ? visibility : 'private'
    try {
      await save.mutateAsync({
        bookVersionId,
        reviewId: existing?.id ?? null,
        rating,
        title: title.trim() ? title.trim() : null,
        bodyFormat,
        draftId: draft.draftId,
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

  const uploads = bodyFormat === 'markdown' ? <ContentUpload compact inline disabled={save.isPending} entries={draft.entries} onAdd={draft.add} onRetry={draft.retry} /> : null

  return (
    <Modal
      title={existing ? _('review.editTitle') : _('review.composeTitle')}
      onClose={onClose}
      closeLabel={_('library.cancel')}
      size="wide"
      panelClassName="h-[calc(100dvh-1rem)] sm:h-[min(820px,90dvh)] sm:max-h-[90dvh] sm:max-w-4xl"
      contentClassName="flex flex-col overflow-hidden! px-5! pt-0! pb-0! sm:px-8!"
      footer={
        <div className="flex w-full items-center justify-between gap-3 px-1 text-xs text-stone-500 sm:px-3 dark:text-stone-400">
          {composer.anchor === 'source' ? (
            <VisibilityControl
              value={visibility}
              onChange={pickVisibility}
              canShare={canShare}
              shareHint={shareHint}
              disabled={save.isPending}
              labels={{
                private: _('review.visibilityPrivate'),
                shared: _('review.visibilityShared'),
                aria: _('review.visibilityLabel'),
              }}
            />
          ) : (
            <div />
          )}
          <div className="flex items-center gap-3">
            <span className={cn('shrink-0 tabular-nums', isOverLimit && 'text-red-600 dark:text-red-400')}>
              {textLength} / {REVIEW_BODY_MAX_LENGTH}
            </span>
            <Button size="sm" onClick={() => void submit()} disabled={!submittable || save.isPending || draft.uploading || isOverLimit}>
              {save.isPending ? `${existing ? _('library.save') : _('review.publish')}...` : existing ? _('library.save') : _('review.publish')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-stone-100 py-2 sm:py-2.5 dark:border-stone-800">
          <div className="flex shrink-0 items-center gap-1.5">
            <StarRating value={rating} onChange={setRating} size={18} disabled={save.isPending} allowClear={false} />
            {rating != null && (
              <button type="button" onClick={() => setRating(null)} disabled={save.isPending} className="text-xs text-stone-400 hover:text-stone-600 dark:hover:text-stone-200">
                {_('review.clearRating')}
              </button>
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1">
            <div ref={setToolbarContainer} className="flex min-w-0 flex-1 items-center justify-end gap-1" />
            {isSource && uploads}
            <button
              type="button"
              disabled={save.isPending || (!isSource && !visualAvailable)}
              onClick={toggleSource}
              title={isSource ? _('review.visualEdit') : _('review.sourceEdit')}
              aria-label={isSource ? _('review.visualEdit') : _('review.sourceEdit')}
              aria-pressed={isSource}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                isSource
                  ? 'bg-stone-200 text-stone-900 hover:bg-stone-300 dark:bg-stone-700 dark:text-stone-100 dark:hover:bg-stone-600'
                  : 'text-stone-500 hover:bg-stone-100 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200',
              )}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
            </button>
          </div>
        </div>
        <div
          onPasteCapture={handlePasteCapture}
          onDropCapture={handleDropCapture}
          className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain py-3.5 sm:py-4"
        >
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={REVIEW_TITLE_MAX_LENGTH} disabled={save.isPending} placeholder={_('review.titlePlaceholder')} aria-label={_('review.titleLabel')} className="shrink-0 mb-3 w-full bg-transparent text-lg font-semibold text-stone-900 placeholder:font-normal placeholder:text-stone-400 focus:outline-none sm:text-xl dark:text-stone-100 dark:placeholder:text-stone-500" />
          {bodyFormat === 'plain' && <div className="shrink-0 mb-3 space-y-2"><p className="text-xs text-stone-500">{_('review.plainPreserved')}</p><Button variant="secondary" disabled={save.isPending} onClick={convertPlain}>{_('review.convertMarkdown')}</Button></div>}
          {(unsupported || unsafeEmbeds) && <p role="status" className="shrink-0 mb-3 text-xs text-amber-700 dark:text-amber-400">{_('review.sourcePreserved')}</p>}
          {isSource && <textarea ref={textareaRef} value={body} onChange={(event) => setBody(event.target.value)} maxLength={REVIEW_BODY_MAX_LENGTH} disabled={save.isPending} placeholder={_('review.bodyPlaceholder')} aria-label={_('review.bodyLabel')} className="flex-1 min-h-[300px] w-full resize-none bg-transparent text-base leading-7 text-stone-800 placeholder:text-stone-400 focus:outline-none dark:text-stone-100 dark:placeholder:text-stone-500" />}
          {visualAvailable && <div hidden={isSource} className="flex min-h-0 flex-1 flex-col"><Suspense fallback={<p role="status" className="text-xs text-stone-400">{_('review.editorLoading')}</p>}><ReviewRichEditor body={body} disabled={save.isPending || isSource} onChange={setBody} onUnsupported={() => { setUnsupported(true); setSource(true) }} insertRef={richInsert} toolbarContainer={!isSource ? toolbarContainer : null} toolbarExtras={uploads} /></Suspense></div>}
        </div>
      </div>
    </Modal>
  )
}
