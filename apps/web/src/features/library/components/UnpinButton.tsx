import type { ReactNode } from 'react'

import { useTranslation } from '@/hooks/useTranslation'

import { useUpdateBook } from '../hooks'

interface UnpinButtonProps {
  bookId: string
  className: string
  children: ReactNode
}

/** Clickable pinned indicator. Mounted only for pinned books so the
 *  virtualized grid doesn't attach a mutation hook to every card. */
export default function UnpinButton({ bookId, className, children }: UnpinButtonProps) {
  const _ = useTranslation()
  const updateBook = useUpdateBook()

  return (
    <button
      type="button"
      onClick={(e) => {
        // Rows/cards are themselves clickable (open book / toggle select).
        e.preventDefault()
        e.stopPropagation()
        updateBook.mutate({ bookId, pinned: false })
      }}
      className={className}
      aria-label={_('library.unpin')}
      title={_('library.unpin')}
    >
      {children}
    </button>
  )
}

export function PinIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="block">
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </svg>
  )
}
