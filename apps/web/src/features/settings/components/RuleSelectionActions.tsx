import { useTranslation } from '@/hooks/useTranslation'

interface RuleSelectionActionsProps {
  disabled: boolean
  selectedCount: number
  onExport: () => void
  onDelete: () => void
}

export default function RuleSelectionActions({ disabled, selectedCount, onExport, onDelete }: RuleSelectionActionsProps) {
  const _ = useTranslation()
  const inactive = disabled || selectedCount === 0

  return (
    <>
      <button
        type="button"
        disabled={inactive}
        onClick={onExport}
        aria-label={_('settings.ruleExportSelected')}
        title={_('settings.ruleExportSelected')}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 16v4a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-4" />
          <path d="M12 14V3m-5 5 5-5 5 5" />
        </svg>
      </button>
      <button
        type="button"
        disabled={inactive}
        onClick={onDelete}
        aria-label={_('settings.ruleDeleteSelected')}
        title={_('settings.ruleDeleteSelected')}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-red-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-red-950"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <path d="M10 10v8M14 10v8" />
        </svg>
      </button>
    </>
  )
}
