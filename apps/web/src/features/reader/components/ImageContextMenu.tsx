import { useEffect, useState } from 'react'

import { useTranslation } from '@/hooks/useTranslation'
import { notify } from '@/lib/notifications'

import { markEscConsumed } from '../lib/esc-consumed'
import { copyImage, downloadImage } from '../lib/image-actions'
import type { ImageMediaContextInfo, ImageMediaInfo } from '../types'

interface ImageContextMenuProps {
  image: ImageMediaContextInfo
  bookTitle?: string
  onView: (image: ImageMediaInfo) => void
  onClose: () => void
}

export function ImageContextMenu({ image, bookTitle, onView, onClose }: ImageContextMenuProps) {
  const _ = useTranslation()
  const [busyAction, setBusyAction] = useState<'save' | 'copy' | null>(null)
  const description = image.alt || image.title || _('reader.imageViewerImage')
  const menuWidth = 176
  const menuHeight = 148
  const left = Math.min(Math.max(8, image.x), Math.max(8, window.innerWidth - menuWidth - 8))
  const top = Math.min(Math.max(8, image.y), Math.max(8, window.innerHeight - menuHeight - 8))

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        markEscConsumed()
        onClose()
        return
      }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'PageUp', 'PageDown'].includes(event.key)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const save = async () => {
    setBusyAction('save')
    try {
      await downloadImage(image, bookTitle)
      notify.success({ key: 'reader.imageViewerSaved' })
      onClose()
    } catch (error) {
      console.warn('[reader] image context-menu download failed', error)
      notify.error({ key: 'reader.imageViewerSaveFailed' })
    } finally {
      setBusyAction(null)
    }
  }

  const copy = async () => {
    setBusyAction('copy')
    try {
      await copyImage(image)
      notify.success({ key: 'reader.imageViewerCopied' })
      onClose()
    } catch (error) {
      console.warn('[reader] image context-menu copy failed', error)
      notify.error({ key: 'reader.imageViewerCopyFailed' })
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[90]"
      role="presentation"
      onPointerDown={onClose}
      onContextMenu={(event) => { event.preventDefault(); onClose() }}
    >
      <div
        className="absolute min-w-44 overflow-hidden rounded-xl border border-stone-200/80 dark:border-stone-700/80 bg-[var(--bd-read-bg)] p-1.5 text-sm text-[var(--bd-read-fg,#333)] shadow-2xl backdrop-blur-md"
        style={{ left, top }}
        role="menu"
        aria-label={_('reader.imageMenuTitle')}
        onPointerDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <p className="truncate px-2 py-1 text-xs text-[var(--bd-read-sub)] border-b border-stone-200/50 dark:border-stone-700/50 mb-1" title={description}>
          {description}
        </p>

        {/* View image */}
        <button
          type="button"
          role="menuitem"
          onClick={() => { onClose(); onView(image) }}
          className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-xs font-medium transition-colors hover:bg-stone-500/10 text-left"
        >
          <svg className="h-3.5 w-3.5 shrink-0 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
          {_('reader.imageViewerView')}
        </button>

        {/* Save */}
        <button
          type="button"
          role="menuitem"
          onClick={() => void save()}
          disabled={busyAction !== null}
          className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-xs font-medium transition-colors hover:bg-stone-500/10 disabled:cursor-not-allowed disabled:opacity-40 text-left"
        >
          <svg className="h-3.5 w-3.5 shrink-0 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          {_('reader.imageViewerSave')}
        </button>

        {/* Copy */}
        <button
          type="button"
          role="menuitem"
          onClick={() => void copy()}
          disabled={busyAction !== null}
          className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-xs font-medium transition-colors hover:bg-stone-500/10 disabled:cursor-not-allowed disabled:opacity-40 text-left"
        >
          <svg className="h-3.5 w-3.5 shrink-0 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="13" height="13" x="9" y="9" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          {_('reader.imageViewerCopy')}
        </button>
      </div>
    </div>
  )
}
