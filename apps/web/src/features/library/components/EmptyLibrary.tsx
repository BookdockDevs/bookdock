import { useTranslation } from '@/hooks/useTranslation'

export default function EmptyLibrary() {
  const _ = useTranslation()
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <div className="mb-1 flex h-20 w-20 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-stone-200/70 dark:bg-stone-900 dark:ring-stone-800">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-stone-300 dark:text-stone-600">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z" />
          <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
        </svg>
      </div>
      <p className="font-serif text-lg font-medium text-stone-700 dark:text-stone-200">{_('library.empty')}</p>
      <p className="text-sm text-stone-400 dark:text-stone-500">{_('library.emptyHint')}</p>
    </div>
  )
}
