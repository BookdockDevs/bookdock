import VisibilityControl from '@/components/ui/VisibilityControl'
import { useTranslation } from '@/hooks/useTranslation'

interface IdeaVisibilityControlProps {
  value: 'private' | 'shared'
  onChange: (value: 'private' | 'shared') => void
  sourceReadable: boolean
  disabled?: boolean
}

export default function IdeaVisibilityControl({ value, onChange, sourceReadable, disabled }: IdeaVisibilityControlProps) {
  const _ = useTranslation()

  return (
    <VisibilityControl
      variant="reader"
      value={value}
      onChange={onChange}
      canShare={sourceReadable}
      disabled={disabled}
      shareHint={!sourceReadable ? _('annotation.visibilitySourceUnavailable') : undefined}
      showHintText={!sourceReadable}
      labels={{
        private: _('annotation.visibilityPrivate'),
        shared: _('annotation.visibilityPublic'),
        aria: _('annotation.visibility'),
      }}
      order={['shared', 'private']}
    />
  )
}
