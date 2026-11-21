import { useMemo, useState } from 'react'

import { getAiModelCapabilityFlags, isAiEmbeddingModel, type AiConnectionRes, type AiModelEntryRes } from '@bookdock/shared'

import { useCreateAiModel, useDeleteAiModel, useRefreshAiConnectionModels, useTestAiModel } from '@/api/hooks/useAi'
import AiBrandIcon from '@/components/ui/AiBrandIcon'
import Modal from '@/components/ui/Modal'
import Toggle from '@/components/ui/Toggle'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'

import AiModelIcon from './AiModelIcon'
import SettingsFormActions from './SettingsFormActions'
import { PlusIcon } from './row-icons'
import { settingsFormClass, settingsInputClass } from './settingsForm'

interface AiModelsPanelProps {
  connection: AiConnectionRes
  models: AiModelEntryRes[]
  /** Draft exposure overrides held by the parent until the form is saved. */
  enabledDrafts?: Record<string, boolean>
  onToggleEnabled?: (modelId: string, enabled: boolean) => void
}

function CapabilityTags({ model }: { model: AiModelEntryRes }) {
  const _ = useTranslation()
  const flags = getAiModelCapabilityFlags({ id: model.upstreamModelId, name: model.name, capabilities: model.capabilities })
  const hasCapability = flags.vision || flags.tools || flags.reasoning || flags.embedding
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {flags.embedding && <span className="rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-600 dark:bg-violet-950/40 dark:text-violet-300">{_('settings.aiEmbeddingTag')}</span>}
      {flags.vision && <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600 dark:bg-blue-950/40 dark:text-blue-300"><AiModelIcon kind="vision" />{_('settings.aiVisionTag')}</span>}
      {flags.tools && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300"><AiModelIcon kind="tools" />{_('settings.aiToolsTag')}</span>}
      {flags.reasoning && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600 dark:bg-amber-950/40 dark:text-amber-300"><AiModelIcon kind="reasoning" />{_('settings.aiReasoningTag')}</span>}
      {!hasCapability && <span className="rounded-full bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-400 dark:bg-stone-800 dark:text-stone-500">{_('settings.aiCapabilitiesUnknown')}</span>}
    </span>
  )
}

/** The model library of one connection: heading with count, list, and add/fetch actions. */
export default function AiModelsPanel({ connection, models, enabledDrafts, onToggleEnabled }: AiModelsPanelProps) {
  const _ = useTranslation()
  const canManage = connection.mine
  const create = useCreateAiModel()
  const remove = useDeleteAiModel()
  const refresh = useRefreshAiConnectionModels()
  const test = useTestAiModel()
  const [addOpen, setAddOpen] = useState(false)
  const [manual, setManual] = useState('')
  const [testingId, setTestingId] = useState<string | null>(null)
  const ordered = useMemo(() => [...models].sort((a, b) => a.createdAt - b.createdAt), [models])
  const showError = (error: unknown) => notify.error(getUserErrorNotification(error, 'settings.aiOperationFailed'))

  function addManual() {
    const upstreamModelId = manual.trim()
    if (!upstreamModelId) return
    create.mutate({ connectionId: connection.id, body: { upstreamModelId } }, {
      onSuccess: () => { setManual(''); setAddOpen(false); notify.success({ key: 'settings.aiModelAdded' }) },
      onError: showError,
    })
  }

  function refreshModels() {
    refresh.mutate({ connectionId: connection.id }, {
      onSuccess: (response) => notify.success({ key: 'settings.aiModelsFetched', params: { count: response.data.length } }),
      onError: showError,
    })
  }

  function testModel(model: AiModelEntryRes) {
    setTestingId(model.id)
    test.mutate(model.id, {
      onSuccess: (response) => { setTestingId(null); notify.success({ key: 'settings.aiTestSuccess', params: { model: response.data.upstreamModelId, latency: response.data.latencyMs } }) },
      onError: (error) => { setTestingId(null); showError(error) },
    })
  }

  const headerIconButton = 'flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-stone-800 dark:hover:text-stone-200'

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex min-w-0 items-baseline gap-1.5 text-sm font-semibold text-stone-900 dark:text-stone-100">
            <span>{_('settings.aiModelsHeading')}</span>
            {ordered.length > 0 && <span className="text-xs font-normal tabular-nums text-stone-400 dark:text-stone-500">· {ordered.length}</span>}
          </h3>
          {canManage && (
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={refreshModels}
                disabled={refresh.isPending}
                aria-label={_(refresh.isPending ? 'settings.aiModelsFetching' : 'settings.aiModelsFetch')}
                title={_(refresh.isPending ? 'settings.aiModelsFetching' : 'settings.aiModelsFetch')}
                className={headerIconButton}
              >
                <svg className={`h-4 w-4 ${refresh.isPending ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 5v4h4M4 13a8.1 8.1 0 0 0 15.5 2M20 19v-4h-4" /></svg>
              </button>
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                aria-label={_('settings.aiManualModel')}
                title={_('settings.aiManualModel')}
                className={headerIconButton}
              >
                <PlusIcon />
              </button>
            </div>
          )}
        </div>

        {ordered.length === 0 ? (
          <p className="rounded-xl border border-dashed border-stone-200 px-4 py-10 text-center text-sm text-stone-400 dark:border-stone-700">{_('settings.aiModelsNone')}</p>
        ) : (
          <div className="divide-y divide-stone-100 rounded-xl border border-stone-200 dark:divide-stone-800 dark:border-stone-700">
            {ordered.map((model) => {
              const embedding = isAiEmbeddingModel({ id: model.upstreamModelId, name: model.name })
              return (
                <div key={model.id} className="flex items-center gap-3 px-3 py-3">
                  <AiBrandIcon model={{ id: model.upstreamModelId, name: model.name }} provider={connection.provider} className={`h-8 w-8 ${embedding ? 'bg-violet-50 dark:bg-violet-950/40' : ''}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-stone-800 dark:text-stone-100">{model.name}</p>
                    {model.name !== model.upstreamModelId && <p className="truncate text-[11px] text-stone-400">{model.upstreamModelId}</p>}
                    <CapabilityTags model={model} />
                  </div>
                  {canManage && (
                    <Toggle
                      checked={enabledDrafts?.[model.id] ?? model.enabled}
                      onChange={(enabled) => onToggleEnabled?.(model.id, enabled)}
                      ariaLabel={`${_('settings.aiModelExpose')} ${model.name}`}
                    />
                  )}
                  <div className="flex shrink-0 items-center gap-1">
                    {!embedding && (
                      <button type="button" disabled={test.isPending} onClick={() => testModel(model)} aria-label={`${_(testingId === model.id ? 'settings.aiTesting' : 'settings.aiTest')} ${model.name}`} title={_(testingId === model.id ? 'settings.aiTesting' : 'settings.aiTest')} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-blue-50 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-stone-800 dark:hover:text-blue-300">
                        <AiModelIcon kind="test" className={testingId === model.id ? 'h-4 w-4 animate-pulse' : 'h-4 w-4'} />
                      </button>
                    )}
                    {canManage && (
                      <button type="button" onClick={() => remove.mutate(model.id, { onSuccess: () => notify.success({ key: 'settings.aiModelDeleted' }), onError: showError })} aria-label={`${_('settings.aiModelRemove')} ${model.name}`} title={_('settings.aiModelRemove')} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-stone-800">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {addOpen && (
        <Modal title={_('settings.aiManualModel')} onClose={create.isPending ? () => undefined : () => setAddOpen(false)}>
          <form className={settingsFormClass} onSubmit={(event) => { event.preventDefault(); addManual() }}>
            <input
              autoFocus
              value={manual}
              onChange={(event) => setManual(event.target.value)}
              placeholder={_('settings.aiManualModelPlaceholder')}
              aria-label={_('settings.aiManualModel')}
              className={settingsInputClass}
            />
            <SettingsFormActions onCancel={() => setAddOpen(false)} pending={create.isPending} saveDisabled={!manual.trim()} />
          </form>
        </Modal>
      )}
    </>
  )
}
