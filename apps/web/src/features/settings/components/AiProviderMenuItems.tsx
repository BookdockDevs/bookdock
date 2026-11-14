import type { AiProvider, AiProviderRes } from '@bookdock/shared'

import AiBrandIcon from '@/components/ui/AiBrandIcon'
import { menuItemClass } from '@/components/ui/SmartMenu'
import { useTranslation } from '@/hooks/useTranslation'

interface AiProviderMenuItemsProps {
  providers: AiProviderRes[]
  onPick: (provider: AiProvider) => void
}

/** Icon + name rows shared by the "add connection" menu and the editor's provider picker. */
export default function AiProviderMenuItems({ providers, onPick }: AiProviderMenuItemsProps) {
  const _ = useTranslation()
  return (
    <div className="flex flex-col gap-0.5">
      {providers.map((provider) => (
        <button
          key={provider.id}
          type="button"
          onClick={() => onPick(provider.id)}
          className={menuItemClass}
          title={provider.name}
        >
          <AiBrandIcon provider={provider} className="h-5 w-5" />
          <span className="truncate">{provider.name}</span>
        </button>
      ))}
    </div>
  )
}
