import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import type { BookListItem, ReadStatus } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'

import { useUpdateBook } from '../hooks'

import { downloadBook } from '../download'

const itemClass = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-stone-700 transition-colors hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800'
const divider = <div className="mx-2 my-1 border-t border-stone-100 dark:border-stone-800" />

const STATUS_DOT: Record<ReadStatus, string> = {
  wishlist: 'bg-violet-500',
  reading: 'bg-blue-500',
  idle: 'bg-stone-400 dark:bg-stone-500',
  finished: 'bg-emerald-500',
  abandoned: 'bg-amber-500',
}

function MenuIcon({ children, className = 'text-stone-400' }: { children: ReactNode; className?: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`}>
      {children}
    </svg>
  )
}

function StatusFlyout({ book, onClose }: { book: BookListItem; onClose: () => void }) {
  const _ = useTranslation()
  const updateBook = useUpdateBook()
  const [open, setOpen] = useState(false)
  const [flip, setFlip] = useState(false)
  const subRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open) return
    const r = subRef.current?.getBoundingClientRect()
    if (r) setFlip(r.right > window.innerWidth - 8)
  }, [open])

  const statusActions: { value: ReadStatus; label: string; icon: ReactNode; iconClass: string }[] = [
    { value: 'wishlist', label: _('library.readStatusWishlist'), iconClass: 'text-violet-500', icon: <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /> },
    { value: 'reading', label: _('library.readStatusReading'), iconClass: 'text-blue-500', icon: <><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></> },
    { value: 'finished', label: _('library.readStatusFinished'), iconClass: 'text-emerald-500', icon: <><circle cx="12" cy="12" r="10" /><path d="M9 12l2 2 4-4" /></> },
    { value: 'idle', label: _('library.readStatusIdle'), iconClass: 'text-stone-500', icon: <><path d="M21 8v13H3V8" /><path d="M1 3h22v5H1z" /><path d="M10 12h4" /></> },
    { value: 'abandoned', label: _('library.readStatusAbandoned'), iconClass: 'text-amber-500', icon: <><circle cx="12" cy="12" r="10" /><path d="m4.9 4.9 14.2 14.2" /></> },
  ]

  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`${itemClass} ${open ? 'bg-stone-100 dark:bg-stone-800' : ''}`}
      >
        <MenuIcon>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </MenuIcon>
        <span className="flex-1">{_('library.readStatusLabel')}</span>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[book.readStatus]}`} />
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-stone-400 transition-transform ${flip ? 'rotate-180' : ''}`}>
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>
      {open && (
        <div className={`absolute -top-1 z-10 ${flip ? 'right-full pr-1.5' : 'left-full pl-1.5'}`}>
          <div ref={subRef} className="w-36 rounded-xl border border-stone-200/80 bg-white/95 p-1 shadow-xl shadow-stone-900/8 backdrop-blur-md dark:border-stone-700 dark:bg-stone-900/95">
            {statusActions.map((action) => (
              <button
                key={action.value}
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onClose()
                  updateBook.mutate({ bookId: book.id, readStatus: action.value })
                }}
                className={itemClass}
              >
                <MenuIcon className={action.iconClass}>{action.icon}</MenuIcon>
                <span className="flex-1">{action.label}</span>
                {book.readStatus === action.value && (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-500 dark:text-stone-300">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function ContextMenuContent({ book, onShowDetails, onDelete, onClose }: {
  book: BookListItem
  onShowDetails?: (book: BookListItem) => void
  onDelete?: (book: BookListItem) => void
  onClose: () => void
}) {
  const _ = useTranslation()
  const updateBook = useUpdateBook()
  return (
    <>
      <div className="mx-1.5 mb-1 border-b border-stone-100 px-1.5 pb-2 pt-1.5 dark:border-stone-800">
        <p className="truncate text-xs font-medium text-stone-900 dark:text-stone-100">{book.title}</p>
        <p className="mt-0.5 truncate text-[10px] uppercase tracking-wider text-stone-400 dark:text-stone-500">
          {book.author ? `${book.author} · ` : ''}{book.format}
        </p>
      </div>

      {onShowDetails && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onClose()
            onShowDetails(book)
          }}
          className={itemClass}
        >
          <MenuIcon>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </MenuIcon>
          {_('library.details')}
        </button>
      )}

      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onClose()
          downloadBook(book.id, book.title)
        }}
        className={itemClass}
      >
        <MenuIcon>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </MenuIcon>
        {_('library.download')}
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onClose()
          updateBook.mutate({ bookId: book.id, pinned: !book.pinnedAt })
        }}
        className={itemClass}
      >
        <MenuIcon>
          <path d="M12 17v5" />
          <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
        </MenuIcon>
        {book.pinnedAt ? _('library.unpin') : _('library.pin')}
      </button>

      {divider}

      <StatusFlyout book={book} onClose={onClose} />

      {divider}

      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onClose()
            onDelete(book)
          }}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
        >
          <MenuIcon className="text-red-400">
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
          </MenuIcon>
          {_('library.delete')}
        </button>
      )}
    </>
  )
}
