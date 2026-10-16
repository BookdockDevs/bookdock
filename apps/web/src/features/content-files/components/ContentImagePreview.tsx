import { useEffect, useState } from 'react'

import type { ContentFile } from '@bookdock/shared'

import Modal from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'

interface ContentImagePreviewProps {
  images: ContentFile[]
  initialIndex: number
  onClose: () => void
}

export default function ContentImagePreview({ images, initialIndex, onClose }: ContentImagePreviewProps) {
  const _ = useTranslation()
  const [index, setIndex] = useState(() => Math.min(Math.max(initialIndex, 0), Math.max(images.length - 1, 0)))
  const image = images[index]

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'ArrowLeft') setIndex((current) => (current - 1 + images.length) % images.length)
      if (event.key === 'ArrowRight') setIndex((current) => (current + 1) % images.length)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [images.length])

  if (!image) return null
  return (
    <Modal
      title={image.name}
      onClose={onClose}
      hideHeader
      size="wide"
      centered
      panelClassName="max-h-[90vh] bg-black/90"
      contentClassName="relative flex items-center justify-center !p-4 sm:!p-6"
    >
      <img src={image.url} alt={image.name} className="max-h-[calc(90vh-3rem)] max-w-full object-contain" />
      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => setIndex((current) => (current - 1 + images.length) % images.length)}
            aria-label={_('contentFiles.previous')}
            className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/70"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => setIndex((current) => (current + 1) % images.length)}
            aria-label={_('contentFiles.next')}
            className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/70"
          >
            ›
          </button>
          <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-2.5 py-1 text-xs text-white">
            {index + 1} / {images.length}
          </span>
        </>
      )}
    </Modal>
  )
}
