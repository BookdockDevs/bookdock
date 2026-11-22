import { cn } from '@/lib/utils'

interface ToggleProps {
  checked: boolean
  disabled?: boolean
  busy?: boolean
  dimOnDisabled?: boolean
  size?: 'sm' | 'md'
  onChange: (checked: boolean) => void
  /** Accessible name; falls back to the visible label */
  ariaLabel?: string
  /** Visible label rendered next to the switch */
  label?: string
  className?: string
}

export default function Toggle({
  checked,
  disabled,
  busy,
  dimOnDisabled = true,
  size = 'sm',
  onChange,
  ariaLabel,
  label,
  className,
}: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel ?? label}
      aria-busy={busy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:ring-offset-1 disabled:cursor-not-allowed dark:focus-visible:ring-offset-stone-900',
        dimOnDisabled && 'disabled:opacity-50',
        label != null && 'gap-2 rounded-md text-xs text-stone-600 dark:text-stone-300',
        className,
      )}
    >
      {/* block + shrink-0 + explicit left anchor on the knob: as a flex item the
          track would otherwise collapse or the knob would drift in tight rows */}
      <span
        className={cn(
          'relative block shrink-0 rounded-full transition-colors',
          size === 'md' ? 'h-6 w-11' : 'h-5 w-9',
          checked ? 'bg-(--bd-toggle-on)' : 'bg-(--bd-toggle-off)',
        )}
      >
        <span
          className={cn(
            'absolute left-0.5 top-0.5 rounded-full bg-(--bd-toggle-knob) shadow-sm transition-transform',
            size === 'md' ? 'h-5 w-5' : 'h-4 w-4',
            checked && (size === 'md' ? 'translate-x-5' : 'translate-x-4'),
          )}
        />
      </span>
      {label}
    </button>
  )
}
