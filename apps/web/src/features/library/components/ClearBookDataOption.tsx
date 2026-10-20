import Toggle from '@/components/ui/Toggle'
import { useTranslation } from '@/hooks/useTranslation'

interface ClearBookDataOptionProps {
  checked: boolean
  onChange: (checked: boolean) => void
  deferred?: boolean
}

export default function ClearBookDataOption({ checked, onChange, deferred = false }: ClearBookDataOptionProps) {
  const _ = useTranslation()
  return (
    <div className="mt-3 flex items-start justify-between gap-4 rounded-xl bg-stone-100/70 p-3 text-left dark:bg-stone-800/70">
      <div className="min-w-0">
        <p className="text-sm font-medium text-stone-800 dark:text-stone-200">{_('library.clearUserDataOnRemove')}</p>
        <p className="mt-1 text-xs leading-relaxed text-stone-500 dark:text-stone-400">{_(deferred ? 'library.clearUserDataOnRemoveDescription' : 'library.clearUserDataOnRemoveImmediate')}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} ariaLabel={_('library.clearUserDataOnRemove')} />
    </div>
  )
}
