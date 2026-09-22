import { useEffect, useMemo, useRef, useState } from 'react'

import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useNavigate } from '@tanstack/react-router'

import { getAiModelCapabilityFlags, isAiEmbeddingModel } from '@bookdock/shared'
import type { AiModelRes, AiProfileRes, AiPromptTemplate, AiPromptTemplateInput, AiProvider, AiProviderRes } from '@bookdock/shared'

import { useActivateAiProfile, useAiConfig, useAiProviders, useCreateAiProfile, useDeleteAiProfile, useFetchAiModels, useTestAiConfigDraft, useUpdateAiConfig, useUpdateAiProfile } from '@/api/hooks/useAi'
import AiBrandIcon from '@/components/ui/AiBrandIcon'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Modal from '@/components/ui/Modal'
import QueryErrorState from '@/components/ui/QueryErrorState'
import SettingsEmptyState from '@/components/ui/SettingsEmptyState'
import { useDismissiblePopup } from '@/hooks/useDismissiblePopup'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { useAuthStore } from '@/stores/auth.store'

import AiModelIcon from './AiModelIcon'
import AiModelPicker from './AiModelPicker'
import AiPromptRow from './AiPromptRow'
import EditModeButton from './EditModeButton'
import SettingsCard from './SettingsCard'
import SettingsFormActions from './SettingsFormActions'
import SettingsFormField from './SettingsFormField'
import { settingsFormClass, settingsInputClass, settingsTextareaClass } from './settingsForm'

interface AiFormState {
  id?: string
  name: string
  provider: AiProvider
  baseUrl: string
  model: string
  models: AiModelRes[]
  apiKey: string
}

type AiRetrievalMode = 'lexical' | 'semantic'

interface AiPromptFormState {
  id?: string
  name: string
  prompt: string
}

const AI_PROMPT_VARIABLES = ['{SELTEXT}', '{SELPARA}', '{CHAPTER}'] as const

function fingerprint(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

const FALLBACK_PROVIDERS: AiProviderRes[] = [
  { id: 'openai', name: 'OpenAI', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: null, requiresApiKey: true },
  { id: 'anthropic', name: 'Claude', protocol: 'anthropic', defaultBaseUrl: 'https://api.anthropic.com', defaultModel: 'claude-3-5-sonnet-latest', requiresApiKey: true },
  { id: 'gemini', name: 'Gemini', protocol: 'gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com', defaultModel: 'gemini-2.5-flash', requiresApiKey: true },
  { id: 'ollama', name: 'Ollama', protocol: 'ollama', defaultBaseUrl: 'http://localhost:11434', defaultModel: 'llama3.2', requiresApiKey: false },
  { id: 'lmstudio', name: 'LM Studio', protocol: 'openai-compatible', defaultBaseUrl: 'http://localhost:1234/v1', defaultModel: null, requiresApiKey: false },
  { id: 'deepseek', name: 'DeepSeek', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-chat', requiresApiKey: true },
  { id: 'qwen', name: '通义千问', protocol: 'openai-compatible', defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-plus', requiresApiKey: true },
  { id: 'glm', name: '智谱 GLM', protocol: 'openai-compatible', defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4-flash', requiresApiKey: true },
  { id: 'moonshot', name: 'Moonshot / Kimi', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'moonshot-v1-8k', requiresApiKey: true },
  { id: 'openrouter', name: 'OpenRouter', protocol: 'openai-compatible', defaultBaseUrl: 'https://openrouter.ai/api/v1', defaultModel: null, requiresApiKey: true },
  { id: 'siliconflow', name: 'SiliconFlow', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.siliconflow.cn/v1', defaultModel: null, requiresApiKey: true },
  { id: 'minimax', name: 'MiniMax', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.minimaxi.com/v1', defaultModel: 'MiniMax-Text-01', requiresApiKey: true },
  { id: 'mimo', name: 'MiMo', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.xiaomimimo.com/v1', defaultModel: null, requiresApiKey: true },
]

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  )
}

function ManageModelsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="8" cy="6" r="1.5" />
      <circle cx="16" cy="12" r="1.5" />
      <circle cx="10" cy="18" r="1.5" />
    </svg>
  )
}

function RestoreDefaultsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 14-5-5 5-5" />
      <path d="M4 9h10.5A5.5 5.5 0 1 1 9 19H8" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  )
}

function SparklesIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z" />
    </svg>
  )
}

function defaultPromptTemplates(_: (key: string) => string): AiPromptTemplate[] {
  return [
    { id: 'explain-selection', name: _('reader.aiQuickExplain'), prompt: _('reader.aiQuickExplainPrompt'), scope: 'selection', enabled: true, order: 10, builtIn: true },
    { id: 'translate-selection', name: _('reader.aiQuickTranslate'), prompt: _('reader.aiQuickTranslatePrompt'), scope: 'selection', enabled: true, order: 20, builtIn: true },
    { id: 'summarize-selection', name: _('reader.aiQuickSummarize'), prompt: _('reader.aiQuickSummarizePrompt'), scope: 'selection', enabled: true, order: 30, builtIn: true },
    { id: 'questions-selection', name: _('reader.aiQuickQuestions'), prompt: _('reader.aiQuickQuestionsPrompt'), scope: 'selection', enabled: true, order: 40, builtIn: true },
    { id: 'summarize-chapter', name: _('reader.aiQuickChapterSummary'), prompt: _('reader.aiQuickChapterSummaryPrompt'), scope: 'reading', enabled: true, order: 50, builtIn: true },
  ]
}

