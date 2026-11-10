import { useAuthStore } from '@/stores/auth.store'
import { useUiStore } from '@/stores/ui.store'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

/**
 * The unified shelf's device-level "default add destination" preference: the
 * library add button and upload sheet default to it, surviving account switches.
 */
interface DefaultAddDestinationRowProps {
  serverUploadDisabled?: boolean
}

export default function DefaultAddDestinationRow({ serverUploadDisabled = false }: DefaultAddDestinationRowProps) {
  const _ = useTranslation()
  const user = useAuthStore((state) => state.user)
  const destination = useUiStore((state) => state.defaultAddDestination)
  const setDestination = useUiStore((state) => state.setDefaultAddDestination)
  const serverDisabled = !user || (serverUploadDisabled && user.role !== 'owner')
  const effectiveDestination = destination === 'server' && !serverDisabled ? 'server' : 'local'

  const options: Array<{ value: 'server' | 'local'; labelKey: string; disabled?: boolean; title?: string }> = [
    {
      value: 'server',
      labelKey: 'library.sourceRemote',
      disabled: serverDisabled,
      title: serverUploadDisabled ? _('library.serverUploadDisabled') : undefined,
    },
    { value: 'local', labelKey: 'library.sourceLocal' },
  ]

  return (
    <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium text-stone-700 dark:text-stone-200">{_('library.defaultAddDestination')}</p>
        <p className="mt-0.5 text-xs text-stone-400 dark:text-stone-500">{_('library.defaultAddDestinationHint')}</p>
      </div>
      <div
        className="inline-flex shrink-0 items-center gap-0.5 self-start rounded-lg bg-stone-100 p-0.5 sm:self-auto dark:bg-stone-800"
        role="group"
        aria-label={_('library.defaultAddDestination')}
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={option.disabled}
            title={option.title}
            aria-pressed={effectiveDestination === option.value}
            onClick={() => setDestination(option.value)}
            className={cn(
              'flex h-7 items-center justify-center whitespace-nowrap rounded-md px-3 text-xs font-medium transition-all disabled:cursor-not-allowed disabled:opacity-40',
              effectiveDestination === option.value
                ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-stone-100'
                : 'text-stone-500 hover:text-stone-800 dark:hover:text-stone-200',
            )}
          >
            {_(option.labelKey)}
          </button>
        ))}
      </div>
    </div>
  )
}
