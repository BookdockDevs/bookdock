import { useMemo, useRef, useState } from 'react'

import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useNavigate } from '@tanstack/react-router'

import type { AiConnectionRes, AiModelEntryRes, AiPromptTemplate, AiProvider, AiProviderRes, ResourceAvailability } from '@bookdock/shared'

import { useAiConfig, useAiProviders, useCreateAiPrompt, useDeleteAiConnection, useDeleteAiPrompt, useRestoreAiPrompts, useReorderAiPrompts, useUpdateAiPrompt } from '@/api/hooks/useAi'
import AiBrandIcon from '@/components/ui/AiBrandIcon'
import Badge from '@/components/ui/Badge'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Modal from '@/components/ui/Modal'
import QueryErrorState from '@/components/ui/QueryErrorState'
import SegmentedControl from '@/components/ui/SegmentedControl'
import SettingsEmptyState from '@/components/ui/SettingsEmptyState'
import SmartMenu from '@/components/ui/SmartMenu'
import { useDismissiblePopup } from '@/hooks/useDismissiblePopup'
import { useMenuAnchor } from '@/hooks/useMenuAnchor'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { useAuthStore } from '@/stores/auth.store'

import AiConnectionEditor from './AiConnectionEditor'
import AiPromptRow from './AiPromptRow'
import AiProviderMenuItems from './AiProviderMenuItems'
import EditModeButton from './EditModeButton'
import SettingsCard from './SettingsCard'
import SettingsFormActions from './SettingsFormActions'
import SettingsFormField from './SettingsFormField'
import { settingsFormClass, settingsInputClass, settingsTextareaClass } from './settingsForm'
import { PlusIcon, SlidersIcon, TrashIcon } from './row-icons'

interface AiPromptFormState {
  id?: string
  name: string
  prompt: string
  availability: ResourceAvailability
}

const AI_PROMPT_VARIABLES = ['{SELTEXT}', '{SELPARA}', '{CHAPTER}'] as const

