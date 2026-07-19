import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'

import type { BookListItem } from '@bookdock/shared'

import { formatBytes, formatDate } from '@/lib/utils'
import { t } from '@/i18n'

import BookCover from './components/BookCover'
import BookCard from './components/BookCard'
import BookMembershipDialog from './components/BookMembershipDialog'
import DeleteConfirm from './components/DeleteConfirm'
import EmptyLibrary from './components/EmptyLibrary'
import LibraryHeader from './components/LibraryHeader'
import LibrarySidebar from './components/LibrarySidebar'
import UploadSheet from './components/UploadSheet'
import { useBooks, useDeleteBook, useRestoreBook, usePermanentDeleteBook, useEmptyTrash } from './hooks'
import { useLibraryState } from './state/library-state'

const PAGE_SIZE = 20

export default function Library() {
  const { view, search, sortBy, sortOrder, shelfId, tagId, format, trash } = useLibraryState()
  const [uploadOpen, setUploadOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<BookListItem | null>(null)
  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState<BookListItem | null>(null)
  const [emptyTrashOpen, setEmptyTrashOpen] = useState(false)
  const [membershipTarget, setMembershipTarget] = useState<BookListItem | null>(null)
  const deleteBook = useDeleteBook()
  const restoreBook = useRestoreBook()
  const permanentDeleteBook = usePermanentDeleteBook()
  const emptyTrash = useEmptyTrash()

  const debouncedSearch = useDebounced(search, 250)
  const { data, isLoading, isFetching } = useBooks({
    page: 1,
    pageSize: PAGE_SIZE,
    search: debouncedSearch,
    sortBy,
    sortOrder,
    shelfId,
    tagId,
    format,
    trash,
  })

  useGlobalDragToggle(setUploadOpen)

  const books = data?.data ?? []
  const isEmpty = !isLoading && books.length === 0

  return (
    <div className="flex min-h-screen bg-white text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <LibrarySidebar />

      <main className="flex-1 px-4 py-6 md:px-6">
        <LibraryHeader
          onUploadClick={() => setUploadOpen(true)}
          trash={trash}
          trashCount={data?.total ?? 0}
          onEmptyTrash={() => setEmptyTrashOpen(true)}
        />

        {isLoading ? (
          <SkeletonGrid />
        ) : isEmpty ? (
          trash ? (
            <EmptyTrash />
          ) : (
            <EmptyLibrary onUploadClick={() => setUploadOpen(true)} />
          )
        ) : view === 'grid' ? (
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
            {books.map((book) =>
              trash ? (
                <div key={book.id}>
                  <BookCard
                    book={book}
                    onRestore={(b) => void restoreBook.mutateAsync(b.id).catch(() => undefined)}
                    onPermanentDelete={setPermanentDeleteTarget}
                  />
                </div>
              ) : (
                <Link
                  key={book.id}
                  to="/books/$id"
                  params={{ id: book.id }}
                  className="rounded-xl transition-shadow hover:shadow-sm"
                >
                  <BookCard
                    book={book}
                    onDelete={setDeleteTarget}
                    onEditMembership={setMembershipTarget}
                  />
                </Link>
              ),
            )}
          </div>
        ) : (
          <ListView
            books={books}
            trash={trash}
            onDelete={setDeleteTarget}
            onEditMembership={setMembershipTarget}
            onRestore={(b) => void restoreBook.mutateAsync(b.id).catch(() => undefined)}
            onPermanentDelete={setPermanentDeleteTarget}
          />
        )}

        {isFetching && !isLoading && (
          <p className="mt-6 text-center text-xs text-stone-400">{t().reader.loading}</p>
        )}
      </main>

      <UploadSheet open={uploadOpen} onClose={() => setUploadOpen(false)} />

      <BookMembershipDialog
        bookId={membershipTarget?.id ?? null}
        bookTitle={membershipTarget?.title ?? ''}
        onClose={() => setMembershipTarget(null)}
      />

      <DeleteConfirm
        open={!!deleteTarget}
        bookTitle={deleteTarget?.title}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          const target = deleteTarget
          if (!target) return
          setDeleteTarget(null)
          void deleteBook.mutateAsync(target.id).catch(() => undefined)
        }}
      />

      <DeleteConfirm
        open={!!permanentDeleteTarget}
        title={t().library.permanentDelete}
        message={
          <>
            {t().library.permanentDeleteConfirm}
            <span className="mt-1 block truncate text-stone-700 dark:text-stone-200">「{permanentDeleteTarget?.title ?? ''}」</span>
          </>
        }
        confirmLabel={t().library.permanentDelete}
        onCancel={() => setPermanentDeleteTarget(null)}
        onConfirm={() => {
          const target = permanentDeleteTarget
          if (!target) return
          setPermanentDeleteTarget(null)
          void permanentDeleteBook.mutateAsync(target.id).catch(() => undefined)
        }}
      />

      <DeleteConfirm
        open={emptyTrashOpen}
        title={t().library.emptyTrash}
        message={t().library.emptyTrashConfirm}
        confirmLabel={t().library.emptyTrash}
        onCancel={() => setEmptyTrashOpen(false)}
        onConfirm={() => {
          setEmptyTrashOpen(false)
          void emptyTrash.mutateAsync().catch(() => undefined)
        }}
      />
    </div>
  )
}

