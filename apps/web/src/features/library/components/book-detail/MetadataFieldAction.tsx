interface MetadataFieldActionProps {
  label: string
  preview?: string
  provenance?: string
  kind?: 'restore' | 'inherit'
  disabled?: boolean
  onApply: () => void
}

export default function MetadataFieldAction({ label, kind = 'restore', disabled = false, onApply }: MetadataFieldActionProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onApply}
      className="flex size-7 items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-stone-700 focus-visible:outline-2 focus-visible:outline-stone-400 disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"
    >
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {kind === 'restore' ? (
          <>
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </>
        ) : (
          <>
            <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2" />
            <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2" />
          </>
        )}
      </svg>
    </button>
  )
}
