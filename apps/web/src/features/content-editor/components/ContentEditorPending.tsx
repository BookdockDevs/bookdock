import { useTranslation } from '@/hooks/useTranslation'

interface ContentEditorPendingProps {
  stage?: 'opening' | 'content'
}

export default function ContentEditorPending({ stage = 'opening' }: ContentEditorPendingProps) {
  const _ = useTranslation()

  return (
    <main role="status" aria-busy="true" className="flex min-h-screen flex-col items-center justify-center gap-3 bg-stone-50 p-6 text-sm text-stone-500 dark:bg-stone-950 dark:text-stone-400">
      <svg aria-hidden="true" className="h-6 w-6 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M21 12a9 9 0 11-6.219-8.56" />
      </svg>
      <span>{stage === 'opening' ? _('editor.opening') : _('editor.loadingContent')}</span>
    </main>
  )
}
