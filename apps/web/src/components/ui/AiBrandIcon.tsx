import type { AiModelRes, AiProviderRes } from '@bookdock/shared'

import { resolveAiBrand } from '@/lib/aiBrandIcons'

interface AiBrandIconProps {
  name?: string | null
  model?: Pick<AiModelRes, 'id' | 'name' | 'ownedBy'> | null
  provider?: Pick<AiProviderRes, 'id' | 'name'> | string | null
  className?: string
  selected?: boolean
}

export default function AiBrandIcon({ name, model, provider, className = 'h-8 w-8', selected = false }: AiBrandIconProps) {
  const { asset, label, fallback, adaptive } = resolveAiBrand({ name, model, provider })

  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800 ${selected ? 'ring-2 ring-stone-700 ring-offset-1 ring-offset-white dark:ring-stone-300 dark:ring-offset-stone-900' : ''} ${className}`}
      title={label}
    >
      {asset ? <img src={asset} alt="" aria-hidden="true" decoding="async" className={`h-[68%] w-[68%] object-contain ${adaptive ? 'dark:invert' : ''}`} /> : <span className="text-[0.58em] font-semibold text-stone-500 dark:text-stone-300">{fallback}</span>}
    </span>
  )
}
