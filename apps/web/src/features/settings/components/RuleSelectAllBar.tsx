import { useTranslation } from '@/hooks/useTranslation'

interface RuleSelectAllBarProps {
  disabled: boolean
  allSelected: boolean
  indeterminate: boolean
  selectedCount: number
  onToggleAll: (checked: boolean) => void
  /** Overrides the default "全选" label (e.g. the theme library's "全选") */
  label?: string
  /** Overrides the default "已选 N 条" text when the list counts items, not rules */
  countLabel?: string
}

export default function RuleSelectAllBar({
  disabled,
  allSelected,
  indeterminate,
  selectedCount,
  onToggleAll,
  label,
  countLabel,
}: RuleSelectAllBarProps) {
  const _ = useTranslation()
  return (
    <div className="flex items-center justify-between gap-3 border-b border-stone-100 py-2.5 text-xs text-stone-500 dark:border-stone-800 dark:text-stone-400">
      <label className="flex cursor-pointer items-center gap-2 font-medium text-stone-600 dark:text-stone-300">
        <input
          type="checkbox"
          checked={allSelected}
          ref={(node) => { if (node) node.indeterminate = indeterminate }}
          disabled={disabled}
          onChange={(event) => onToggleAll(event.target.checked)}
          className="h-4 w-4 shrink-0 accent-stone-700 dark:accent-stone-300" />
        {label ?? _('settings.ruleSelectAll')}
      </label>
      <span className="shrink-0 tabular-nums">{countLabel ?? _('settings.ruleSelectedCount', { count: selectedCount })}</span>
    </div>
  )
}
