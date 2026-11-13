import { Button } from '@/components/ui/Button'
import { useTranslation } from '@/hooks/useTranslation'

interface MetadataEditorFooterProps {
  canRestoreAll: boolean
  onRestoreAll: () => void
  onCancel: () => void
  onSave: () => void
  saving: boolean
  /** Validation gate (empty title, unresolved version name); saving disables separately. */
  saveDisabled: boolean
}

/**
 * Shared footer for both metadata editors: the catalog version editor and the
 * private book dialog. Restore-all stays a quiet text action on the left; the
 * cancel/save pair is the only primary affordance and stacks on narrow screens.
 */
export default function MetadataEditorFooter({
  canRestoreAll,
  onRestoreAll,
  onCancel,
  onSave,
  saving,
  saveDisabled,
}: MetadataEditorFooterProps) {
  const _ = useTranslation()
  return (
    <div className={`flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:gap-2 ${canRestoreAll ? 'sm:justify-between' : 'sm:justify-end'}`}>
      {canRestoreAll && (
        <button
          type="button"
          onClick={onRestoreAll}
          disabled={saving}
          className="inline-flex items-center gap-1.5 text-xs text-stone-500 transition-colors hover:text-stone-800 disabled:opacity-50 dark:text-stone-400 dark:hover:text-stone-200"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
          <span>{_('library.restoreSourceValues')}</span>
        </button>
      )}
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          {_('library.cancel')}
        </Button>
        <Button onClick={onSave} disabled={saveDisabled || saving}>
          {saving ? `${_('library.save')}...` : _('library.save')}
        </Button>
      </div>
    </div>
  )
}