export default function AiSettingsSection({ id }: { id?: string }) {
  const _ = useTranslation()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const isGuest = !user || user.role === 'guest' || user.guest === true
  const { data, isError, isFetching, isLoading, refetch } = useAiConfig({ enabled: !isGuest })
  const { data: providersData } = useAiProviders({ enabled: !isGuest })
  const create = useCreateAiProfile()
  const updateProfile = useUpdateAiProfile()
  const remove = useDeleteAiProfile()
  const activate = useActivateAiProfile()
  const updateConfig = useUpdateAiConfig()
  const fetchModels = useFetchAiModels()
  const testDraft = useTestAiConfigDraft()
  const [form, setForm] = useState<AiFormState | null>(null)
  const [providerMenuOpen, setProviderMenuOpen] = useState(false)
  const providerMenuRef = useRef<HTMLDivElement>(null)
  const [pendingDelete, setPendingDelete] = useState<AiProfileRes | null>(null)
  const [availableModels, setAvailableModels] = useState<AiModelRes[]>([])
  const [modelsLoadedFingerprint, setModelsLoadedFingerprint] = useState('')
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [testingModel, setTestingModel] = useState<string | null>(null)
  const [embeddingMode, setEmbeddingMode] = useState<AiRetrievalMode>('lexical')
  const formRef = useRef<AiFormState | null>(null)
  const providers = providersData?.data ?? FALLBACK_PROVIDERS
  const config = data?.data
  const isOwner = user?.role === 'owner'
  const profiles = useMemo(() => config?.profiles ?? [], [config?.profiles])
  const embeddingOptions = useMemo(() => profiles.flatMap((profile) => profile.embeddingModels.map((model) => ({
    key: `${profile.id}::${model.id}`,
    profileId: profile.id,
    profileName: profile.name || providers.find((item) => item.id === profile.provider)?.name || profile.provider,
    model,
  }))), [profiles, providers])
  const embeddingSelectionKey = config?.embeddingProfileId && config.embeddingModel ? `${config.embeddingProfileId}::${config.embeddingModel}` : ''
  const selectableProviders = useMemo(() => providers, [providers])
  const selectedProvider = form ? providers.find((provider) => provider.id === form.provider) : undefined
  const formProviders = useMemo(() => {
    if (!form || isOwner || selectableProviders.some((provider) => provider.id === form.provider)) return selectableProviders
    return selectedProvider ? [selectedProvider, ...selectableProviders] : selectableProviders
  }, [form, isOwner, selectableProviders, selectedProvider])
  const savedProfile = form ? profiles.find((profile) => profile.id === form.id) : undefined
  const savedKeyAvailable = Boolean(savedProfile?.apiKeyConfigured && savedProfile.provider === form?.provider)
  const requiresApiKey = Boolean(selectedProvider?.requiresApiKey && (form?.provider !== 'openai' || !form?.baseUrl.trim() || form?.baseUrl.trim().replace(/\/+$/, '').toLowerCase() === 'https://api.openai.com/v1'))
  const currentFingerprint = form ? fingerprint(`${form.id ?? ''}\0${form.provider}\0${form.baseUrl.trim()}\0${form.apiKey.trim()}`) : ''
  const modelListIsStale = Boolean(form && availableModels.length && modelsLoadedFingerprint && currentFingerprint !== modelsLoadedFingerprint)
  const saving = create.isPending || updateProfile.isPending || updateConfig.isPending
  const defaultPrompts = useMemo(() => defaultPromptTemplates(_), [_])
  const showError = (error: unknown) => notify.error(getUserErrorNotification(error, 'settings.aiOperationFailed'))
  formRef.current = form

  useEffect(() => {
    setEmbeddingMode(config?.embeddingProfileId && config.embeddingModel ? 'semantic' : 'lexical')
  }, [config?.embeddingProfileId, config?.embeddingModel])

  useDismissiblePopup(providerMenuOpen, providerMenuRef, () => setProviderMenuOpen(false))

  function openCreate(provider: AiProvider = 'openai') {
    setProviderMenuOpen(false)
    const selected = providers.find((item) => item.id === provider)
    const defaultModel = selected?.defaultModel ?? ''
    setModelsLoadedFingerprint('')
    setAvailableModels([])
    setForm({
      name: selected?.name ?? '',
      provider,
      baseUrl: selected?.defaultBaseUrl ?? '',
      model: defaultModel,
      models: defaultModel ? [{ id: defaultModel, name: defaultModel }] : [],
      apiKey: '',
    })
  }

  function openEdit(profile: AiProfileRes) {
    setModelsLoadedFingerprint('')
    setAvailableModels([])
    setForm({ id: profile.id, name: profile.name, provider: profile.provider, baseUrl: profile.baseUrl ?? '', model: profile.model ?? '', models: profile.models, apiKey: '' })
  }

  function changeProvider(provider: AiProvider) {
    const selected = providers.find((item) => item.id === provider)
    const defaultModel = selected?.defaultModel ?? ''
    setModelsLoadedFingerprint('')
    setAvailableModels([])
    setForm((current) => current ? { ...current, provider, baseUrl: selected?.defaultBaseUrl ?? '', model: defaultModel, models: defaultModel ? [{ id: defaultModel, name: defaultModel }] : [], apiKey: '' } : current)
  }

  function save() {
    if (!form) return
    const selectedModel = form.models.some((item) => item.id === form.model.trim()) && !isAiEmbeddingModel({ id: form.model.trim(), name: form.model.trim() }) ? form.model.trim() : ''
    const body = { name: form.name.trim(), provider: form.provider, baseUrl: form.baseUrl.trim() || null, model: selectedModel || null, models: form.models, ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}) }
    const onSuccess = () => { setForm(null); notify.success({ key: 'settings.aiSaved' }) }
    const onError = showError
    if (form.id) updateProfile.mutate({ id: form.id, body }, { onSuccess, onError })
    else create.mutate(body, { onSuccess, onError })
  }

  function fetchAvailableModels() {
    if (!form) return
    const requestFingerprint = currentFingerprint
    fetchModels.mutate({ profileId: form.id ?? null, provider: form.provider, baseUrl: form.baseUrl.trim() || null, ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}) }, {
      onSuccess: (response) => {
        const current = formRef.current
        if (!current || fingerprint(`${current.id ?? ''}\0${current.provider}\0${current.baseUrl.trim()}\0${current.apiKey.trim()}`) !== requestFingerprint) return
        setModelsLoadedFingerprint(requestFingerprint)
        setAvailableModels(response.data)
        setModelPickerOpen(true)
        if (response.data.length) {
          notify.success({ key: 'settings.aiModelsFetched', params: { count: response.data.length } })
        } else {
          notify.info({ key: 'settings.aiModelsEmpty' })
        }
      },
      onError: (error) => {
        const current = formRef.current
        if (!current || fingerprint(`${current.id ?? ''}\0${current.provider}\0${current.baseUrl.trim()}\0${current.apiKey.trim()}`) !== requestFingerprint) return
        setModelsLoadedFingerprint('')
        setAvailableModels([])
        showError(error)
      },
    })
  }

  function addModel(model: AiModelRes) {
    setForm((current) => {
      if (!current || current.models.some((item) => item.id === model.id)) return current
      const models = [...current.models, model]
      return { ...current, models, model: current.model || (isAiEmbeddingModel(model) ? '' : model.id) }
    })
  }

  function removeModel(modelId: string) {
    setForm((current) => {
      if (!current) return current
      const models = current.models.filter((model) => model.id !== modelId)
      const model = current.model === modelId ? models.find((item) => !isAiEmbeddingModel(item))?.id ?? '' : current.model
      return { ...current, models, model }
    })
  }

  function selectChatModel(model: string) {
    if (isAiEmbeddingModel({ id: model, name: model })) return
    setForm((current) => current ? { ...current, model } : current)
  }

  function testModel(model: AiModelRes) {
    if (!form) return
    const modelId = model.id.trim()
    if (!modelId || isAiEmbeddingModel(model)) return
    setTestingModel(modelId)
    testDraft.mutate(
      {
        profileId: form.id ?? null,
        provider: form.provider,
        baseUrl: form.baseUrl.trim() || null,
        model: modelId,
        ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
      },
      {
        onSuccess: (response) => { setTestingModel(null); notify.success({ key: 'settings.aiTestSuccess', params: { model: response.data.model, latency: response.data.latencyMs } }) },
        onError: (error) => { setTestingModel(null); showError(error) },
      },
    )
  }

  function clearApiKey() {
    if (!form) return
    const onSuccess = () => { setForm((current) => current ? { ...current, apiKey: '' } : current); notify.success({ key: 'settings.aiKeyCleared' }) }
    const onError = showError
    if (form.id) updateProfile.mutate({ id: form.id, body: { apiKey: null } }, { onSuccess, onError })
  }

  function openModelPicker() {
    setModelPickerOpen(true)
  }

  function changeEmbeddingMode(mode: AiRetrievalMode) {
    setEmbeddingMode(mode)
    if (mode === 'semantic') return
    updateConfig.mutate({ embeddingProfileId: null, embeddingModel: null }, {
      onError: (error) => {
        setEmbeddingMode('semantic')
        showError(error)
      },
    })
  }

  function selectEmbeddingModel(selection: string) {
    const option = embeddingOptions.find((item) => item.key === selection)
    if (!option) return
    updateConfig.mutate({ embeddingProfileId: option.profileId, embeddingModel: option.model.id }, { onError: showError })
  }

  function confirmDelete() {
    if (!pendingDelete) return
    remove.mutate(pendingDelete.id, { onSuccess: () => { if (form?.id === pendingDelete.id) setForm(null); setPendingDelete(null); notify.success({ key: 'settings.aiDeleted' }) }, onError: showError })
  }

  return (
    <>
      <SettingsCard
        id={id}
        className="scroll-mt-6"
        icon={<SparklesIcon className="h-5 w-5" />}
        iconBgClass="bg-purple-500/10 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400"
        title={_('settings.ai')}
        action={
          !isGuest ? (
            <div ref={providerMenuRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setProviderMenuOpen((value) => !value)}
                className="inline-flex items-center gap-1 rounded-lg border border-stone-200 px-3 py-2 text-xs font-medium text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
              >
                <span>{_('settings.aiAdd')}</span>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              {providerMenuOpen && (
                <div className="absolute right-0 z-10 mt-2 w-max min-w-full max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-stone-200 bg-white py-1 shadow-lg dark:border-stone-700 dark:bg-stone-900">
                  {selectableProviders.map((provider) => (
                    <button
                      key={provider.id}
                      type="button"
                      onClick={() => openCreate(provider.id)}
                      className="flex w-full items-center gap-2 truncate whitespace-nowrap px-3 py-2 text-left text-xs text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-800"
                      title={provider.name}
                    >
                      <AiBrandIcon provider={provider} className="h-5 w-5" />
                      <span className="truncate">{provider.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : undefined
        }
      >
        {isGuest ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-stone-100/80 px-3.5 py-2.5 text-xs text-stone-500 dark:bg-stone-800/80 dark:text-stone-400">
            <span className="min-w-0 flex-1">{_('settings.aiGuestHint')}</span>
            <button
              type="button"
              onClick={() => void navigate({ to: '/login' })}
              className="shrink-0 font-medium text-stone-700 underline-offset-2 hover:underline dark:text-stone-300 dark:hover:text-stone-100"
            >
              {_('auth.signIn')} →
            </button>
          </div>
        ) : isError ? (
          <QueryErrorState isRetrying={isFetching} onRetry={refetch} />
        ) : isLoading || !config ? (
          <div className="space-y-3 py-1">
            {[1, 2].map((i) => (
              <div key={i} className="flex animate-pulse items-center justify-between py-2.5">
                <div className="space-y-1.5">
                  <div className="h-4 w-32 rounded bg-stone-200/80 dark:bg-stone-800" />
                  <div className="h-3 w-48 rounded bg-stone-100 dark:bg-stone-800/60" />
                </div>
                <div className="h-5 w-9 rounded-full bg-stone-200/80 dark:bg-stone-800" />
              </div>
            ))}
          </div>
        ) : profiles.length === 0 ? (
          <SettingsEmptyState>{_('settings.aiEmpty')}</SettingsEmptyState>
        ) : (
          <div className="divide-y divide-stone-100 dark:divide-stone-800">
            {profiles.map((profile) => (
              <div key={profile.id} className="flex items-center gap-3 py-3">
                <AiBrandIcon provider={providers.find((item) => item.id === profile.provider) ?? profile.provider} className="h-8 w-8" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm text-stone-800 dark:text-stone-100">{profile.name || providers.find((item) => item.id === profile.provider)?.name || profile.provider}</p>
                    {config.activeProfileId === profile.id && <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-[10px] text-stone-500 dark:bg-stone-800 dark:text-stone-400">{_('settings.aiActive')}</span>}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-stone-400">{providers.find((item) => item.id === profile.provider)?.name ?? profile.provider}{profile.model ? ` · ${profile.model}` : ''}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" onClick={() => openEdit(profile)} aria-label={_('settings.aiEdit')} title={_('settings.aiEdit')} className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"><EditIcon /></button>
                  {config.activeProfileId !== profile.id && <button type="button" onClick={() => activate.mutate(profile.id, { onError: (error) => showError(error) })} className="rounded-lg px-2 py-1 text-[11px] text-stone-500 hover:bg-stone-100 hover:text-stone-800 dark:hover:bg-stone-800 dark:hover:text-stone-200">{_('settings.aiUse')}</button>}
                  <button type="button" onClick={() => setPendingDelete(profile)} aria-label={_('settings.aiDelete')} title={_('settings.aiDelete')} className="flex h-7 w-7 items-center justify-center rounded-lg text-red-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-stone-800 dark:hover:text-red-400"><TrashIcon /></button>
                </div>
              </div>
            ))}
          </div>
        )}

        {!isGuest && config && profiles.length > 0 && (
          <div className="mt-5 border-t border-stone-100 pt-5 dark:border-stone-800">
            <div className="flex flex-col gap-2 text-xs text-stone-600 dark:text-stone-300">
              <span id="ai-retrieval-mode-label">{_('settings.aiRetrievalMode')}</span>
              <div role="radiogroup" aria-labelledby="ai-retrieval-mode-label" className="flex rounded-xl border border-stone-200 bg-stone-50 p-1 dark:border-stone-700 dark:bg-stone-800/60">
                <button type="button" role="radio" aria-checked={embeddingMode === 'lexical'} onClick={() => changeEmbeddingMode('lexical')} disabled={updateConfig.isPending} className={`min-w-0 flex-1 rounded-lg px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${embeddingMode === 'lexical' ? 'bg-stone-900 text-white shadow-sm dark:bg-stone-100 dark:text-stone-900' : 'text-stone-500 hover:bg-white hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-100'}`}>{_('settings.aiLexicalRetrieval')}</button>
                <button type="button" role="radio" aria-checked={embeddingMode === 'semantic'} onClick={() => changeEmbeddingMode('semantic')} disabled={updateConfig.isPending} className={`min-w-0 flex-1 rounded-lg px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${embeddingMode === 'semantic' ? 'bg-stone-900 text-white shadow-sm dark:bg-stone-100 dark:text-stone-900' : 'text-stone-500 hover:bg-white hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-100'}`}>{_('settings.aiSemanticRetrieval')}</button>
              </div>
            </div>
            {embeddingMode === 'semantic' && (
              <label className="mt-3 flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-300">
                <span>{_('settings.aiEmbeddingModel')}</span>
                <select aria-label={_('settings.aiEmbeddingModel')} value={embeddingSelectionKey} onChange={(event) => selectEmbeddingModel(event.target.value)} disabled={updateConfig.isPending || embeddingOptions.length === 0} className="h-9 rounded-lg border border-stone-200 bg-transparent px-3 text-sm outline-none focus:border-blue-500 disabled:opacity-50 dark:border-stone-700">
                  <option value="">{embeddingOptions.length ? _('settings.aiEmbeddingSelectModel') : _('settings.aiEmbeddingNoModels')}</option>
                  {profiles.map((profile) => {
                    const options = embeddingOptions.filter((item) => item.profileId === profile.id)
                    if (!options.length) return null
                    return (
                      <optgroup key={profile.id} label={options[0]!.profileName}>
                        {options.map((option) => (
                          <option key={option.key} value={option.key}>
                            {option.model.name}{option.model.name !== option.model.id ? ` · ${option.model.id}` : ''}
                          </option>
                        ))}
                      </optgroup>
                    )
                  })}
                </select>
              </label>
            )}
          </div>
        )}

        {!isGuest && config && <AiPromptTemplates prompts={config.prompts ?? defaultPrompts} update={updateConfig} />}
      </SettingsCard>

      {pendingDelete && <ConfirmDialog title={_('settings.confirmDeleteTitle')} message={_('settings.aiDeleteConfirm', { name: pendingDelete.name })} confirmLabel={_('settings.confirmDeleteAction')} onConfirm={confirmDelete} onClose={() => setPendingDelete(null)} />}

      {form && <Modal title={_(form.id ? 'settings.aiEdit' : 'settings.aiAdd')} size="wide" onClose={() => setForm(null)}>
        <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); save() }}>
          <label className="flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-300"><span>{_('settings.aiName')}</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder={_('settings.aiNamePlaceholder')} className="h-9 rounded-lg border border-stone-200 bg-transparent px-3 text-sm outline-none focus:border-blue-500 dark:border-stone-700" /></label>
          <label className="flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-300">
            <span>{_('settings.aiProvider')}</span>
            <div className="flex items-center gap-2">
              <AiBrandIcon provider={selectedProvider ?? form.provider} className="h-7 w-7" />
              <select aria-label={_('settings.aiProvider')} value={form.provider} onChange={(event) => changeProvider(event.target.value as AiProvider)} className="h-9 min-w-0 flex-1 rounded-lg border border-stone-200 bg-transparent px-3 text-sm outline-none focus:border-blue-500 dark:border-stone-700">
                {formProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
              </select>
            </div>
          </label>
          <label className="flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-300">
            <span>{_('settings.aiBaseUrl')}</span>
            <input aria-label={_('settings.aiBaseUrl')} readOnly={!isOwner} type="url" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} placeholder="http://localhost:11434" className={`h-9 rounded-lg border border-stone-200 bg-transparent px-3 text-sm outline-none focus:border-blue-500 dark:border-stone-700 ${!isOwner ? 'cursor-default bg-stone-50 text-stone-500 dark:bg-stone-800/50' : ''}`} />
            <span className="text-[11px] text-stone-400">{_(isOwner ? 'settings.aiBaseUrlHint' : 'settings.aiBaseUrlMemberHint')}</span>
          </label>
          <div className="flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-300">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2"><span className="font-medium text-stone-700 dark:text-stone-200">{_('settings.aiModel')}</span><span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] text-stone-500 dark:bg-stone-800 dark:text-stone-400">{form.models.length}</span></div>
              <button type="button" onClick={openModelPicker} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-2 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"><ManageModelsIcon />{_('settings.aiManageModels')}</button>
            </div>
            {form.models.length === 0 ? <div className="rounded-xl border border-dashed border-stone-200 px-4 py-7 text-center text-xs text-stone-400 dark:border-stone-700">{_('settings.aiModelsEmptyHint')}</div> : <div className="overflow-hidden rounded-xl border border-stone-200 dark:border-stone-700">
              {form.models.map((model) => {
                const capabilities = getAiModelCapabilityFlags(model)
                const hasCapability = capabilities.vision || capabilities.tools || capabilities.reasoning || capabilities.embedding
                const selected = form.model === model.id
                return <div key={model.id} className="flex items-center gap-3 border-b border-stone-100 px-3 py-2.5 last:border-0 dark:border-stone-800">
                  <button type="button" disabled={capabilities.embedding} onClick={() => selectChatModel(model.id)} aria-pressed={selected} className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default">
                    <AiBrandIcon model={model} provider={selectedProvider ?? form.provider} selected={selected} className={`h-7 w-7 ${capabilities.embedding ? 'bg-violet-50 dark:bg-violet-950/40' : ''}`} />
                    <span className="min-w-0"><span className="block truncate text-xs text-stone-800 dark:text-stone-100">{model.name}</span>{model.name !== model.id && <span className="block truncate text-[11px] text-stone-400">{model.id}</span>}<span className="mt-1 flex flex-wrap gap-1">
                      {capabilities.embedding && <span className="rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-600 dark:bg-violet-950/40 dark:text-violet-300">{_('settings.aiEmbeddingTag')}</span>}
                      {capabilities.vision && <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600 dark:bg-blue-950/40 dark:text-blue-300"><AiModelIcon kind="vision" />{_('settings.aiVisionTag')}</span>}
                      {capabilities.tools && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300"><AiModelIcon kind="tools" />{_('settings.aiToolsTag')}</span>}
                      {capabilities.reasoning && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600 dark:bg-amber-950/40 dark:text-amber-300"><AiModelIcon kind="reasoning" />{_('settings.aiReasoningTag')}</span>}
                      {!hasCapability && <span className="rounded-full bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-400 dark:bg-stone-800 dark:text-stone-500">{_('settings.aiCapabilitiesUnknown')}</span>}
                    </span></span>
                  </button>
                  {!capabilities.embedding && <button type="button" disabled={testDraft.isPending} onClick={() => testModel(model)} aria-label={`${_(testingModel === model.id ? 'settings.aiTesting' : 'settings.aiTest')} ${model.id}`} title={_(testingModel === model.id ? 'settings.aiTesting' : 'settings.aiTest')} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-blue-50 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-stone-800 dark:hover:text-blue-300"><AiModelIcon kind="test" className={testingModel === model.id ? 'h-4 w-4 animate-pulse' : 'h-4 w-4'} /></button>}
                  <button type="button" onClick={() => removeModel(model.id)} aria-label={`${_('settings.aiModelRemove')} ${model.id}`} title={_('settings.aiModelRemove')} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-stone-800"><TrashIcon /></button>
                </div>
              })}
            </div>}
          </div>
          <label className="flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-300">
            <span>{_('settings.aiApiKey')} {requiresApiKey ? _('settings.aiRequired') : _('settings.aiOptional')}</span>
            <div className="relative">
              <input required={Boolean(requiresApiKey && !savedKeyAvailable)} type="password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} placeholder={savedKeyAvailable ? _('settings.aiKeyKeep') : _('settings.aiApiKeyPlaceholder')} autoComplete="new-password" className="h-9 w-full rounded-lg border border-stone-200 bg-transparent px-3 pr-10 text-sm outline-none focus:border-blue-500 dark:border-stone-700" />
              {savedKeyAvailable && <button type="button" disabled={saving} onClick={clearApiKey} aria-label={_('settings.aiKeyClear')} title={_('settings.aiKeyClear')} className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-stone-800 dark:hover:text-red-400"><TrashIcon /></button>}
            </div>
            {savedKeyAvailable && <span className="text-[11px] text-emerald-600 dark:text-emerald-400">{_('settings.aiKeyConfigured')}</span>}
          </label>
          <p className="text-xs leading-5 text-stone-400">{_('settings.aiSecretHint')}</p>
          <div className="flex flex-wrap justify-end gap-2 border-t border-stone-100 pt-4 dark:border-stone-800">
            <button type="submit" disabled={saving || !form.name.trim()} className="rounded-lg bg-stone-900 px-4 py-2 text-xs font-medium text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900">{_('settings.aiSave')}</button>
          </div>
        </form>
      </Modal>}
      {modelPickerOpen && form && <AiModelPicker
        title={_('settings.aiModelPickerTitle', { name: form.name || selectedProvider?.name || form.provider })}
        models={availableModels}
        addedModels={form.models}
        provider={selectedProvider ?? form.provider}
        fetching={fetchModels.isPending}
        stale={modelListIsStale}
        onFetch={fetchAvailableModels}
        onAdd={addModel}
        onRemove={removeModel}
        onClose={() => setModelPickerOpen(false)}
      />}
    </>
  )
}

function AiPromptTemplates({ prompts, update }: { prompts: AiPromptTemplate[]; update: ReturnType<typeof useUpdateAiConfig> }) {
  const _ = useTranslation()
  const showError = (error: unknown) => notify.error(getUserErrorNotification(error, 'settings.aiPromptSaveFailed'))
  const [drafts, setDrafts] = useState(prompts)
  const [form, setForm] = useState<AiPromptFormState | null>(null)
  const [pendingDelete, setPendingDelete] = useState<AiPromptTemplate | null>(null)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [sorting, setSorting] = useState(false)
  const [variableHelpOpen, setVariableHelpOpen] = useState(false)
  const [formErrors, setFormErrors] = useState({ name: false, prompt: false })
  const variableHelpRef = useRef<HTMLDivElement>(null)
  const promptNameInputRef = useRef<HTMLInputElement>(null)
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const normalizedPrompts = prompts
  useEffect(() => {
    if (!sorting) setDrafts(normalizedPrompts)
  }, [normalizedPrompts, sorting])
  useDismissiblePopup(variableHelpOpen, variableHelpRef, () => setVariableHelpOpen(false))

  function persist(next: AiPromptTemplate[], onSuccess?: () => void) {
    setDrafts(next)
    update.mutate({ prompts: next.map(toPromptInput) }, {
      onSuccess,
      onError: (error) => {
        setDrafts(normalizedPrompts)
        showError(error)
      },
    })
  }

  function confirmReset() {
    update.mutate({ prompts: null }, {
      onSuccess: () => notify.success({ key: 'settings.aiPromptsReset' }),
      onError: showError,
    })
    setRestoreOpen(false)
  }

  function openCreate() {
    setVariableHelpOpen(false)
    setFormErrors({ name: false, prompt: false })
    setForm({ name: '', prompt: '' })
  }

  function openEdit(prompt: AiPromptTemplate) {
    setVariableHelpOpen(false)
    setFormErrors({ name: false, prompt: false })
    setForm({ id: prompt.id, name: prompt.name, prompt: prompt.prompt })
  }

  function closeForm() {
    setVariableHelpOpen(false)
    setFormErrors({ name: false, prompt: false })
    setForm(null)
  }

  function insertVariable(variable: typeof AI_PROMPT_VARIABLES[number]) {
    if (!form) return
    const textarea = promptTextareaRef.current
    const start = textarea?.selectionStart ?? form.prompt.length
    const end = textarea?.selectionEnd ?? start
    const nextPrompt = `${form.prompt.slice(0, start)}${variable}${form.prompt.slice(end)}`
    const nextCursor = start + variable.length
    setForm({ ...form, prompt: nextPrompt })
    window.requestAnimationFrame(() => {
      promptTextareaRef.current?.focus()
      promptTextareaRef.current?.setSelectionRange(nextCursor, nextCursor)
    })
  }

  function submitForm() {
    if (!form) return
    const nextErrors = { name: !form.name.trim(), prompt: !form.prompt.trim() }
    setFormErrors(nextErrors)
    if (nextErrors.name || nextErrors.prompt) {
      if (nextErrors.name) promptNameInputRef.current?.focus()
      else promptTextareaRef.current?.focus()
      return
    }
    const next = form.id
      ? drafts.map((prompt) => prompt.id === form.id ? { ...prompt, name: form.name.trim(), prompt: form.prompt.trim() } : prompt)
      : [...drafts, { id: `custom-${Date.now().toString(36)}`, name: form.name.trim(), prompt: form.prompt.trim(), scope: 'both' as const, enabled: true, order: drafts.length ? Math.max(...drafts.map((prompt) => prompt.order)) + 10 : 10, builtIn: false }]
    persist(next, () => {
      notify.success({ key: 'toast.aiPromptSaved' })
      closeForm()
    })
  }

  function toggleSorting() {
    if (update.isPending) return
    if (!sorting) {
      setDrafts(normalizedPrompts)
      setSorting(true)
      return
    }
    const draftIds = drafts.map((prompt) => prompt.id)
    const sourceIds = normalizedPrompts.map((prompt) => prompt.id)
    if (draftIds.length === sourceIds.length && draftIds.every((id, index) => id === sourceIds[index])) {
      setSorting(false)
      return
    }
    update.mutate({ prompts: drafts.map(toPromptInput) }, {
      onSuccess: () => setSorting(false),
      onError: showError,
    })
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!sorting || update.isPending || !over || active.id === over.id) return
    const oldIndex = drafts.findIndex((prompt) => prompt.id === active.id)
    const newIndex = drafts.findIndex((prompt) => prompt.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const next = arrayMove(drafts, oldIndex, newIndex).map((prompt, order) => ({ ...prompt, order: (order + 1) * 10 }))
    setDrafts(next)
  }

  function remove(id: string) {
    persist(drafts.filter((prompt) => prompt.id !== id).map((prompt, order) => ({ ...prompt, order: (order + 1) * 10 })))
  }

  function confirmDelete() {
    if (!pendingDelete) return
    remove(pendingDelete.id)
    setPendingDelete(null)
  }

  return <section className="mt-6 border-t border-stone-100 pt-5 dark:border-stone-800">
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="flex items-baseline gap-1 text-sm font-medium">
          <span>{_('settings.aiPrompts')}</span>
          {drafts.length > 0 && <span className="text-xs font-normal tabular-nums text-stone-400 dark:text-stone-500">· {drafts.length}</span>}
        </h3>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <EditModeButton active={sorting} disabled={update.isPending} onClick={toggleSorting} />
        <button type="button" onClick={() => setRestoreOpen(true)} disabled={update.isPending || sorting} aria-label={_('settings.aiPromptsReset')} title={_('settings.aiPromptsReset')} className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-stone-800 dark:hover:text-stone-200"><RestoreDefaultsIcon /></button>
        <button type="button" onClick={openCreate} disabled={update.isPending || sorting} aria-label={_('settings.aiPromptAdd')} title={_('settings.aiPromptAdd')} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></button>
      </div>
    </div>
    {drafts.length === 0 ? <p className="rounded-lg border border-dashed border-stone-200 px-3 py-4 text-center text-xs text-stone-400 dark:border-stone-700">{_('settings.aiPromptsEmpty')}</p> : <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={drafts.map((prompt) => prompt.id)} strategy={verticalListSortingStrategy}>
        <ul className="divide-y divide-stone-100 dark:divide-stone-800">
          {drafts.map((prompt) => <AiPromptRow key={prompt.id} prompt={prompt} disabled={update.isPending} sorting={sorting} onToggle={(enabled) => persist(drafts.map((item) => item.id === prompt.id ? { ...item, enabled } : item))} onEdit={() => openEdit(prompt)} onDelete={() => setPendingDelete(prompt)} />)}
        </ul>
      </SortableContext>
    </DndContext>}
    {pendingDelete && <ConfirmDialog title={_('settings.confirmDeleteTitle')} message={_('settings.aiPromptDeleteConfirm', { name: pendingDelete.name })} confirmLabel={_('settings.confirmDeleteAction')} onConfirm={confirmDelete} onClose={() => setPendingDelete(null)} />}
    {restoreOpen && <ConfirmDialog title={_('settings.confirmRestoreTitle')} message={_('settings.aiPromptsRestoreConfirm')} confirmLabel={_('settings.confirmRestoreAction')} confirmVariant="primary" onConfirm={confirmReset} onClose={() => setRestoreOpen(false)} />}
    {form && <Modal title={_(form.id ? 'settings.aiPromptEdit' : 'settings.aiPromptAdd')} onClose={closeForm}>
      <form noValidate className={settingsFormClass} onSubmit={(event) => { event.preventDefault(); submitForm() }}>
        <SettingsFormField label={_('settings.aiPromptName')} required error={formErrors.name ? _('settings.aiPromptNameRequired') : undefined}>
          <input
            ref={promptNameInputRef}
            autoFocus
            value={form.name}
            onChange={(event) => {
              setForm({ ...form, name: event.target.value })
              setFormErrors((current) => ({ ...current, name: false }))
            }}
            aria-label={_('settings.aiPromptName')}
            aria-invalid={formErrors.name || undefined}
            disabled={update.isPending}
            className={settingsInputClass}
          />
        </SettingsFormField>
        <div className="flex flex-col gap-2 text-xs text-stone-600 dark:text-stone-300">
          <div ref={variableHelpRef} className="relative flex w-fit items-center gap-1.5">
            <span>{_('settings.aiPromptVariables')}</span>
            <button type="button" onClick={() => setVariableHelpOpen((open) => !open)} aria-label={_('settings.aiPromptVariablesHelp')} aria-expanded={variableHelpOpen} className={`flex h-5 w-5 items-center justify-center rounded-full transition-colors ${variableHelpOpen ? 'bg-stone-200 text-stone-800 dark:bg-stone-700 dark:text-stone-100' : 'text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200'}`}>
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
            </button>
            {variableHelpOpen && (
              <div role="dialog" aria-label={_('settings.aiPromptVariablesHelpTitle')} className="absolute left-0 top-7 z-20 w-80 max-w-[calc(100vw-3rem)] rounded-xl border border-stone-200 bg-white p-3 shadow-xl dark:border-stone-700 dark:bg-stone-900 animate-in fade-in zoom-in-95 duration-100">
                <div className="mb-2.5 flex items-center justify-between border-b border-stone-100 pb-2 dark:border-stone-800">
                  <span className="text-xs font-semibold text-stone-900 dark:text-stone-100">{_('settings.aiPromptVariablesHelpTitle')}</span>
                  <button
                    type="button"
                    onClick={() => setVariableHelpOpen(false)}
                    className="flex h-5 w-5 items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-stone-700 active:scale-90 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                    aria-label={_('library.cancel')}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <dl className="space-y-2.5">
                  <div><dt className="font-mono text-xs font-semibold text-stone-800 dark:text-stone-100">{'{SELTEXT}'}</dt><dd className="mt-0.5 leading-relaxed text-stone-500 dark:text-stone-400">{_('settings.aiPromptVariableSelText')}</dd></div>
                  <div><dt className="font-mono text-xs font-semibold text-stone-800 dark:text-stone-100">{'{SELPARA}'}</dt><dd className="mt-0.5 leading-relaxed text-stone-500 dark:text-stone-400">{_('settings.aiPromptVariableSelPara')}</dd></div>
                  <div><dt className="font-mono text-xs font-semibold text-stone-800 dark:text-stone-100">{'{CHAPTER}'}</dt><dd className="mt-0.5 leading-relaxed text-stone-500 dark:text-stone-400">{_('settings.aiPromptVariableChapter')}</dd></div>
                </dl>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {AI_PROMPT_VARIABLES.map((variable) => <button key={variable} type="button" onClick={() => insertVariable(variable)} disabled={update.isPending} aria-label={_('settings.aiPromptInsertVariable', { variable })} className="rounded-lg border border-stone-200 px-2.5 py-1.5 font-mono text-xs text-stone-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-700 dark:text-stone-200 dark:hover:border-blue-700 dark:hover:bg-blue-950/30 dark:hover:text-blue-300">{variable}</button>)}
          </div>
        </div>
        <SettingsFormField label={_('settings.aiPromptText')} required error={formErrors.prompt ? _('settings.aiPromptTextRequired') : undefined}>
          <textarea
            ref={promptTextareaRef}
            rows={5}
            value={form.prompt}
            onChange={(event) => {
              setForm({ ...form, prompt: event.target.value })
              setFormErrors((current) => ({ ...current, prompt: false }))
            }}
            placeholder={_('settings.aiPromptTextPlaceholder')}
            aria-label={_('settings.aiPromptText')}
            aria-invalid={formErrors.prompt || undefined}
            disabled={update.isPending}
            className={settingsTextareaClass}
          />
        </SettingsFormField>
        <SettingsFormActions onCancel={closeForm} cancelDisabled={update.isPending} saveDisabled={update.isPending} />
      </form>
    </Modal>}
  </section>
}

function toPromptInput(prompt: AiPromptTemplate): AiPromptTemplateInput {
  return { id: prompt.id, name: prompt.name, prompt: prompt.prompt, enabled: prompt.enabled, order: prompt.order }
}
