import { useRef, useState } from 'react'

import type { BookListItem, CoverPaletteId } from '@bookdock/shared'

import SmartMenu from '@/components/ui/SmartMenu'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'
import { computeFromAnchor, PADDING, type SmartPosition } from '@/lib/position'

import BookCover from '../BookCover'
import { MORANDI_PALETTES } from '../cover-palettes'

interface BookCoverEditorProps {
  book: BookListItem
  coverRemovalPending: boolean
  pendingCoverFile: File | null
  coverPreviewUrl: string | null
  saving: boolean
  /** Palette picked in the draft (null = none picked yet, id-hash applies) */
  coverPaletteId: CoverPaletteId | null
  onCoverFile: (file: File | undefined) => void
  onRemoveCover: () => void
  onPaletteChange: (id: CoverPaletteId) => void
}

const PALETTE_MENU_WIDTH = 176
const PALETTE_MENU_HEIGHT = 76

export default function BookCoverEditor({
  book,
  coverRemovalPending,
  pendingCoverFile,
  coverPreviewUrl,
  saving,
  coverPaletteId,
  onCoverFile,
  onRemoveCover,
  onPaletteChange,
}: BookCoverEditorProps) {
  const _ = useTranslation()
  const coverInputRef = useRef<HTMLInputElement>(null)
  const paletteAnchorRef = useRef<HTMLButtonElement>(null)
  const paletteMenuRef = useRef<HTMLDivElement>(null)
  const [paletteMenu, setPaletteMenu] = useState<SmartPosition | null>(null)

  // What the thumbnail actually shows right now: a real image or the placeholder.
  const hasVisualCover = coverRemovalPending ? false : Boolean(pendingCoverFile || book.coverKey)

  function togglePaletteMenu() {
    const el = paletteAnchorRef.current
    if (!el) return
    if (paletteMenu) {
      setPaletteMenu(null)
      return
    }
    const rect = el.getBoundingClientRect()
    const position = computeFromAnchor(
      { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      PALETTE_MENU_WIDTH,
      PALETTE_MENU_HEIGHT,
    )
    setPaletteMenu({
      ...position,
      left: Math.max(PADDING, Math.min(rect.right - PALETTE_MENU_WIDTH, window.innerWidth - PALETTE_MENU_WIDTH - PADDING)),
    })
  }

  const iconButtonClass =
    'flex h-7 w-7 items-center justify-center rounded-md bg-black/40 text-white/90 transition-colors hover:bg-black/60 disabled:opacity-50'

  return (
    <div className="w-28 shrink-0 self-center sm:self-auto">
      <div className="group relative">
        <BookCover
          book={book}
          coverSrc={coverRemovalPending ? null : pendingCoverFile ? coverPreviewUrl : undefined}
          coverPaletteId={coverPaletteId}
        />
        <div
          className={cn(
            'absolute inset-0 flex items-center justify-center gap-1.5 rounded-xl bg-black/45 transition-opacity',
            paletteMenu ? 'opacity-100' : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100',
          )}
        >
          <button
            type="button"
            onClick={() => !saving && coverInputRef.current?.click()}
            disabled={saving}
            title={_('library.changeCover')}
            aria-label={_('library.changeCover')}
            className={iconButtonClass}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="9" cy="9" r="2" />
              <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
            </svg>
          </button>
          {hasVisualCover && (
            <button
              type="button"
              onClick={() => {
                if (!saving) onRemoveCover()
              }}
              disabled={saving}
              title={_('library.removeCover')}
              aria-label={_('library.removeCover')}
              className={iconButtonClass}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18" />
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </button>
          )}
          {!hasVisualCover && (
            <button
              ref={paletteAnchorRef}
              type="button"
              onClick={togglePaletteMenu}
              disabled={saving}
              title={_('library.coverPalette')}
              aria-label={_('library.coverPalette')}
              className={cn(iconButtonClass, paletteMenu && 'bg-black/70')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.6-.7 1.6-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.5-.7-.5-1.1a1.6 1.6 0 0 1 1.7-1.7H16c3.1 0 5.5-2.4 5.5-5.5C21.5 6 17.5 2 12 2z" />
                <circle cx="6.5" cy="11.5" r="0.5" fill="currentColor" />
                <circle cx="7.5" cy="6.5" r="0.5" fill="currentColor" />
                <circle cx="16.5" cy="7.5" r="0.5" fill="currentColor" />
                <circle cx="17.5" cy="13.5" r="0.5" fill="currentColor" />
              </svg>
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
      {paletteMenu && (
        <SmartMenu
          innerRef={paletteMenuRef}
          triggerRef={paletteAnchorRef}
          position={paletteMenu}
          onClose={() => setPaletteMenu(null)}
          width={PALETTE_MENU_WIDTH}
        >
          <div className="grid grid-cols-5 gap-1.5 p-1">
            {MORANDI_PALETTES.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onPaletteChange(p.id)}
                aria-label={p.label}
                aria-pressed={coverPaletteId === p.id}
                className={cn(
                  'h-7 w-7 rounded-lg border border-black/5 transition-transform hover:scale-110 dark:border-white/10',
                  p.className,
                  coverPaletteId === p.id && 'ring-2 ring-stone-500 ring-offset-1 dark:ring-stone-400 dark:ring-offset-stone-900',
                )}
              />
            ))}
          </div>
        </SmartMenu>
      )}
    </div>
  )
}
