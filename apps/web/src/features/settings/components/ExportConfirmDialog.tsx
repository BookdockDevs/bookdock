import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { useTranslation } from '@/hooks/useTranslation'
import { formatBytes } from '@/lib/utils'

interface ExportConfirmDialogProps {
  title?: string
  items: string[]
  estimatedBytes?: number
  zipHint?: boolean
  confirmDisabled?: boolean
  onConfirm: () => Promise<void> | void
  onClose: () => void
}

export default function ExportConfirmDialog({
  title,
  items,
  estimatedBytes,
  zipHint = false,
  confirmDisabled = false,
  onConfirm,
  onClose,
}: ExportConfirmDialogProps) {
  const _ = useTranslation()
  return (
    <ConfirmDialog
      title={title ?? _('settings.confirmExportTitle')}
      message={
        <>
          <p>{_('settings.exportConfirmCount', { count: items.length })}</p>
          {items.length > 0 && (
            <ul className="mt-2 max-h-40 list-disc overflow-y-auto break-words pl-4">
              {items.map((name, index) => (
                <li key={`${index}:${name}`}>{name}</li>
              ))}
            </ul>
          )}
          {(estimatedBytes !== undefined && estimatedBytes > 0) || zipHint ? (
            <p className="mt-2.5 text-xs text-stone-500 dark:text-stone-400">
              {estimatedBytes !== undefined && estimatedBytes > 0
                ? _('settings.exportEstimatedSize', { size: formatBytes(estimatedBytes) })
                : null}
              {estimatedBytes !== undefined && estimatedBytes > 0 && zipHint ? ' · ' : null}
              {zipHint ? _('settings.exportFormatZip') : null}
            </p>
          ) : null}
        </>
      }
      confirmLabel={_('settings.confirmExportAction')}
      confirmDisabled={confirmDisabled}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  )
}
