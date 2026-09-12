import { useTranslation } from '@/hooks/useTranslation'

interface EditModeButtonProps {
  active: boolean
  disabled?: boolean
  activeLabel?: string
  onClick: () => void
}

export default function EditModeButton({ active, disabled = false, activeLabel, onClick }: EditModeButtonProps) {
  const _ = useTranslation()
  const label = active ? activeLabel ?? _('settings.editModeExit') : _('settings.editModeEnter')

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${active
        ? 'bg-stone-100 text-stone-800 dark:bg-stone-800 dark:text-stone-100'
        : 'text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200'}`}
    >
      {active ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m5 12 4 4L19 6" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 17.5V20h2.5L19 7.5 16.5 5 4 17.5Z" />
          <path d="m15 6.5 2.5 2.5" />
        </svg>
      )}
    </button>
  )
}
