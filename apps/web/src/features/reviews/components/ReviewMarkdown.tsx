import { useMemo, useState } from 'react'

import type { ReviewBodyFormat } from '@bookdock/shared'

import { cn } from '@/lib/utils'
import { useTranslation } from '@/hooks/useTranslation'
import { Button } from '@/components/ui/Button'

import { renderReviewBody } from '../lib/markdown'

export default function ReviewMarkdown({
  body,
  format,
  className,
}: {
  body: string | null
  format: ReviewBodyFormat
  className?: string
}) {
  const _ = useTranslation()
  const [unavailableImages, setUnavailableImages] = useState<string[]>([])
  const unavailableLabel = _('contentFiles.unavailable')
  const html = useMemo(() => (body ? renderReviewBody(body, format, unavailableImages, unavailableLabel) : ''), [body, format, unavailableImages, unavailableLabel])
  if (!body) return null
  return <><div className={cn('review-markdown min-w-0 break-words [&_h1]:mb-3 [&_h1]:text-xl [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:font-semibold [&_h4]:font-semibold [&_h5]:font-semibold [&_h6]:font-semibold [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:whitespace-pre [&_table]:my-3 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:border-collapse [&_td]:border [&_td]:border-stone-200 [&_td]:px-3 [&_td]:py-2 [&_th]:border [&_th]:border-stone-200 [&_th]:bg-stone-50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_img]:my-3 [&_img]:min-h-24 [&_img]:min-w-24 [&_img]:max-h-96 [&_img]:max-w-full [&_img]:rounded-xl [&_img]:object-contain dark:[&_td]:border-stone-700 dark:[&_th]:border-stone-700 dark:[&_th]:bg-stone-800', className)} onErrorCapture={(event) => {
    if (!(event.target instanceof HTMLImageElement)) return
    const url = event.target.getAttribute('src')
    if (url) setUnavailableImages((current) => current.includes(url) ? current : [...current, url])
  }} dangerouslySetInnerHTML={{ __html: html }} />{unavailableImages.length > 0 && <Button variant="ghost" size="sm" onClick={() => setUnavailableImages([])}>{_('contentFiles.retry')}</Button>}</>
}
