import { Button } from '@/components/ui/Button'
import { useTranslation } from '@/hooks/useTranslation'

interface SettingsFormActionsProps {
  onCancel: () => void
  cancelDisabled?: boolean
  saveDisabled?: boolean
}

export default function SettingsFormActions({ onCancel, cancelDisabled = false, saveDisabled = false }: SettingsFormActionsProps) {
  const _ = useTranslation()

  return (
    <div className="flex justify-end gap-2 border-t border-stone-100 pt-4 dark:border-stone-800">
      <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={cancelDisabled}>
        {_('library.cancel')}
      </Button>
      <Button type="submit" size="sm" disabled={saveDisabled}>
        {_('library.save')}
      </Button>
    </div>
  )
}
