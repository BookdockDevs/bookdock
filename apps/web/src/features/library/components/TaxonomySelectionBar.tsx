import type { ShelfListItem } from '@bookdock/shared'

import { Button } from '@/components/ui/Button'
import { useTranslation } from '@/hooks/useTranslation'

export type TaxonomySelectionAction = 'pin' | 'unpin' | 'hide' | 'show' | 'delete'

interface TaxonomySelectionBarProps {
  rows: Pick<ShelfListItem, 'id' | 'pinned' | 'hidden'>[]
  pending: boolean
  canManage: boolean
  canSelectAll: boolean
  onSelectAll: () => void
  onClear: () => void
  onAction: (action: TaxonomySelectionAction) => void
}

export default function TaxonomySelectionBar({ rows, pending, canManage, canSelectAll, onSelectAll, onClear, onAction }: TaxonomySelectionBarProps) {
  const _ = useTranslation()
  const actions: { action: TaxonomySelectionAction; label: string; path: string; available: boolean }[] = [
    { action: 'pin', label: 'library.pin', path: 'M12 17v5M5 16h14l-4-6V4H9v6z', available: rows.some((row) => !row.pinned) },
    { action: 'unpin', label: 'library.unpin', path: 'M12 17v5M5 16h14l-4-6V4H9v6z', available: rows.some((row) => row.pinned) },
    { action: 'hide', label: 'library.hide', path: 'M3 3l18 18M10.7 5.1A11 11 0 0 1 12 5c7 0 10 7 10 7a13 13 0 0 1-3 4M6.2 6.2C3.5 8 2 12 2 12s3 7 10 7a10 10 0 0 0 4.2-.8', available: rows.some((row) => !row.hidden) },
    { action: 'show', label: 'library.show', path: 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0', available: rows.some((row) => row.hidden) },
    { action: 'delete', label: 'library.delete', path: 'M3 6h18M8 6V4h8v2M5 6l1 14h12l1-14M10 10v6m4-6v6', available: rows.length > 0 },
  ]
  return <div data-toast-obstacle="" className="pointer-events-none fixed inset-x-0 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 flex justify-center select-none sm:bottom-5 md:left-60">
    <div className="pointer-events-auto relative flex w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] items-center rounded-2xl border border-stone-200/90 bg-white/95 p-1 shadow-2xl shadow-stone-900/10 backdrop-blur-xl animate-selection-bar-in sm:w-auto sm:max-w-[calc(100vw-1rem)] md:max-w-[calc(100vw-16rem)] dark:border-stone-700/80 dark:bg-stone-900/95">
      <div role="toolbar" aria-label={_('library.taxonomySelectionActions')} aria-busy={pending} className="flex w-full items-center gap-1.5 overflow-x-auto py-1 pl-3 pr-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:w-auto">
        <span className="shrink-0 rounded-md bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-800 dark:bg-stone-800 dark:text-stone-200">{_('library.taxonomySelectionCount', { count: rows.length })}</span>
        <div className="h-4 w-px shrink-0 bg-stone-200 dark:bg-stone-700" />
        <Button variant="ghost" size="sm" className="shrink-0 whitespace-nowrap" disabled={pending || !canSelectAll} onClick={onSelectAll}>{_('library.taxonomySelectAll')}</Button>
        {canManage && actions.filter((action) => action.available).map(({ action, label, path }) => <Button key={action} variant={action === 'delete' ? 'danger' : 'ghost'} size="sm" className="shrink-0 gap-1.5 whitespace-nowrap" disabled={pending} onClick={() => onAction(action)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>
          {_(label)}
        </Button>)}
        <div className="h-4 w-px shrink-0 bg-stone-200 dark:bg-stone-700" />
        <button type="button" disabled={pending} onClick={onClear} aria-label={_('library.clearSelection')} title={_('library.clearSelection')} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>
    </div>
  </div>
}
