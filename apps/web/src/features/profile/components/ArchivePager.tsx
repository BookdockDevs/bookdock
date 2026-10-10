import { Button } from '@/components/ui/Button'
import { useTranslation } from '@/hooks/useTranslation'

interface ArchivePagerProps {
  page: number
  hasMore: boolean
  disabled?: boolean
  onChange: (page: number) => void
}

export default function ArchivePager({ page, hasMore, disabled, onChange }: ArchivePagerProps) {
  const _ = useTranslation()
  return (
    <nav aria-label={_('profileArchive.pagination')} className="mt-4 flex items-center justify-center gap-3">
      <Button size="sm" variant="ghost" disabled={disabled || page <= 1} onClick={() => onChange(page - 1)}>{_('profileArchive.previous')}</Button>
      <span className="text-xs tabular-nums text-stone-500">{page}</span>
      <Button size="sm" variant="ghost" disabled={disabled || !hasMore} onClick={() => onChange(page + 1)}>{_('profileArchive.next')}</Button>
    </nav>
  )
}
