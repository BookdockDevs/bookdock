import type { ReactNode } from 'react'

export type ThemeIconName = 'theme' | 'palette' | 'css' | 'highlight' | 'plus' | 'edit' | 'check' | 'more' | 'follow' | 'preview' | 'upload' | 'download' | 'close' | 'copy' | 'delete' | 'image' | 'spark' | 'up' | 'down'

const paths: Record<ThemeIconName, ReactNode> = {
  theme: <><rect x="6" y="6" width="13" height="13" rx="2" /><path d="M15 3H5a2 2 0 0 0-2 2v10" /></>,
  palette: <><path d="M12 3a9 9 0 1 0 0 18h1.4a2 2 0 0 0 1.5-3.3 2 2 0 0 1 1.5-3.2H18c2 0 3-1.4 3-3.1A9 9 0 0 0 12 3Z" /><path d="M7 12h.01M9 8h.01M14 7h.01M17 10h.01" strokeWidth="2.5" /></>,
  css: <path d="m8 7-5 5 5 5m8-10 5 5-5 5m-2-14-4 18" />,
  highlight: <path d="m5 14 9-9 5 5-9 9H5v-5Zm7-7 5 5M3 22h10" />,
  plus: <path d="M12 5v14M5 12h14" />,
  edit: <path d="m13 6 5 5M4 20l4.5-1 11-11a2 2 0 0 0-3-3l-11 11L4 20Z" />,
  check: <path d="m5 12 4 4L19 6" />,
  more: <path d="m6 9 6 6 6-6" />,
  follow: <><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></>,
  preview: <><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z" /><circle cx="12" cy="12" r="2.3" /></>,
  upload: <path d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4" />,
  download: <path d="M12 4v12m-5-5 5 5 5-5M4 16v4h16v-4" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 4H6a2 2 0 0 0-2 2v10" /></>,
  delete: <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" />,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8" cy="9" r="1.5" /><path d="m4 17 5-4 4 3 4-5 4 4" /></>,
  spark: <><path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" /><path d="m19 15 .75 2.25L22 18l-2.25.75L19 21l-.75-2.25L16 18l2.25-.75z" /></>,
  up: <path d="m18 15-6-6-6 6" />,
  down: <path d="m6 9 6 6 6-6" />,
}

export default function ThemeIcon({
  name,
  size = 16,
  className,
  fill = 'none',
}: {
  name: ThemeIconName
  size?: number
  className?: string
  fill?: string
}) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {paths[name]}
    </svg>
  )
}
