import { useState, type CSSProperties, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

export function PanelSectionList({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col divide-y divide-[var(--bd-read-accent)]/35">
      {children}
    </div>
  )
}

export function PanelSection({
  title,
  gap = 'default',
  children,
}: {
  title?: string
  gap?: 'default' | 'compact'
  children: ReactNode
}) {
  return (
    <section className={cn('flex flex-col py-3.5 first:pt-0 last:pb-0', gap === 'compact' ? 'gap-2' : 'gap-3.5')}>
      {title && (
        <div className="text-xs font-semibold text-current/75">
          {title}
        </div>
      )}
      {children}
    </section>
  )
}

export function ControlGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="block text-xs font-medium text-current/75">{label}</label>
      {children}
    </div>
  )
}

export function InlineControlRow({ label, sub = false, children }: { label: string; sub?: boolean; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={cn('min-w-0 font-medium', sub ? 'text-xs text-current/75' : 'text-sm text-current')}>
        {label}
      </span>
      {children}
    </div>
  )
}

export interface SliderRowProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  /** Overrides the trailing value text entirely (e.g. "自动" instead of "0自动") */
  formatValue?: (value: number) => string
  stepper?: {
    decLabel?: ReactNode
    incLabel?: ReactNode
    decAria?: string
    incAria?: string
  }
  /** Defer store/prop writes until pointer/key release to avoid relayout on every drag tick. */
  commitOnRelease?: boolean
  onChange: (value: number) => void
}

export function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = '',
  formatValue,
  stepper,
  commitOnRelease = true,
  onChange,
}: SliderRowProps) {
  const [draft, setDraft] = useState<number | null>(null)
  const shown = commitOnRelease ? (draft ?? value) : value
  const commit = () => {
    if (draft !== null && draft !== value) onChange(draft)
    setDraft(null)
  }
  const pct = Math.round(((shown - min) / (max - min)) * 100)
  const shownText = formatValue ? formatValue(shown) : `${shown}${suffix}`

  const handleStep = (delta: number) => {
    const next = Math.min(max, Math.max(min, Math.round((value + delta) * 100) / 100))
    if (next !== value) onChange(next)
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-current/75">{label}</span>
        {stepper ? (
          <div className="flex items-center rounded-md bg-stone-500/10 p-0.5 text-current dark:bg-stone-500/15">
            <button
              type="button"
              disabled={value <= min}
              onClick={() => handleStep(-step)}
              aria-label={stepper.decAria ?? 'Decrease'}
              className="flex h-5 w-5 items-center justify-center rounded text-xs text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/15 hover:text-current active:scale-90 disabled:pointer-events-none disabled:opacity-30"
            >
              {stepper.decLabel ?? <span className="text-[13px] font-semibold leading-none">−</span>}
            </button>
            <span className="min-w-[2.75rem] px-1 text-center font-medium tabular-nums text-current">
              {shownText}
            </span>
            <button
              type="button"
              disabled={value >= max}
              onClick={() => handleStep(step)}
              aria-label={stepper.incAria ?? 'Increase'}
              className="flex h-5 w-5 items-center justify-center rounded text-xs text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/15 hover:text-current active:scale-90 disabled:pointer-events-none disabled:opacity-30"
            >
              {stepper.incLabel ?? <span className="text-[13px] font-semibold leading-none">+</span>}
            </button>
          </div>
        ) : (
          <span className="tabular-nums font-medium text-current">{shownText}</span>
        )}
      </div>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={shown}
        onChange={(e) => {
          const next = Number(e.target.value)
          if (commitOnRelease) setDraft(next)
          else onChange(next)
        }}
        onPointerUp={commitOnRelease ? commit : undefined}
        onPointerCancel={commitOnRelease ? commit : undefined}
        onKeyUp={commitOnRelease ? commit : undefined}
        onBlur={commitOnRelease ? commit : undefined}
        className="bd-slider w-full"
        style={{ '--slider-fill': `${pct}%` } as CSSProperties}
      />
    </div>
  )
}

export interface ToggleRowProps {
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
}

export function ToggleRow({ label, hint, checked, onChange }: ToggleRowProps) {
  return (
    <div
      onClick={() => onChange(!checked)}
      className={cn(
        'group flex cursor-pointer select-none justify-between gap-3 transition-colors',
        hint ? 'items-start' : 'items-center',
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-current">{label}</div>
        {hint && <div className="mt-1 text-xs leading-relaxed text-current/65">{hint}</div>}
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onChange(!checked)
        }}
        className={cn(
          'relative h-6 w-10 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current',
          hint && 'mt-0.5',
        )}
        style={{ backgroundColor: checked ? 'var(--toggle-on-bg)' : 'var(--toggle-off-bg)' }}
        aria-checked={checked}
        aria-label={label}
        role="switch"
      >
        <span
          className={cn(
            'absolute top-1 h-4 w-4 rounded-full bg-[var(--bd-read-bg)] shadow-sm transition-transform',
            checked ? 'left-5' : 'left-1',
          )}
        />
      </button>
    </div>
  )
}

export interface ButtonGroupProps<T extends string | number> {
  options: { value: T; label: string; icon?: ReactNode }[]
  value: T
  onChange: (value: T) => void
  size?: 'default' | 'sm'
  inline?: boolean
}

export function ButtonGroup<T extends string | number>({
  options,
  value,
  onChange,
  size = 'default',
  inline = false,
}: ButtonGroupProps<T>) {
  const isCompact = inline || size === 'sm'
  return (
    <div
      className={cn(
        'bg-current/[0.06]',
        inline ? 'inline-grid shrink-0' : 'grid',
        isCompact ? 'gap-0.5 rounded-lg p-0.5' : 'gap-1 rounded-xl p-1',
      )}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((opt) => {
        const isSelected = value === opt.value
        return (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            title={opt.label}
            aria-label={opt.label}
            className={cn(
              'flex items-center justify-center whitespace-nowrap tracking-wide transition-all duration-150 select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-current/40 active:scale-[0.98]',
              isCompact
                ? cn('min-h-[1.75rem] rounded-md py-1 text-xs', inline && options.length <= 2 ? 'px-3.5' : 'px-3')
                : 'min-h-[2.125rem] rounded-lg px-2.5 py-1.5 text-[13px]',
              isSelected
                ? 'bg-[var(--bd-read-bg)] font-medium text-current shadow-xs ring-1 ring-current/10'
                : 'font-normal text-current/75 hover:text-current hover:bg-current/5',
            )}
          >
            {opt.icon ?? opt.label}
          </button>
        )
      })}
    </div>
  )
}
