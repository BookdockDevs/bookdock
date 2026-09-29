import type { ReactNode } from 'react'

import type { BookListItem } from '@bookdock/shared'

import MenuFlyout from '@/components/ui/MenuFlyout'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { formatAuthorList } from '@/lib/utils'

import { useUpdateBook } from '../hooks'

import { downloadDefault } from '../download'

import { READ_STATUS_OPTIONS, STATUS_DOT } from './read-status'
import { MenuHeader } from './RowMenuChrome'

const itemClass = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-stone-700 transition-colors hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800'
const divider = <div className="mx-2 my-1 border-t border-stone-100 dark:border-stone-800" />

function MenuIcon({ children, className = 'text-stone-400' }: { children: ReactNode; className?: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`}>
      {children}
    </svg>
  )
}

export { MenuHeader, MenuDivider, MenuItem, MenuDangerItem } from './RowMenuChrome'

function StatusFlyout({ book, onClose }: { book: BookListItem; onClose: () => void }) {
  const _ = useTranslation()
  const updateBook = useUpdateBook()
  return (
    <MenuFlyout
      row={({ open, flip, toggle }) => (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            toggle()
          }}
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
      )}
    >
      {(close) => (
        <>
          {READ_STATUS_OPTIONS.map((action) => (
            <button
              key={action.value}
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                close()
                onClose()
                updateBook.mutate({ bookId: book.id, readStatus: action.value })
              }}
              className={itemClass}
            >
              <MenuIcon className={action.iconClass}>{action.icon}</MenuIcon>
              <span className="flex-1">{_(action.labelKey)}</span>
              {book.readStatus === action.value && (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-500 dark:text-stone-300">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ))}
        </>
      )}
    </MenuFlyout>
  )
}

export function ContextMenuContent({ book, readOnly = false, onShowDetails, onPublish, onDelete, onClose }: {
  book: BookListItem
  readOnly?: boolean
  onShowDetails?: (book: BookListItem) => void
  onPublish?: (book: BookListItem) => void
  onDelete?: (book: BookListItem) => void
  onClose: () => void
}) {
  const _ = useTranslation()
  const updateBook = useUpdateBook()
  return (
    <>
      <MenuHeader
        title={book.title}
        subtitle={`${formatAuthorList(book.authors, book.author)}${formatAuthorList(book.authors, book.author) ? ' · ' : ''}${book.format}`}
      />

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

      {!readOnly && (
        <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onClose()
          void downloadDefault(book).catch((err) => {
            notify.error(getUserErrorNotification(err, 'errors.downloadFailed'))
          })
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

      {divider}

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

      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onClose()
          updateBook.mutate({ bookId: book.id, hidden: !book.hidden })
        }}
        className={itemClass}
      >
        <MenuIcon>
          {book.hidden ? (
            <>
              <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
              <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
              <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
              <line x1="2" x2="22" y1="2" y2="22" />
            </>
          ) : (
            <>
              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
            </>
          )}
        </MenuIcon>
        {book.hidden ? _('library.show') : _('library.hide')}
      </button>

      <StatusFlyout book={book} onClose={onClose} />

      {onPublish && divider}

      {onPublish && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onClose()
            onPublish(book)
          }}
          className={itemClass}
        >
          <MenuIcon>
            <path d="M12 17V3" />
            <path d="m7 8 5-5 5 5" />
            <path d="M5 21h14" />
          </MenuIcon>
          {_('library.publish')}
        </button>
      )}

      {onDelete && divider}

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
          {book.source ? _('library.removeFromLibrary') : _('library.delete')}
        </button>
      )}
        </>
      )}
    </>
  )
}
