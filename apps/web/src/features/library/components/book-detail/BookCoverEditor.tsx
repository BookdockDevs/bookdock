import { useRef } from 'react'

import type { BookListItem } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'

import BookCover from '../BookCover'

interface BookCoverEditorProps {
  book: BookListItem
  coverRemovalPending: boolean
  pendingCoverFile: File | null
  coverPreviewUrl: string | null
  saving: boolean
  onCoverFile: (file: File | undefined) => void
  onRemoveCover: () => void
}

export default function BookCoverEditor({
  book,
  coverRemovalPending,
  pendingCoverFile,
  coverPreviewUrl,
  saving,
  onCoverFile,
  onRemoveCover,
}: BookCoverEditorProps) {
  const _ = useTranslation()
  const coverInputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="w-28 shrink-0 self-center sm:self-auto">
      <div
        className="group relative cursor-pointer"
        onClick={() => coverInputRef.current?.click()}
      >
        <BookCover
          book={book}
          coverSrc={coverRemovalPending ? null : pendingCoverFile ? coverPreviewUrl : undefined}
        />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 rounded-xl bg-black/55 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
          <span className="rounded-md bg-white/90 px-2.5 py-1 text-xs font-medium text-stone-800">
            {_('library.changeCover')}
          </span>
          {(book.coverKey || pendingCoverFile) && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                if (!saving) onRemoveCover()
              }}
              disabled={saving}
              className="rounded-md bg-black/40 px-2.5 py-1 text-xs text-white/90 transition-colors hover:bg-black/60"
            >
              {_('library.removeCover')}
            </button>
          )}
        </div>
        <input
          ref={coverInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          disabled={saving}
          onChange={(e) => {
            void onCoverFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>
    </div>
  )
}
