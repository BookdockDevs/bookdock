import { useState } from 'react'

import type { ContentFile } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'
import { Button } from '@/components/ui/Button'

import ContentImagePreview from './ContentImagePreview'

interface ContentImagesProps {
  images?: ContentFile[]
}

export default function ContentImages({ images }: ContentImagesProps) {
  const _ = useTranslation()
  const [unavailable, setUnavailable] = useState<string[]>([])
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  if (!images?.length) return null
  const columns = images.length === 2 || images.length === 4 ? 'grid-cols-2' : 'grid-cols-3'
  const content = images.length === 1
    ? (
      unavailable.includes(images[0].id)
        ? <div className="flex max-w-[28rem] items-center gap-2 rounded-lg bg-stone-500/10 p-3"><p className="text-xs text-stone-500" role="status">{_('contentFiles.unavailable')}</p><Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); setUnavailable((ids) => ids.filter((id) => id !== images[0].id)) }}>{_('contentFiles.retry')}</Button></div>
        : <button type="button" className="block max-w-full cursor-zoom-in text-left" onClick={() => setPreviewIndex(0)}>
          <img src={images[0].url} alt={images[0].name} loading="lazy" decoding="async" className="max-h-80 max-w-full rounded-lg object-contain" onError={() => setUnavailable((ids) => ids.includes(images[0].id) ? ids : [...ids, images[0].id])} />
        </button>
    )
    : (
      <div className={`grid min-w-0 max-w-[28rem] ${columns} gap-1.5`}>
        {images.map((image, index) => (
          <div key={image.id} className="min-w-0 overflow-hidden rounded-md">
            {unavailable.includes(image.id) ? (
              <div className="flex aspect-square flex-col items-center justify-center gap-1 bg-stone-500/10 p-2">
                <p className="text-center text-xs text-stone-500" role="status">{_('contentFiles.unavailable')}</p>
                <Button variant="ghost" size="sm" className="relative z-10" onClick={(event) => { event.stopPropagation(); setUnavailable((ids) => ids.filter((id) => id !== image.id)) }}>{_('contentFiles.retry')}</Button>
              </div>
            ) : (
              <button type="button" className="block aspect-square w-full cursor-zoom-in" onClick={() => setPreviewIndex(index)}>
                <img src={image.url} alt={image.name} loading="lazy" decoding="async" className="h-full w-full object-cover" onError={() => setUnavailable((ids) => [...ids, image.id])} />
              </button>
            )}
          </div>
        ))}
      </div>
    )
  return (
    <>
      <div className="relative z-10 mt-3 min-w-0">{content}</div>
      {previewIndex !== null && <ContentImagePreview images={images} initialIndex={previewIndex} onClose={() => setPreviewIndex(null)} />}
    </>
  )
}
