import { cn } from '@/lib/utils'

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Accessible name; falls back to the visible label */
  ariaLabel?: string
  /** Visible label rendered next to the switch */
  label?: string
}

export default function Toggle({ checked, onChange, ariaLabel, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel ?? label}
      onClick={() => onChange(!checked)}
      className={cn(label != null && 'flex items-center gap-2 text-xs text-stone-600 dark:text-stone-300')}
    >
      {/* block + shrink-0 + explicit left anchor on the knob: as a flex item the
          track would otherwise collapse or the knob would drift in tight rows */}
      <span
        className={cn(
          'relative block h-5 w-9 shrink-0 rounded-full transition-colors',
          checked ? 'bg-stone-900 dark:bg-stone-100' : 'bg-stone-200 dark:bg-stone-700',
        )}
      >
        <span
          className={cn(
            'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform dark:bg-stone-900',
            checked && 'translate-x-4',
          )}
        />
      </span>
      {label}
    </button>
  )
}