function EmptyTrash() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-stone-200">
        <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
      </svg>
      <p className="text-lg font-medium text-stone-700">{t().library.trashEmpty}</p>
      <p className="text-sm text-stone-400">{t().library.trashEmptyHint}</p>
    </div>
  )
}

function ListView({
  books,
  trash = false,
  onDelete,
  onEditMembership,
  onRestore,
  onPermanentDelete,
}: {
  books: BookListItem[]
  trash?: boolean
  onDelete: (b: BookListItem) => void
  onEditMembership: (b: BookListItem) => void
  onRestore: (b: BookListItem) => void
  onPermanentDelete: (b: BookListItem) => void
}) {
  return (
    <ul className="flex flex-col">
      {books.map((book) => (
        <li key={book.id}>
          {trash ? (
            <div className="group flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-stone-50 dark:hover:bg-stone-900">
              <BookCover book={book} size="sm" />
              <ListItemMeta book={book} />
              <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => onRestore(book)}
                  className="rounded-md px-2 py-1 text-xs text-stone-500 hover:bg-stone-100 hover:text-stone-900 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                >
                  {t().library.restore}
                </button>
                <button
                  type="button"
                  onClick={() => onPermanentDelete(book)}
                  className="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-stone-800"
                >
                  {t().library.permanentDelete}
                </button>
              </div>
            </div>
          ) : (
            <Link
              to="/books/$id"
              params={{ id: book.id }}
              className="group flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-stone-50 dark:hover:bg-stone-900"
            >
              <BookCover book={book} size="sm" />
              <ListItemMeta book={book} />
              <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onEditMembership(book)
                  }}
                  className="text-stone-300 hover:text-stone-600 dark:hover:text-stone-200"
                  aria-label="编辑归类"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onDelete(book)
                  }}
                  className="text-stone-300 hover:text-stone-600 dark:hover:text-stone-200"
                  aria-label="删除"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
                  </svg>
                </button>
              </div>
            </Link>
          )}
        </li>
      ))}
    </ul>
  )
}

function ListItemMeta({ book }: { book: BookListItem }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <span className="truncate font-serif text-sm font-medium text-stone-900 dark:text-stone-100">
          {book.title}
        </span>
      </div>
      {book.author && (
        <p className="truncate text-xs text-stone-500">{book.author}</p>
      )}
      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] uppercase text-stone-400">
        <span>{book.format}</span>
        <span>·</span>
        <span>{formatBytes(book.size)}</span>
        <span>·</span>
        <span>{formatDate(book.createdAt)}</span>
      </div>
    </div>
  )
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <div className="aspect-[2/3] w-full animate-pulse rounded-lg bg-stone-100 dark:bg-stone-800/60" />
          <div className="h-3 w-3/4 animate-pulse rounded bg-stone-100 dark:bg-stone-800/60" />
          <div className="h-2.5 w-1/2 animate-pulse rounded bg-stone-100 dark:bg-stone-800/60" />
        </div>
      ))}
    </div>
  )
}

function useDebounced(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}

function useGlobalDragToggle(setOpen: (open: boolean) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        setOpen(true)
        if (timer.current) clearTimeout(timer.current)
      }
    }
    const onDragLeave = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setOpen(false), 200)
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [setOpen])
}
