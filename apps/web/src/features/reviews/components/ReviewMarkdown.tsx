import { useMemo } from 'react'

import type { ReviewBodyFormat } from '@bookdock/shared'

import { cn } from '@/lib/utils'

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
  const html = useMemo(() => (body ? renderReviewBody(body, format) : ''), [body, format])
  if (!body) return null
  return <div className={cn('review-markdown', className)} dangerouslySetInnerHTML={{ __html: html }} />
}
