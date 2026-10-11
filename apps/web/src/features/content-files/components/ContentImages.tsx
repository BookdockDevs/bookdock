import { useState } from 'react'

import type { ContentFile } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'
import { Button } from '@/components/ui/Button'

interface ContentImagesProps {
  images?: ContentFile[]
}

export default function ContentImages({ images }: ContentImagesProps) {
  const _ = useTranslation()
  const [unavailable, setUnavailable] = useState<string[]>([])
  if (!images?.length) return null
  return <div className="mt-3 grid min-w-0 grid-cols-2 gap-2">{images.map((image) => <div key={image.id} className="min-w-0 overflow-hidden rounded-lg border border-stone-200 dark:border-stone-800">{unavailable.includes(image.id) ? <div className="flex items-center gap-2 p-3"><p className="text-xs text-stone-500" role="status">{_('contentFiles.unavailable')}</p><Button variant="ghost" size="sm" className="relative z-10" onClick={(event) => { event.stopPropagation(); setUnavailable((ids) => ids.filter((id) => id !== image.id)) }}>{_('contentFiles.retry')}</Button></div> : <img src={image.url} alt={image.name} loading="lazy" decoding="async" className="min-h-24 max-h-64 w-full object-contain" onError={() => setUnavailable((ids) => [...ids, image.id])} />}</div>)}</div>
}
