import { useCallback, useEffect, useMemo, useState } from 'react'

import type { TextReplacementRes } from '@bookdock/shared'

import { useBookReplacements, useDeleteReplacement } from '@/api/hooks/useReplacements'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'

import ReplacementForm from '../../settings/components/ReplacementForm'
import BookReplacementsSection from '../../library/components/BookReplacementsSection'
import Modal from '@/components/ui/Modal'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { useReaderApi } from '../hooks/useReaderApi'
import { useReaderState } from '../state/reader-state'

interface BookReplacementsDialogProps {
  bookId: string
  onClose: () => void
}

type FormState = { mode: 'create' } | { mode: 'edit'; rule: TextReplacementRes } | null

// Match counts are expensive to (re)compute for big books; keying by
// bookId + rule signature means reopening the dialog or toggling a rule
// never re-walks the book (a rule edit changes the signature and recomputes).
const countCache = new Map<string, { counts: Record<string, number> }>()

export default function BookReplacementsDialog({ bookId, onClose }: BookReplacementsDialogProps) {
  const _ = useTranslation()
  const { renderer } = useReaderApi()
  const { data } = useBookReplacements(bookId)
  const deleteReplacement = useDeleteReplacement()
  const invalidIds = useReaderState((s) => s.invalidReplacementIds)
  const tocItems = useReaderState((s) => s.tocItems)
  const pointPatches = useMemo(
    () => (data?.data ?? []).filter((r) => r.matchType === 'point'),
    [data],
  )
  // Per-rule match counts ("N 处"): computed by the renderer over the whole
  // book, re-run only when the matching fields change (a toggle refetch keeps
  // the same signature and must not spin the counts again).
  const patternRules = useMemo(
    () => (data?.data ?? []).filter((r) => r.matchType === 'pattern' && r.id),
    [data],
  )
  const countSignature = useMemo(
    () => JSON.stringify(patternRules.map((r) => [r.id, r.pattern, r.replacement, r.isRegex, r.applyTo])),
    [patternRules],
  )
  const [counts, setCounts] = useState<Record<string, number>>({})
  useEffect(() => {
    let cancelled = false
    const cacheKey = `${bookId}|${countSignature}`
    const cached = countCache.get(cacheKey)
    if (cached) {
      setCounts(cached.counts)
      return
    }
    if (!patternRules.length) {
      setCounts({})
      return
    }
    void renderer?.countReplacementMatches(patternRules)
      .then((c) => {
        if (cancelled) return
        setCounts(c)
        countCache.set(cacheKey, { counts: c })
      })
      .catch(() => { if (!cancelled) setCounts({}) })
    return () => { cancelled = true }
  }, [renderer, bookId, countSignature, patternRules])

  // "N 处" only matters for rules that are actually effective in this book:
  // a global rule switched off here (or a disabled rule) shows no count —
  // the counting itself stays signature-cached so toggles never re-walk.
  const effectiveCounts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const r of patternRules) {
      if ((r.effectiveEnabled ?? r.enabled) && counts[r.id] !== undefined) out[r.id] = counts[r.id]
    }
    return out
  }, [patternRules, counts])

  // Point patches read in TOC order (chapter context), ties by creation time
  const chapterIndex = useMemo(() => {
    const map = new Map<string, number>()
    tocItems.forEach((t, i) => { if (!map.has(t.href)) map.set(t.href, i) })
    return map
  }, [tocItems])
  const chapterOf = useCallback(
    (href: string | null) => (href ? tocItems.find((t) => t.href === href)?.label ?? null : null),
    [tocItems],
  )
  const sortedPoints = useMemo(() => [...pointPatches].sort((a, b) =>
    ((chapterIndex.get(a.spineHref ?? '') ?? Number.MAX_SAFE_INTEGER)
      - (chapterIndex.get(b.spineHref ?? '') ?? Number.MAX_SAFE_INTEGER))
    || a.createdAt - b.createdAt,
  ), [pointPatches, chapterIndex])

  const [form, setForm] = useState<FormState>(null)
  const [pendingDelete, setPendingDelete] = useState<TextReplacementRes | null>(null)

  function confirmDelete() {
    if (!pendingDelete) return
    deleteReplacement.mutate(pendingDelete.id, {
      onSuccess: () => { if (form?.mode === 'edit' && form.rule.id === pendingDelete.id) setForm(null) },
      onError: (err) => notify.error(getUserErrorNotification(err, 'errors.deleteFailed')),
    })
    setPendingDelete(null)
  }

  function onDelete(rule: TextReplacementRes) {
    setPendingDelete(rule)
  }

  return (
    // data-settings-toggle: this dialog is portaled to body, so it lives
    // OUTSIDE the SettingsPopover DOM — without the ignore flag the popover's
    // capture-phase document click handler would treat every interaction
    // inside the dialog as a click outside and close itself (unmounting the
    // dialog along with it). Same mechanism as the preset context menu.
    <>
      <Modal
        title={form
          ? _(form.mode === 'create' ? 'settings.replacementsNew' : 'settings.replacementsEdit')
          : _('reader.replacements')}
        // The X always closes; in form mode that means "back to the list"
        onClose={() => (form ? setForm(null) : onClose())}
        containerProps={{ 'data-settings-toggle': '' }}
        actions={!form && (
          <button
            type="button"
            onClick={() => setForm({ mode: 'create' })}
            aria-label={_('settings.replacementsNew')}
            title={_('settings.replacementsNew')}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        )}
      >
        {form ? (
          <ReplacementForm
            bookId={bookId}
            initial={form.mode === 'edit' ? form.rule : null}
            onDone={() => setForm(null)}
          />
        ) : (
          <BookReplacementsSection
            bookId={bookId}
            counts={effectiveCounts}
            points={sortedPoints}
            chapterOf={chapterOf}
            invalidIds={invalidIds}
            onEdit={(rule) => setForm({ mode: 'edit', rule })}
            onDelete={onDelete}
          />
        )}
      </Modal>
      {pendingDelete && (
        <ConfirmDialog
          title={_('settings.confirmDeleteTitle')}
          message={_('settings.replacementsDeleteConfirm', { name: pendingDelete.name?.trim() || pendingDelete.pattern || _('library.unknown') })}
          confirmLabel={_('settings.confirmDeleteAction')}
          onConfirm={confirmDelete}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </>
  )
}
