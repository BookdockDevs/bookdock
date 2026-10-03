import { useId, useRef, useState } from 'react'

interface MetadataFieldActionProps {
  label: string
  preview: string
  provenance: string
  kind?: 'restore' | 'inherit'
  disabled?: boolean
  onApply: () => void
}

export default function MetadataFieldAction({ label, preview, provenance, kind = 'restore', disabled = false, onApply }: MetadataFieldActionProps) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const touch = useRef(false)

  function apply() {
    onApply()
    setOpen(false)
  }

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => { if (!disabled) setOpen(true) }}
      onMouseLeave={() => { if (!touch.current) setOpen(false) }}
      onFocus={() => { if (!disabled) setOpen(true) }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}
      onKeyDown={(event) => { if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false) } }}
    >
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        disabled={disabled}
        onPointerDown={(event) => { touch.current = event.pointerType === 'touch' }}
        onClick={() => { if (touch.current) setOpen(true); else apply() }}
        className="flex size-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-slate-400 disabled:opacity-40 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      >
        <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          {kind === 'restore' ? <><path d="M3 10a9 9 0 1 1 2 9" /><path d="M3 4v6h6" /></> : <><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2" /></>}
        </svg>
      </button>
      {open && !disabled && (
        <span id={id} className="absolute right-0 top-full z-50 mt-1 block w-64 max-w-[75vw] rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          <span className="block text-slate-400">{provenance}</span>
          <span className="mt-1 block max-h-32 overflow-y-auto whitespace-pre-wrap break-words">{preview || '—'}</span>
          {touch.current && <button type="button" onClick={apply} className="mt-2 rounded px-2 py-1 font-medium text-blue-600 hover:bg-slate-100 dark:text-blue-400 dark:hover:bg-slate-800">{label}</button>}
        </span>
      )}
    </span>
  )
}
