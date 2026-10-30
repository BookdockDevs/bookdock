import { useState } from 'react'

import type { MetadataProvider } from '@bookdock/shared'

interface MetadataProviderIconProps {
  provider: MetadataProvider | string
  className?: string
  size?: number
  label?: string
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

const BADGE_CLASSES = [
  'bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-300',
  'bg-orange-100 text-orange-600 dark:bg-orange-500/20 dark:text-orange-300',
  'bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300',
  'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300',
  'bg-sky-100 text-sky-600 dark:bg-sky-500/20 dark:text-sky-300',
  'bg-violet-100 text-violet-600 dark:bg-violet-500/20 dark:text-violet-300',
] as const

function badgeClass(sourceId: string) {
  let hash = 0
  for (let index = 0; index < sourceId.length; index += 1) hash = (hash * 31 + sourceId.charCodeAt(index)) >>> 0
  return BADGE_CLASSES[hash % BADGE_CLASSES.length]
}

function ProviderFallbackIcon({ className, size }: { className: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-stone-400 ${className}`}>
      <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 1.998c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z" />
    </svg>
  )
}

function SourceLetterBadge({ label, sourceId, className, size }: { label: string; sourceId: string; className: string; size: number }) {
  const letter = [...label.trim()][0] ?? '?'
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-[4px] font-semibold ${badgeClass(sourceId)} ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.46)), lineHeight: 1 }}
    >
      {letter}
    </span>
  )
}

function PersonalSourceIcon({ sourceId, label, className, size }: { sourceId: string; label?: string; className: string; size: number }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return label
      ? <SourceLetterBadge label={label} sourceId={sourceId} className={className} size={size} />
      : <ProviderFallbackIcon className={className} size={size} />
  }
  return (
    <img
      src={`/api/v1/integrations/personal-sources/${encodeURIComponent(sourceId)}/icon`}
      alt=""
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className={`shrink-0 rounded-[4px] object-cover ${className}`}
    />
  )
}

export default function MetadataProviderIcon({ provider, className = 'size-5', size = 20, label }: MetadataProviderIconProps) {
  const opticalClass = OPTICAL_SCALES[provider] ?? ''

  if (typeof provider === 'string' && provider.startsWith('personal:')) {
    return <PersonalSourceIcon sourceId={provider.slice('personal:'.length)} label={label} className={className} size={size} />
  }

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

  return <ProviderFallbackIcon className={className} size={size} />
}
