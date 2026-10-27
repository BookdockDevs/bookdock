import { memo } from 'react'

import { Button } from '@/components/ui/Button'
import { useTranslation } from '@/hooks/useTranslation'

interface ContentEditorHeaderProps {
  title: string
  format: 'txt' | 'epub'
  bookId: string
  dirty: boolean
  changeCount: number
  localStatus: 'pending' | 'saved' | 'failed'
  saving: boolean
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onSave: () => void
  onDiscard: () => void
  onOpenDiff?: () => void
  onDeleteChapter?: () => void
  onSplitAtCursor?: () => void
  onBack?: () => void
}

export const ContentEditorHeader = memo(function ContentEditorHeader({
  title,
  format,
  bookId,
  dirty,
  changeCount,
  localStatus,
  saving,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSave,
  onDiscard,
  onOpenDiff,
  onDeleteChapter,
  onSplitAtCursor,
  onBack,
}: ContentEditorHeaderProps) {
  const _ = useTranslation()

  const handleBack = (e: React.MouseEvent) => {
    e.preventDefault()
    if (onBack) {
      onBack()
      return
    }
    if (dirty) {
      onDiscard()
      return
    }
    if (window.history.length > 1) {
      window.history.back()
    } else {
      window.location.href = '/'
    }
  }

  const backLabel = _('editor.backReading') || '返回阅读'
  const undoLabel = _('editor.undo') || '撤销'
  const redoLabel = _('editor.redo') || '重做'
  const saveLabel = _('editor.save') || '保存'
  const savingLabel = _('editor.saving') || '保存中…'
  const discardLabel = _('editor.discard') || '放弃草稿'

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-stone-200 bg-white/90 px-3 backdrop-blur-md dark:border-stone-800 dark:bg-stone-900/90 sm:px-4">
      {/* Left: Back affordance + Title + Format Capsule + Status badge */}
      <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
        <a
          href={`/books/${encodeURIComponent(bookId)}`}
          onClick={handleBack}
          aria-label={backLabel}
          title={_('editor.backTooltip') || '返回上一页'}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-200/60 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5" />
            <path d="m12 19-7-7 7-7" />
          </svg>
        </a>

        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-sm font-semibold text-stone-800 dark:text-stone-100 sm:text-base">
            {title}
          </h1>

          <span className="shrink-0 rounded-md bg-stone-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:bg-stone-800 dark:text-stone-400">
            {format}
          </span>

          {dirty && (
            <button
              type="button"
              onClick={onOpenDiff}
              disabled={!onOpenDiff}
              title={_('editor.draftTooltip')}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-100/80 px-2.5 py-0.5 text-xs font-medium text-amber-800 transition-all hover:bg-amber-200/80 dark:bg-amber-950/60 dark:text-amber-300 dark:hover:bg-amber-900/80"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse dark:bg-amber-400" />
              <span>{_(localStatus === 'saved' ? 'editor.draftStored' : localStatus === 'failed' ? 'editor.draftNotStored' : 'editor.draftStoring', { count: changeCount })}</span>
            </button>
          )}
        </div>
      </div>

      {/* Right: History controls + Discard + Save button */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        {onSplitAtCursor && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onSplitAtCursor}
            disabled={saving}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-500/10 hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-35 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            title={_('editor.splitAtCursor') || '在光标处拆分'}
            aria-label={_('editor.splitAtCursor') || '在光标处拆分'}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="6" cy="6" r="3" />
              <path d="M8.12 8.12 12 12" />
              <path d="M20 4 8.12 15.88" />
              <circle cx="6" cy="18" r="3" />
              <path d="M14.8 14.8 20 20" />
            </svg>
          </button>
        )}

        {onDeleteChapter && (
          <button
            type="button"
            onClick={onDeleteChapter}
            disabled={saving}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-red-500/10 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-35 dark:text-stone-400 dark:hover:bg-red-500/20 dark:hover:text-red-400"
            title={_('editor.deleteChapter') || '删除章节'}
            aria-label={_('editor.deleteChapter') || '删除章节'}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 6h18" />
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              <line x1="10" x2="10" y1="11" y2="17" />
              <line x1="14" x2="14" y1="11" y2="17" />
            </svg>
          </button>
        )}

        <div className="flex items-center rounded-xl bg-stone-100 p-0.5 dark:bg-stone-800">
          <button
            type="button"
            aria-label={undoLabel}
            title={`${undoLabel} (Ctrl+Z)`}
            disabled={!canUndo || saving}
            onClick={onUndo}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-600 transition-colors hover:bg-white hover:text-stone-900 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-35 dark:text-stone-300 dark:hover:bg-stone-700 dark:hover:text-stone-100"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 7v6h6" />
              <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
            </svg>
          </button>
          <button
            type="button"
            aria-label={redoLabel}
            title={`${redoLabel} (Ctrl+Y)`}
            disabled={!canRedo || saving}
            onClick={onRedo}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-600 transition-colors hover:bg-white hover:text-stone-900 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-35 dark:text-stone-300 dark:hover:bg-stone-700 dark:hover:text-stone-100"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 7v6h-6" />
              <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
            </svg>
          </button>
        </div>

        {dirty && (
          <Button
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={onDiscard}
            className="text-xs text-stone-500 hover:text-red-600 dark:text-stone-400 dark:hover:text-red-400"
          >
            {discardLabel}
          </Button>
        )}

        <Button
          variant="primary"
          size="sm"
          disabled={!dirty || saving}
          onClick={onSave}
          className="shadow-sm"
        >
          {saving ? (
            <span className="flex items-center gap-1.5">
              <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="9" className="opacity-25" stroke="currentColor" strokeWidth="3" />
                <path d="M21 12a9 9 0 0 1-9 9" className="opacity-80" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              <span>{savingLabel}</span>
            </span>
          ) : (
            saveLabel
          )}
        </Button>
      </div>
    </header>
  )
})
