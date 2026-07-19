import { t } from '@/i18n'
import { Button } from '@/components/ui/Button'

interface EmptyLibraryProps {
  onUploadClick: () => void
}

export default function EmptyLibrary({ onUploadClick }: EmptyLibraryProps) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-stone-200">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z" />
        <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
      </svg>
      <p className="text-lg font-medium text-stone-700">{t().library.empty}</p>
      <p className="text-sm text-stone-400">{t().library.emptyHint}</p>
      <Button className="mt-2" onClick={onUploadClick}>
        {t().library.upload}
      </Button>
    </div>
  )
}