import { lazy, Suspense, useRef, useState } from 'react'

import { toMarkdown } from 'mdast-util-to-markdown'

import { reviewNeedsSourceEditor, type ContentFile, type Review, type ReviewComposerContext } from '@bookdock/shared'

import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import ContentUpload from '@/features/content-files/components/ContentUpload'
import { useContentDraft } from '@/features/content-files/hooks/useContentDraft'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { cn } from '@/lib/utils'

import { useSaveReview } from '../hooks/useReviews'
import ReviewMarkdown from './ReviewMarkdown'
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
  const [rating, setRating] = useState<number | null>(existing?.rating ?? null)
  const [body, setBody] = useState(existing?.body ?? '')
  const [visibility, setVisibility] = useState<'private' | 'shared'>(existing?.visibility ?? composer.defaultVisibility)
  // Editing an existing review retains its stored visibility unless the user
  // explicitly picks one: with a stranded source the stored shared choice
  // must survive a body-only edit so recovery can restore shared reads.
  const [visibilityTouched, setVisibilityTouched] = useState(false)
  const [preview, setPreview] = useState(false)
  const [bodyFormat, setBodyFormat] = useState<'plain' | 'markdown'>(existing?.bodyFormat ?? 'markdown')
  const [source, setSource] = useState(existing?.bodyFormat === 'plain')
  const [unsupported, setUnsupported] = useState(false)
  const richInsert = useRef<((text: string) => void) | null>(null)
  function insertFile(file: ContentFile) {
    const node = file.kind === 'image'
      ? { type: 'image' as const, url: file.url, alt: file.name }
      : { type: 'link' as const, url: file.url, children: [{ type: 'text' as const, value: file.name }] }
    const markdown = toMarkdown({ type: 'root', children: [{ type: 'paragraph', children: [node] }] }).trimEnd()
    if (!source && !preview && richInsert.current) richInsert.current(markdown)
    else {
      const position = textareaRef.current?.selectionStart ?? body.length
      setBody((current) => current.slice(0, position) + '\n\n' + markdown + '\n\n' + current.slice(position))
    }
  }
  const draft = useContentDraft({ domain: 'review', bookVersionId, targetId: existing?.id }, insertFile)
  const unsafeEmbeds = bodyFormat === 'markdown' && reviewNeedsSourceEditor(body)
  const rawMode = source || unsupported || unsafeEmbeds || bodyFormat === 'plain'
  function convertPlain() {
    setBody(toMarkdown({ type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', value: body }] }] }).trimEnd())
    setBodyFormat('markdown')
    setSource(false)
  }

  const canShare = composer.canPublishShared && composer.anchor === 'source'
  const submittable = rating != null || body.trim() !== ''

  function pickVisibility(next: 'private' | 'shared') {
    setVisibility(next)
    setVisibilityTouched(true)
  }

  async function submit() {
    if (!submittable || save.isPending || draft.uploading || body.length > 20000) return
    // A private anchor can never publish: coerce rather than erroring late.
    // An untouched edit omits visibility so the server retains the row value.
    const chosen = canShare ? visibility : 'private'
    try {
      await save.mutateAsync({
        bookVersionId,
        reviewId: existing?.id ?? null,
        rating,
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

  return (
    <>
      <Modal
        title={existing ? _('review.editTitle') : _('review.composeTitle')}
        onClose={onClose}
        closeLabel={_('library.cancel')}
        size="wide"
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
              <Button onClick={() => void submit()} disabled={!submittable || save.isPending || draft.uploading || body.length > 20000}>
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

          <div className="flex flex-wrap items-center gap-2">
            {bodyFormat === 'plain' ? <Button variant="secondary" disabled={save.isPending} onClick={convertPlain}>{_('review.convertMarkdown')}</Button> : <Button variant="secondary" disabled={save.isPending || unsupported || unsafeEmbeds} onClick={() => setSource((value) => !value)}>{_(rawMode ? 'review.visualEdit' : 'review.sourceEdit')}</Button>}
            <Button variant="secondary" onClick={() => setPreview((value) => !value)}>{_(preview ? 'review.returnEdit' : 'review.preview')}</Button>
            <span className="ml-auto text-xs text-stone-400">{body.length} / 20000</span>
          </div>
          {bodyFormat === 'plain' && <p className="text-xs text-stone-500">{_('review.plainPreserved')}</p>}
          {(unsupported || unsafeEmbeds) && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">{_('review.sourcePreserved')}</p>}
          {preview ? (
            <div className="max-h-96 min-h-48 overflow-auto rounded-lg border border-stone-200 p-3 dark:border-stone-800">
              {body.trim() ? <ReviewMarkdown body={body} format={bodyFormat} /> : <p className="text-xs text-stone-400">{_('review.previewEmpty')}</p>}
            </div>
          ) : null}
          {!preview && rawMode && (
            <textarea ref={textareaRef} value={body} onChange={(event) => setBody(event.target.value)} maxLength={20000} rows={10} disabled={save.isPending} placeholder={_('review.bodyPlaceholder')} aria-label={_('review.bodyLabel')} className="max-h-96 min-h-48 w-full resize-y overflow-auto rounded-lg border border-stone-200 bg-transparent p-3 text-sm leading-relaxed focus:outline-2 focus:outline-stone-400 dark:border-stone-800" />
          )}
          {!rawMode && (
            <div hidden={preview}>
              <Suspense fallback={<p role="status" className="text-xs text-stone-400">{_('review.editorLoading')}</p>}>
                <ReviewRichEditor body={body} disabled={save.isPending || preview} onChange={setBody} onUnsupported={() => { setUnsupported(true); setSource(true) }} insertRef={richInsert} />
              </Suspense>
            </div>
          )}
          {bodyFormat === 'markdown' && <ContentUpload attachments disabled={save.isPending} entries={draft.entries} onAdd={draft.add} onRetry={draft.retry} />}
          {!submittable && (
            <p className="text-[11px] text-stone-400 dark:text-stone-500">{_('review.requiredHint')}</p>
          )}
        </div>
      </Modal>
    </>
  )
}
