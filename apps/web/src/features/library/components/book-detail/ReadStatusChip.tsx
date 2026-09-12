import { useEffect, useRef, useState } from 'react'

import type { BookListItem } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'

import { useUpdateBook } from '../../hooks'
import { READ_STATUS_OPTIONS, STATUS_DOT, statusLabelKey } from '../read-status'

interface ReadStatusChipProps {
  book: BookListItem
}

export default function ReadStatusChip({ book }: ReadStatusChipProps) {
  const _ = useTranslation()
  const updateBook = useUpdateBook()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    return () => window.removeEventListener('mousedown', onPointerDown)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md bg-stone-100 px-2 py-0.5 text-xs text-stone-600 transition-colors hover:bg-stone-200 hover:text-stone-900 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700 dark:hover:text-stone-100"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[book.readStatus]}`} />
        {_(statusLabelKey(book.readStatus))}
      </button>
      {open && (
        <div className="absolute left-0 top-7 z-10 w-36 rounded-xl border border-stone-200/80 bg-white/95 p-1 shadow-xl shadow-stone-900/8 backdrop-blur-md dark:border-stone-700 dark:bg-stone-900/95">
          {READ_STATUS_OPTIONS.map((action) => (
            <button
              key={action.value}
              type="button"
              onClick={() => {
                setOpen(false)
                updateBook.mutate({ bookId: book.id, readStatus: action.value })
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-stone-700 transition-colors hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${action.iconClass}`}>
                {action.icon}
              </svg>
              <span className="flex-1">{_(action.labelKey)}</span>
              {book.readStatus === action.value && (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-500 dark:text-stone-300">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
