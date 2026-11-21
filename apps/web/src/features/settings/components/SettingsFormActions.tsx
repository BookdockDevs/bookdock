import { Button } from '@/components/ui/Button'
import { useTranslation } from '@/hooks/useTranslation'

interface SettingsFormActionsProps {
  onCancel: () => void
  cancelDisabled?: boolean
  saveDisabled?: boolean
  /** In-flight submission: blocks both buttons and swaps the save label, like SegmentedControl's pending/disabled split. */
  pending?: boolean
}

export default function SettingsFormActions({ onCancel, cancelDisabled = false, saveDisabled = false, pending = false }: SettingsFormActionsProps) {
  const _ = useTranslation()

  return (
    <div className="flex justify-end gap-2 border-t border-(--bd-divider) pt-4">
      <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={cancelDisabled || pending}>
        {_('library.cancel')}
      </Button>
      <Button type="submit" size="sm" disabled={saveDisabled || pending}>
        {_(pending ? 'passwordInput.saving' : 'library.save')}
      </Button>
    </div>
  )
}
