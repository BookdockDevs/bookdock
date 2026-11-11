import SegmentedControl from '@/components/ui/SegmentedControl'
import { useTranslation } from '@/hooks/useTranslation'
import { useAuthStore } from '@/stores/auth.store'
import { useUiStore } from '@/stores/ui.store'

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

  return (
    <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium text-stone-700 dark:text-stone-200">{_('library.defaultAddDestination')}</p>
        <p className="mt-0.5 text-xs text-stone-400 dark:text-stone-500">{_('library.defaultAddDestinationHint')}</p>
      </div>
      <SegmentedControl
        ariaLabel={_('library.defaultAddDestination')}
        value={effectiveDestination}
        onChange={setDestination}
        className="self-start sm:self-auto"
        options={[
          {
            value: 'server',
            label: _('library.bookSourceServer'),
            disabled: serverDisabled,
            title: serverUploadDisabled ? _('library.serverUploadDisabled') : undefined,
          },
          { value: 'local', label: _('library.bookSourceLocal') },
        ]}
      />
    </div>
  )
}
