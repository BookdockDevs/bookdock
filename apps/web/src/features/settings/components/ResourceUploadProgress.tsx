import { useTranslation } from '@/hooks/useTranslation'

interface ResourceUploadProgressProps {
  fileName: string
  progress: number
  phase: 'uploading' | 'processing'
}

export default function ResourceUploadProgress({ fileName, progress, phase }: ResourceUploadProgressProps) {
  const _ = useTranslation()
  return (
    <div className="mb-3 flex items-center gap-3 rounded-xl bg-stone-50 px-3 py-2 text-xs dark:bg-stone-800/60">
      <span className="shrink-0 text-stone-500 dark:text-stone-400">
        <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      </span>
      <span className="min-w-0 flex-1 truncate text-stone-700 dark:text-stone-300">
        {fileName}
      </span>
      <span className="shrink-0 tabular-nums text-stone-400 dark:text-stone-500">
        {phase === 'processing' ? _('library.processing') : `${progress}%`}
      </span>
      <span className="w-24 shrink-0">
        <span className="block h-1.5 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700">
          <span
            className="block h-full rounded-full bg-stone-800 transition-all duration-200 dark:bg-stone-200"
            style={{ width: `${phase === 'processing' ? 100 : progress}%` }}
          />
        </span>
      </span>
    </div>
  )
}
