import { cn } from '@/lib/utils'

interface ToggleProps {
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
  /** Accessible name; falls back to the visible label */
  ariaLabel?: string
  /** Visible label rendered next to the switch */
  label?: string
}

export default function Toggle({ checked, disabled, onChange, ariaLabel, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel ?? label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'inline-flex shrink-0 items-center justify-center disabled:cursor-not-allowed disabled:opacity-50',
        label != null && 'gap-2 text-xs text-stone-600 dark:text-stone-300',
      )}
    >
      {/* block + shrink-0 + explicit left anchor on the knob: as a flex item the
          track would otherwise collapse or the knob would drift in tight rows */}
      <span
        className={cn(
          'relative block h-5 w-9 shrink-0 rounded-full transition-colors',
          checked ? 'bg-(--bd-toggle-on)' : 'bg-(--bd-toggle-off)',
        )}
      >
        <span
          className={cn(
            'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-(--bd-toggle-knob) shadow-sm transition-transform',
            checked && 'translate-x-4',
          )}
        />
      </span>
      {label}
    </button>
  )
}
