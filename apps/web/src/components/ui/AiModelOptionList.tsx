import type { AiModelEntryRes } from '@bookdock/shared'

import AiBrandIcon from '@/components/ui/AiBrandIcon'
import { CheckIcon } from '@/features/reader/components/annotation-icons'

export interface AiModelGroup {
  id: string
  name: string
  models: AiModelEntryRes[]
}

interface AiModelOptionListProps {
  groups: AiModelGroup[]
  selectedModelId: string | null
  onSelect: (modelId: string) => void
}

/** Grouped model rows shared by the reader's chat and translation pickers. */
export default function AiModelOptionList({ groups, selectedModelId, onSelect }: AiModelOptionListProps) {
  return (
    <>
      {groups.map((group) => (
        <div key={group.id} className="mb-1.5 last:mb-0">
          <div className="px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--bd-read-sub)]">{group.name}</div>
          {group.models.map((model) => {
            const isSelected = model.id === selectedModelId
            const hasId = model.name !== model.upstreamModelId
            return (
              <button
                key={model.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                title={hasId ? `${model.name} (${model.upstreamModelId})` : model.name}
                onClick={() => onSelect(model.id)}
                className={`flex min-h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-left text-xs transition-colors ${
                  isSelected ? 'bg-[var(--bd-read-primary)]/15 font-medium text-[var(--bd-read-text)]' : 'text-[var(--bd-read-text)] hover:bg-stone-500/10'
                }`}
              >
                <AiBrandIcon name={model.name} model={{ id: model.upstreamModelId, name: model.name }} provider={model.provider} className="h-3.5 w-3.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{model.name}</p>
                  {hasId && <p className="truncate text-[10px] text-[var(--bd-read-sub)]">{model.upstreamModelId}</p>}
                </div>
                {isSelected && <span className="ml-1 shrink-0 text-[var(--bd-read-primary)]"><CheckIcon size={14} className="stroke-[2.2]" /></span>}
              </button>
            )
          })}
        </div>
      ))}
    </>
  )
}
