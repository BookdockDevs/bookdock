import type { MetadataProvider } from '@bookdock/shared'

interface MetadataProviderIconProps {
  provider: MetadataProvider | string
  className?: string
  size?: number
}

const ICON_ASSETS: Record<string, string> = {
  qidian: '/metadata-icons/qidian.png',
  douban: '/metadata-icons/douban.png',
  weread: '/metadata-icons/weread.png',
  bangumi: '/metadata-icons/bangumi.png',
  openlibrary: '/metadata-icons/openlibrary.png',
}

const OPTICAL_SCALES: Record<string, string> = {
  bangumi: 'scale-[1.24]',
  googlebooks: 'scale-[1.10]',
}

export default function MetadataProviderIcon({ provider, className = 'size-5', size = 20 }: MetadataProviderIconProps) {
  const opticalClass = OPTICAL_SCALES[provider] ?? ''

  if (provider === 'googlebooks') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" className={`shrink-0 transition-transform ${opticalClass} ${className}`}>
        <path
          fill="#4285F4"
          d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17Z"
        />
        <path
          fill="#34A853"
          d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24Z"
        />
        <path
          fill="#FBBC05"
          d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15Z"
        />
        <path
          fill="#EA4335"
          d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98Z"
        />
      </svg>
    )
  }

  const asset = ICON_ASSETS[provider]
  if (asset) {
    return (
      <img
        src={asset}
        alt=""
        width={size}
        height={size}
        className={`shrink-0 rounded-[4px] object-cover transition-transform ${opticalClass} ${className}`}
      />
    )
  }

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-stone-400 ${className}`}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}
