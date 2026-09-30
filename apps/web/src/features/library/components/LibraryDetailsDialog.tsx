import type { LibraryListItem } from '@bookdock/shared'

import Modal from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'

import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/format-date'

interface LibraryDetailsDialogProps {
  library: LibraryListItem
  onClose: () => void
}

/**
 * Everything a shared-library row carries, gathered in one place: the sidebar is
 * a switching surface, so the numbers a newcomer actually asks for (who runs it,
 * how big it is, when it appeared) live here instead of crowding a row that is
 * scanned dozens of times a day. The personal library has no menu entry here —
 * a one-person library has no roster or owner to report.
 */
export default function LibraryDetailsDialog({ library, onClose }: LibraryDetailsDialogProps) {
  const _ = useTranslation()
  const visibility = library.visibility ?? 'private'
  const facts: Array<{ label: string; value: string }> = [
    { label: _('library.owner'), value: library.ownerUsername },
    { label: _('library.memberCountLabel'), value: String(library.memberCount) },
    { label: _('library.workCountLabel'), value: String(library.workCount) },
    { label: _('library.createdAt'), value: formatDate(library.createdAt) },
  ]

  return (
    <Modal
      title={_('library.detailsTitle')}
      onClose={onClose}
      closeLabel={_('library.close')}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m16 6 4 14" />
              <path d="M12 6v14" />
              <path d="M8 8v12" />
              <path d="M4 4v16" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">{library.name}</h3>
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium',
                  visibility === 'public'
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                    : visibility === 'password'
                      ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
                      : 'bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400',
                )}
              >
                {_(`library.visibility${visibility === 'public' ? 'Public' : visibility === 'password' ? 'Password' : 'Private'}`)}
              </span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed whitespace-pre-wrap text-stone-500 dark:text-stone-400">
              {library.description || _('library.noDescription')}
            </p>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-stone-200/80 bg-stone-50/50 p-3.5 sm:grid-cols-4 dark:border-stone-800 dark:bg-stone-850/40">
          {facts.map((fact) => (
            <div key={fact.label} className="min-w-0">
              <dt className="text-[11px] text-stone-400 dark:text-stone-500">{fact.label}</dt>
              <dd className="mt-0.5 truncate text-sm font-medium text-stone-800 dark:text-stone-200" title={fact.value}>{fact.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Modal>
  )
}
