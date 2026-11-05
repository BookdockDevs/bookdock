import { useState } from 'react'

import { cn } from '@/lib/utils'

interface AvatarProps {
  src?: string
  name: string
  decorative?: boolean
  className?: string
}

export default function Avatar({ src, name, decorative = false, className }: AvatarProps) {
  const [imageState, setImageState] = useState<{ src?: string; status: 'loading' | 'loaded' | 'failed' }>({ src, status: 'loading' })
  // Reset before committing so revisiting an earlier URL cannot reuse its stale loaded state.
  if (imageState.src !== src) setImageState({ src, status: 'loading' })
  const status = imageState.src === src ? imageState.status : 'loading'
  const showFallback = !src || status === 'failed'

  return (
    <span aria-hidden={decorative || undefined} className={cn('relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-200 font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-200', className)}>
      {showFallback ? (
        <span>
          {Array.from(name.trim())[0] || (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21a8 8 0 0 1 16 0" />
            </svg>
          )}
        </span>
      ) : (
        <img
          key={src}
          src={src}
          alt={name}
          className={cn('absolute inset-0 h-full w-full object-cover', status !== 'loaded' && 'opacity-0')}
          ref={(image) => {
            if (image?.complete && image.naturalWidth > 0) {
              setImageState((current) => current.src === src && current.status === 'loaded' ? current : { src, status: 'loaded' })
            }
          }}
          onLoad={() => setImageState({ src, status: 'loaded' })}
          onError={() => setImageState({ src, status: 'failed' })}
        />
      )}
    </span>
  )
}