const FALLBACK_PROVIDERS: AiProviderRes[] = [
  { id: 'openai', name: 'OpenAI', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: null, requiresApiKey: true },
  { id: 'anthropic', name: 'Claude', protocol: 'anthropic', defaultBaseUrl: 'https://api.anthropic.com', defaultModel: 'claude-sonnet-5', requiresApiKey: true },
  { id: 'gemini', name: 'Gemini', protocol: 'gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com', defaultModel: 'gemini-3.8-flash', requiresApiKey: true },
  { id: 'ollama', name: 'Ollama', protocol: 'ollama', defaultBaseUrl: 'http://localhost:11434', defaultModel: 'llama3.2', requiresApiKey: false },
  { id: 'lmstudio', name: 'LM Studio', protocol: 'openai-compatible', defaultBaseUrl: 'http://localhost:1234/v1', defaultModel: null, requiresApiKey: false },
  { id: 'deepseek', name: 'DeepSeek', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-flash', requiresApiKey: true },
  { id: 'qwen', name: '通义千问', protocol: 'openai-compatible', defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-plus', requiresApiKey: true },
  { id: 'glm', name: '智谱 GLM', protocol: 'openai-compatible', defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-5.3', requiresApiKey: true },
  { id: 'moonshot', name: 'Kimi', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'kimi-k3.1-pro', requiresApiKey: true },
  { id: 'openrouter', name: 'OpenRouter', protocol: 'openai-compatible', defaultBaseUrl: 'https://openrouter.ai/api/v1', defaultModel: null, requiresApiKey: true },
  { id: 'siliconflow', name: 'SiliconFlow', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.siliconflow.cn/v1', defaultModel: null, requiresApiKey: true },
  { id: 'minimax', name: 'MiniMax', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.minimaxi.com/v1', defaultModel: 'MiniMax-M3.1-Flash', requiresApiKey: true },
  { id: 'mimo', name: 'MiMo', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.xiaomimimo.com/v1', defaultModel: 'mimo-v2.6-flash', requiresApiKey: true },
]

function RestoreDefaultsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 14-5-5 5-5" />
      <path d="M4 9h10.5A5.5 5.5 0 1 1 9 19H8" />
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

/** Models grouped by their connection, for the default-model selector. */
function groupModelsByConnection(models: readonly AiModelEntryRes[]) {
  const groups = new Map<string, AiModelEntryRes[]>()
  for (const model of models) {
    const current = groups.get(model.connectionId) ?? []
    current.push(model)
    groups.set(model.connectionId, current)
  }
  return groups
}

export default function AiSettingsSection({ id }: { id?: string }) {
  const _ = useTranslation()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const isGuest = !user
  const { data, isError, isFetching, isLoading, refetch } = useAiConfig({ enabled: !isGuest })
  const { data: providersData } = useAiProviders({ enabled: !isGuest })
  const removeConnection = useDeleteAiConnection()
  const { open: menuOpen, anchor: menuAnchor, menuRef, btnRef: menuBtnRef, close: closeMenu, toggleFromButton } = useMenuAnchor()
  const [editor, setEditor] = useState<{ connection: AiConnectionRes | null; provider?: AiProvider } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<AiConnectionRes | null>(null)
  const providers = providersData?.data ?? FALLBACK_PROVIDERS
  const config = data?.data
  const connections = useMemo(() => config?.connections ?? [], [config?.connections])
  const models = useMemo(() => config?.models ?? [], [config?.models])
  const modelsByConnection = useMemo(() => groupModelsByConnection(models), [models])


  // The editor dialog re-reads the saved connection from the refreshed catalog.
  const editing = editor?.connection ? connections.find((connection) => connection.id === editor.connection!.id) ?? editor.connection : null

  // ConfirmDialog awaits this; failures surface inline there, so no
  // parallel error toast.
  async function confirmDelete() {
    if (!pendingDelete) return
    await removeConnection.mutateAsync(pendingDelete.id)
    setPendingDelete(null)
    notify.success({ key: 'settings.aiDeleted' })
  }

  return (
    <>
      <SettingsCard
        id={id}
        className="scroll-mt-6"
        icon={<SparklesIcon className="h-5 w-5" />}
        iconBgClass="bg-purple-500/10 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400"
        title={
          <>
            {_('settings.ai')}
            {connections.length > 0 && <span className="ml-1.5 text-xs font-normal tabular-nums text-stone-400 dark:text-stone-500">· {connections.length}</span>}
          </>
        }
        action={
          !isGuest ? (
            <div className="flex shrink-0 items-center gap-1">
              <button
                ref={menuBtnRef}
                type="button"
                onClick={(event) => toggleFromButton(event, 'below')}
                aria-expanded={menuOpen}
                aria-label={_('settings.aiAdd')}
                title={_('settings.aiAdd')}
                className={`flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200 ${menuOpen ? 'bg-stone-100 text-stone-800 dark:bg-stone-800 dark:text-stone-200' : ''}`}
              >
                <PlusIcon />
              </button>
              {menuOpen && (
                <SmartMenu
                  triggerRef={menuBtnRef}
                  innerRef={menuRef}
                  anchor={menuAnchor}
                  size={{ width: 'auto', height: providers.length * 36 + 8 }}
                  minWidth={180}
                  maxWidth={260}
                  onClose={closeMenu}
                >
                  <AiProviderMenuItems providers={providers} onPick={(id) => { closeMenu(); setEditor({ connection: null, provider: id }) }} />
                </SmartMenu>
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
        ) : connections.length === 0 ? (
          <SettingsEmptyState>{_('settings.aiEmpty')}</SettingsEmptyState>
        ) : (
          <div className="divide-y divide-stone-100 dark:divide-stone-800">
            {connections.map((connection) => {
              const connectionModels = modelsByConnection.get(connection.id) ?? []
              const providerName = providers.find((item) => item.id === connection.provider)?.name ?? connection.provider
              const inUse = Boolean(config.lastUsedModels.chat && connectionModels.some((model) => model.id === config.lastUsedModels.chat))
              return (
                <div key={connection.id} className="group flex items-center gap-3 py-3">
                  <AiBrandIcon provider={connection.provider} className="h-8 w-8" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm text-stone-800 dark:text-stone-100">{connection.name || providerName}</p>
                      {connection.availability === 'instance' && <Badge>{_('settings.resourceScopeInstance')}</Badge>}
                      {inUse && <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-[10px] text-stone-500 dark:bg-stone-800 dark:text-stone-400">{_('settings.aiActive')}</span>}
                    </div>
                    {connection.baseUrl && <p className="mt-0.5 truncate text-xs text-stone-400">{connection.baseUrl}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:has-[:focus-visible]:opacity-100">
                    <button
                      type="button"
                      onClick={(e) => {
                        if (e.detail > 0) e.currentTarget.blur()
                        setEditor({ connection })
                      }}
                      aria-label={_('settings.aiManageModels')}
                      title={_('settings.aiManageModels')}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                    >
                      <SlidersIcon />
                    </button>
                    {connection.mine && (
                      <button
                        type="button"
                        onClick={(e) => {
                          if (e.detail > 0) e.currentTarget.blur()
                          setPendingDelete(connection)
                        }}
                        aria-label={_('settings.aiDelete')}
                        title={_('settings.aiDelete')}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                      >
                        <TrashIcon />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}


        {!isGuest && config && <AiPromptTemplates prompts={config.prompts} restoreAvailable={config.promptsRestoreAvailable} />}
      </SettingsCard>

      {pendingDelete && <ConfirmDialog title={_('settings.confirmDeleteTitle')} message={_('settings.aiDeleteConfirm', { name: pendingDelete.name })} confirmLabel={_('settings.confirmDeleteAction')} errorFallback="settings.aiOperationFailed" onConfirm={confirmDelete} onClose={() => setPendingDelete(null)} />}

      {editor && <AiConnectionEditor connection={editing} initialProvider={editor.provider} providers={providers} models={editing ? modelsByConnection.get(editing.id) ?? [] : []} onClose={() => setEditor(null)} />}
    </>
  )
}

function AiPromptTemplates({ prompts, restoreAvailable }: { prompts: AiPromptTemplate[]; restoreAvailable: boolean }) {
  const _ = useTranslation()
  const user = useAuthStore((state) => state.user)
  const isOwner = user?.role === 'owner'
  const createPrompt = useCreateAiPrompt()
  const updatePrompt = useUpdateAiPrompt()
  const deletePrompt = useDeleteAiPrompt()
  const reorderPrompts = useReorderAiPrompts()
  const restorePrompts = useRestoreAiPrompts()
  const busy = createPrompt.isPending || updatePrompt.isPending || deletePrompt.isPending
    || reorderPrompts.isPending || restorePrompts.isPending
  const showError = (error: unknown) => notify.error(getUserErrorNotification(error, 'settings.aiPromptSaveFailed'))
  // Null unless sorting: outside the edit mode the server list renders as is,
  // so every mutation immediately shows the refreshed catalog.
  const [sortDrafts, setSortDrafts] = useState<AiPromptTemplate[] | null>(null)
  const [form, setForm] = useState<AiPromptFormState | null>(null)
  const [pendingDelete, setPendingDelete] = useState<AiPromptTemplate | null>(null)
  const [sorting, setSorting] = useState(false)
  const [variableHelpOpen, setVariableHelpOpen] = useState(false)
  const [formErrors, setFormErrors] = useState({ name: false, prompt: false })
  const variableHelpRef = useRef<HTMLDivElement>(null)
  const promptNameInputRef = useRef<HTMLInputElement>(null)
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  useDismissiblePopup(variableHelpOpen, variableHelpRef, () => setVariableHelpOpen(false))
  const drafts = sortDrafts ?? prompts

  /** Restore is additive: it only re-adds missing built-in commands, so no confirm. */
  function restoreMissing() {
    restorePrompts.mutate(undefined, {
      onSuccess: (response) => {
        setSortDrafts(null)
        const added = response.data.filter((prompt) => prompt.builtIn && !prompts.some((current) => current.id === prompt.id)).length
        notify.success({ key: 'toast.aiPromptsRestored', params: { count: added } })
      },
      onError: showError,
    })
  }

  function openCreate() {
    setVariableHelpOpen(false)
    setFormErrors({ name: false, prompt: false })
    setForm({ name: '', prompt: '', availability: 'user' })
  }

  function openEdit(prompt: AiPromptTemplate) {
    setVariableHelpOpen(false)
    setFormErrors({ name: false, prompt: false })
    setForm({ id: prompt.id, name: prompt.name, prompt: prompt.prompt, availability: prompt.availability })
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
    // Built-in presets are seeded per account, so publishing one would never
    // reach the other accounts that run their own copy.
    const availability = publishableForm(form, prompts) ? form.availability : undefined
    const onSuccess = () => {
      notify.success({ key: 'toast.aiPromptSaved' })
      closeForm()
    }
    if (form.id) {
      updatePrompt.mutate({ id: form.id, body: { name: form.name.trim(), prompt: form.prompt.trim(), availability } }, {
        onSuccess,
        onError: showError,
      })
    } else {
      createPrompt.mutate({ name: form.name.trim(), prompt: form.prompt.trim(), availability }, {
        onSuccess,
        onError: showError,
      })
    }
  }

  function toggleSorting() {
    if (busy) return
    if (!sorting) {
      setSortDrafts(prompts)
      setSorting(true)
      return
    }
    const draftIds = drafts.map((prompt) => prompt.id)
    const sourceIds = prompts.map((prompt) => prompt.id)
    setSorting(false)
    setSortDrafts(null)
    if (draftIds.length === sourceIds.length && draftIds.every((id, index) => id === sourceIds[index])) return
    reorderPrompts.mutate(draftIds, { onError: showError })
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!sorting || !over || active.id === over.id) return
    const currentIndex = drafts.findIndex((prompt) => prompt.id === active.id)
    const targetIndex = drafts.findIndex((prompt) => prompt.id === over.id)
    if (currentIndex < 0 || targetIndex < 0) return
    setSortDrafts(arrayMove(drafts, currentIndex, targetIndex))
  }

  // ConfirmDialog awaits this; failures surface inline there, so no
  // parallel error toast.
  async function confirmDelete() {
    if (!pendingDelete) return
    await deletePrompt.mutateAsync(pendingDelete.id)
    setPendingDelete(null)
  }

  return <section className="border-t border-stone-100 pt-5 dark:border-stone-800">
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <h3 className="flex items-baseline gap-1.5 text-sm font-semibold text-stone-900 dark:text-stone-100">
          <span>{_('settings.aiPrompts')}</span>
          {drafts.length > 0 && <span className="text-xs font-normal tabular-nums text-stone-400 dark:text-stone-500">· {drafts.length}</span>}
        </h3>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {sorting && restoreAvailable && <button type="button" onClick={restoreMissing} disabled={busy} aria-label={_('settings.aiPromptsRestore')} title={_('settings.aiPromptsRestore')} className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-stone-800 dark:hover:text-stone-200"><RestoreDefaultsIcon /></button>}
        <EditModeButton active={sorting} disabled={busy} onClick={toggleSorting} />
        {!sorting && <button type="button" onClick={openCreate} disabled={busy} aria-label={_('settings.aiPromptAdd')} title={_('settings.aiPromptAdd')} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"><PlusIcon /></button>}
      </div>
    </div>
    {drafts.length === 0 ? <p className="rounded-lg border border-dashed border-stone-200 px-3 py-4 text-center text-xs text-stone-400 dark:border-stone-700">{_('settings.aiPromptsEmpty')}</p> : <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={drafts.map((prompt) => prompt.id)} strategy={verticalListSortingStrategy}>
        <ul className="divide-y divide-stone-100 dark:divide-stone-800">
          {drafts.map((prompt) => <AiPromptRow
            key={prompt.id}
            prompt={prompt}
            disabled={busy}
            sorting={sorting}
            onToggle={(enabled) => updatePrompt.mutate({ id: prompt.id, body: { enabled } }, { onError: showError })}
            onEdit={() => openEdit(prompt)}
            onDelete={() => setPendingDelete(prompt)}
          />)}
        </ul>
      </SortableContext>
    </DndContext>}
    {pendingDelete && <ConfirmDialog title={_('settings.confirmDeleteTitle')} message={_('settings.aiPromptDeleteConfirm', { name: pendingDelete.name })} confirmLabel={_('settings.confirmDeleteAction')} errorFallback="settings.aiPromptSaveFailed" onConfirm={confirmDelete} onClose={() => setPendingDelete(null)} />}
    {form && <Modal title={_(form.id ? 'settings.aiPromptEdit' : 'settings.aiPromptAdd')} onClose={busy ? () => undefined : closeForm}>
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
            disabled={busy}
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
              <div
                role="dialog"
                aria-label={_('settings.aiPromptVariablesHelpTitle')}
                className="absolute left-0 top-7 z-20 w-80 max-w-[calc(100vw-3rem)] rounded-xl border border-stone-200 bg-white p-3 shadow-xl dark:border-stone-700 dark:bg-stone-900 animate-in fade-in zoom-in-95 duration-100"
                style={{
                  boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.08)',
                }}
              >
                <div
                  className="absolute -top-1.5 left-16 h-3 w-3 -translate-x-1/2 rotate-45 border-l border-t border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900"
                  aria-hidden="true"
                />
                <dl className="space-y-2.5">
                  <div><dt className="font-mono text-xs font-semibold text-stone-800 dark:text-stone-100">{'{SELTEXT}'}</dt><dd className="mt-0.5 leading-relaxed text-stone-500 dark:text-stone-400">{_('settings.aiPromptVariableSelText')}</dd></div>
                  <div><dt className="font-mono text-xs font-semibold text-stone-800 dark:text-stone-100">{'{SELPARA}'}</dt><dd className="mt-0.5 leading-relaxed text-stone-500 dark:text-stone-400">{_('settings.aiPromptVariableSelPara')}</dd></div>
                  <div><dt className="font-mono text-xs font-semibold text-stone-800 dark:text-stone-100">{'{CHAPTER}'}</dt><dd className="mt-0.5 leading-relaxed text-stone-500 dark:text-stone-400">{_('settings.aiPromptVariableChapter')}</dd></div>
                </dl>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {AI_PROMPT_VARIABLES.map((variable) => <button key={variable} type="button" onClick={() => insertVariable(variable)} disabled={busy} aria-label={_('settings.aiPromptInsertVariable', { variable })} className="rounded-lg border border-stone-200 px-2.5 py-1.5 font-mono text-xs text-stone-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-700 dark:text-stone-200 dark:hover:border-blue-700 dark:hover:bg-blue-950/30 dark:hover:text-blue-300">{variable}</button>)}
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
            disabled={busy}
            className={settingsTextareaClass}
          />
        </SettingsFormField>
        {publishableForm(form, prompts) && isOwner && (
          <fieldset className="space-y-1.5">
            <legend className="text-xs text-stone-400 dark:text-stone-500">{_('settings.resourceScope')}</legend>
            <SegmentedControl
              ariaLabel={_('settings.resourceScope')}
              fullWidth
              size="md"
              pending={busy}
              value={form.availability}
              onChange={(availability) => setForm({ ...form, availability })}
              options={(['user', 'instance'] as ResourceAvailability[]).map((value) => ({
                value,
                label: _(value === 'user' ? 'settings.resourceScopeUser' : 'settings.resourceScopeInstance'),
              }))}
            />
          </fieldset>
        )}
        <SettingsFormActions onCancel={closeForm} pending={busy} />
      </form>
    </Modal>}
  </section>
}

/** Built-in presets stay personal: every account runs its own seeded copy. */
function publishableForm(form: AiPromptFormState, prompts: AiPromptTemplate[]) {
  return form.id === undefined || prompts.find((prompt) => prompt.id === form.id)?.builtIn !== true
}
