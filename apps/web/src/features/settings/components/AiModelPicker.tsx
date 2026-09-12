import { useMemo, useState, type FormEvent } from 'react'

import type { AiModelRes, AiProviderRes } from '@bookdock/shared'
import { getAiModelCapabilityFlags } from '@bookdock/shared'

import AiBrandIcon from '@/components/ui/AiBrandIcon'
import Modal from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'

import AiModelIcon from './AiModelIcon'

interface AiModelPickerProps {
  title: string
  models: AiModelRes[]
  addedModels: AiModelRes[]
  provider?: Pick<AiProviderRes, 'id' | 'name'> | string | null
  fetching: boolean
  stale: boolean
  onFetch: () => void
  onAdd: (model: AiModelRes) => void
  onRemove: (modelId: string) => void
  onClose: () => void
}

function SearchIcon() {
  return <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
}

function PlusIcon() {
  return <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
}

function MinusIcon() {
  return <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>
}

export default function AiModelPicker({ title, models, addedModels, provider, fetching, stale, onFetch, onAdd, onRemove, onClose }: AiModelPickerProps) {
  const _ = useTranslation()
  const [search, setSearch] = useState('')
  const [manualModel, setManualModel] = useState('')
  const addedIds = useMemo(() => new Set(addedModels.map((model) => model.id)), [addedModels])
  const groups = useMemo(() => {
    const query = search.trim().toLowerCase()
    const visible = models.filter((model) => !query || `${model.id} ${model.name} ${model.ownedBy ?? ''}`.toLowerCase().includes(query))
    const grouped = new Map<string, AiModelRes[]>()
    for (const model of visible) {
      const group = model.ownedBy?.trim() || _('settings.aiModelOther')
      const current = grouped.get(group) ?? []
      current.push(model)
      grouped.set(group, current)
    }
    return [...grouped.entries()]
  }, [_, models, search])

  function addManualModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const id = manualModel.trim()
    if (!id) return
    onAdd({ id, name: id })
    setManualModel('')
  }

  return (
    <Modal title={title} size="wide" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 rounded-xl bg-stone-100 px-3 py-2 dark:bg-stone-800">
          <SearchIcon />
          <input aria-label={_('settings.aiModelSearch')} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={_('settings.aiModelSearchPlaceholder')} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-stone-400" />
          <button type="button" onClick={onFetch} disabled={fetching} className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:bg-white hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-50 dark:text-stone-300 dark:hover:bg-stone-700 dark:hover:text-stone-100">
            <svg className={`h-4 w-4 ${fetching ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 5v4h4M4 13a8.1 8.1 0 0 0 15.5 2M20 19v-4h-4" /></svg>
            {_(fetching ? 'settings.aiModelsFetching' : 'settings.aiModelsFetch')}
          </button>
        </div>
        {stale && <p className="text-[11px] text-amber-600 dark:text-amber-400">{_('settings.aiModelsStale')}</p>}

        <div className="max-h-[46vh] overflow-y-auto custom-scrollbar [scrollbar-gutter:stable] rounded-xl border border-stone-200 dark:border-stone-700">
          {groups.length === 0 ? <p className="px-4 py-10 text-center text-sm text-stone-400">{models.length ? _('settings.aiModelSearchEmpty') : _('settings.aiModelPickerEmpty')}</p> : groups.map(([group, groupModels]) => (
            <section key={group}>
              <div className="sticky top-0 flex items-center justify-between bg-stone-100 px-4 py-2 text-xs font-semibold text-stone-700 dark:bg-stone-800 dark:text-stone-200">
                <span className="flex min-w-0 items-center gap-2"><AiBrandIcon name={group} className="h-5 w-5" /><span className="truncate">{group}</span></span>
                <span className="font-normal text-stone-400">{groupModels.length}</span>
              </div>
              <div className="divide-y divide-stone-100 dark:divide-stone-800">
                {groupModels.map((model) => {
                  const added = addedIds.has(model.id)
                  const capabilities = getAiModelCapabilityFlags(model)
                  const hasCapability = capabilities.vision || capabilities.tools || capabilities.reasoning || capabilities.embedding
                  return <div key={model.id} className="flex items-center gap-3 px-4 py-3">
                    <AiBrandIcon model={model} provider={provider} className={`h-8 w-8 ${capabilities.embedding ? 'bg-violet-50 dark:bg-violet-950/40' : ''}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-stone-800 dark:text-stone-100">{model.name}</p>
                      {model.name !== model.id && <p className="truncate text-[11px] text-stone-400">{model.id}</p>}
                      <div className="mt-1 flex flex-wrap gap-1">
                        {capabilities.embedding && <span className="rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-600 dark:bg-violet-950/40 dark:text-violet-300">{_('settings.aiEmbeddingTag')}</span>}
                        {capabilities.vision && <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600 dark:bg-blue-950/40 dark:text-blue-300"><AiModelIcon kind="vision" />{_('settings.aiVisionTag')}</span>}
                        {capabilities.tools && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300"><AiModelIcon kind="tools" />{_('settings.aiToolsTag')}</span>}
                        {capabilities.reasoning && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600 dark:bg-amber-950/40 dark:text-amber-300"><AiModelIcon kind="reasoning" />{_('settings.aiReasoningTag')}</span>}
                        {!hasCapability && <span className="rounded-full bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-400 dark:bg-stone-800 dark:text-stone-500">{_('settings.aiCapabilitiesUnknown')}</span>}
                      </div>
                    </div>
                    {added ? <button type="button" onClick={() => onRemove(model.id)} aria-label={`${_('settings.aiModelRemove')} ${model.id}`} title={_('settings.aiModelRemove')} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-stone-200 text-stone-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-500 dark:border-stone-700 dark:hover:border-red-900 dark:hover:bg-stone-800"><MinusIcon /></button> : <button type="button" onClick={() => onAdd(model)} aria-label={`${_('settings.aiModelAdd')} ${model.id}`} title={_('settings.aiModelAdd')} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-stone-200 text-stone-500 transition-colors hover:border-stone-400 hover:bg-stone-50 hover:text-stone-900 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"><PlusIcon /></button>}
                  </div>
                })}
              </div>
            </section>
          ))}
        </div>

        <form className="flex gap-2" onSubmit={addManualModel}>
          <input aria-label={_('settings.aiManualModel')} value={manualModel} onChange={(event) => setManualModel(event.target.value)} placeholder={_('settings.aiManualModelPlaceholder')} className="h-9 min-w-0 flex-1 rounded-lg border border-stone-200 bg-transparent px-3 text-sm outline-none focus:border-blue-500 dark:border-stone-700" />
          <button type="submit" disabled={!manualModel.trim()} className="shrink-0 rounded-lg border border-stone-200 px-3 py-2 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-40 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800">{_('settings.aiModelAdd')}</button>
        </form>
      </div>
    </Modal>
  )
}
