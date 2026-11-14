import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'

import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable'

import type { ResourceAvailability, TtsProvider, TtsServiceCreateReq, TtsServiceRes, TtsServiceUpdateReq } from '@bookdock/shared'

import { useCreateTtsService, useDeleteTtsService, useReorderTtsServices, useTestTtsService, useTestTtsServiceDraft, useTtsProviders, useTtsServices, useUpdateTtsService } from '@/api/hooks/useTts'
import { Button } from '@/components/ui/Button'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Modal from '@/components/ui/Modal'
import PasswordInput from '@/components/ui/PasswordInput'
import { validatePasswordInputs } from '@/components/ui/password-input-validation'
import QueryErrorState from '@/components/ui/QueryErrorState'
import SegmentedControl from '@/components/ui/SegmentedControl'
import SettingsEmptyState from '@/components/ui/SettingsEmptyState'
import SmartMenu, { menuItemClass } from '@/components/ui/SmartMenu'
import { useTranslation } from '@/hooks/useTranslation'
import { useMenuAnchor } from '@/hooks/useMenuAnchor'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { useAuthStore } from '@/stores/auth.store'

import EditModeButton from './EditModeButton'
import SettingsCard from './SettingsCard'
import TtsProviderIcon from './TtsProviderIcon'
import TtsServiceRow from './TtsServiceRow'
import { PlusIcon } from './row-icons'

interface TtsFormState {
  id?: string
  provider: TtsProvider
  name: string
  baseUrl: string
  model: string
  defaultVoice: string
  options: Record<string, string | number | boolean>
  secrets: Record<string, string>
  /** Publication scope; only the instance owner may change it. */
  availability: ResourceAvailability
}

const FALLBACK_PROVIDERS: { id: TtsProvider; kind: 'native' | 'openai-compatible'; defaultBaseUrl: string | null; defaultModel: string | null }[] = [
  { id: 'openai', kind: 'openai-compatible', defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: null },
  { id: 'azure', kind: 'native', defaultBaseUrl: null, defaultModel: null },
  { id: 'aliyun', kind: 'native', defaultBaseUrl: 'https://nls-gateway.aliyuncs.com/stream/v1/tts', defaultModel: null },
  { id: 'dashscope', kind: 'native', defaultBaseUrl: 'https://dashscope.aliyuncs.com', defaultModel: 'qwen3-tts-instruct-flash' },
  { id: 'minimax', kind: 'native', defaultBaseUrl: 'https://api.minimaxi.com', defaultModel: 'speech-2.8-turbo' },
  { id: 'mimo', kind: 'native', defaultBaseUrl: 'https://api.xiaomimimo.com/v1', defaultModel: 'mimo-v2.5-tts' },
  { id: 'volcengine', kind: 'native', defaultBaseUrl: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional', defaultModel: 'seed-tts-2.0' },
]

const PROVIDER_NAMES: Record<TtsProvider, string> = {
  openai: 'OpenAI',
  azure: 'Azure OpenAI / Speech',
  aliyun: '阿里云智能语音',
  dashscope: '通义千问 TTS',
  minimax: 'MiniMax',
  mimo: 'MiMo',
  volcengine: '火山引擎',
  'openai-compatible': 'OpenAI',
}

function HeadphonesIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" />
    </svg>
  )
}

function makeForm(provider: TtsProvider, catalog: typeof FALLBACK_PROVIDERS, service?: TtsServiceRes): TtsFormState {
  const canonicalProvider = provider === 'openai-compatible' ? 'openai' : provider
  const meta = catalog.find((item) => item.id === canonicalProvider) ?? FALLBACK_PROVIDERS.find((item) => item.id === canonicalProvider)!
  return {
    id: service?.id,
    provider: canonicalProvider,
    name: service?.name ?? PROVIDER_NAMES[canonicalProvider],
    baseUrl: service?.baseUrl ?? meta.defaultBaseUrl ?? '',
    model: service?.model ?? meta.defaultModel ?? '',
    defaultVoice: service?.defaultVoice ?? '',
    options: service?.options ?? (provider === 'azure' ? { region: 'global' } : {}),
    secrets: {},
    availability: service?.availability ?? 'user',
  }
}

export default function TtsSettingsSection({ id }: { id?: string }) {
  const _ = useTranslation()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const isGuest = !user
  const servicesQuery = useTtsServices({ enabled: !isGuest })
  const { data: servicesData } = servicesQuery
  const { data: providersData } = useTtsProviders({ enabled: !isGuest })
  const providers = providersData?.data ?? FALLBACK_PROVIDERS
  const create = useCreateTtsService()
  const update = useUpdateTtsService()
  const remove = useDeleteTtsService()
  const reorder = useReorderTtsServices()
  const test = useTestTtsService()
  const testDraft = useTestTtsServiceDraft()
  const [form, setForm] = useState<TtsFormState | null>(null)
  const { open: menuOpen, anchor: menuAnchor, menuRef, btnRef: menuBtnRef, close: closeMenu, toggleFromButton } = useMenuAnchor()
  const [editing, setEditing] = useState(false)
  const [draftIds, setDraftIds] = useState<string[] | null>(null)
  const [pendingDelete, setPendingDelete] = useState<TtsServiceRes | null>(null)
  const [stateAccountId, setStateAccountId] = useState(user?.id ?? null)
  const ownsState = stateAccountId === (user?.id ?? null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  useEffect(() => {
    if (ownsState) return
    setForm(null)
    setPendingDelete(null)
    setEditing(false)
    setDraftIds(null)
    setStateAccountId(user?.id ?? null)
  }, [ownsState, user?.id])
  const savedServices = useMemo(() => servicesData?.data ?? [], [servicesData])
  // Edit mode reorders a local draft; browsing always shows the persisted order.
  const services = useMemo(() => {
    if (!editing || !draftIds) return savedServices
    const byId = new Map(savedServices.map((service) => [service.id, service]))
    return [...draftIds.flatMap((id) => byId.get(id) ? [byId.get(id)!] : []), ...savedServices.filter((service) => !draftIds.includes(service.id))]
  }, [savedServices, editing, draftIds])
  const isOwner = user?.role === 'owner'
  const busy = create.isPending || update.isPending || remove.isPending || reorder.isPending
  const ownsSession = () => Boolean(user && useAuthStore.getState().user?.id === user.id && ownsState)
  const showError = (error: unknown) => { if (ownsSession()) notify.error(getUserErrorNotification(error, 'settings.ttsOperationFailed')) }

  function openCreate(provider: TtsProvider) {
    if (!ownsSession()) return
    closeMenu()
    setForm(makeForm(provider, providers))
  }

  function openEdit(service: TtsServiceRes) {
    if (!ownsSession()) return
    setForm(makeForm(service.provider, providers, service))
  }

  function toggleEnabled(service: TtsServiceRes, enabled: boolean) {
    if (!ownsSession()) return
    update.mutate({ id: service.id, body: { enabled } }, { onError: showError })
  }

  function save() {
    if (!form || !ownsSession()) return
    const common = {
      name: form.name.trim(),
      provider: form.provider,
      baseUrl: form.baseUrl.trim() || null,
      model: form.model.trim() || null,
      defaultVoice: form.defaultVoice.trim() || null,
      options: form.options,
    }
    if (form.id) {
      const body: TtsServiceUpdateReq = { ...common, availability: form.availability, secrets: Object.fromEntries(Object.entries(form.secrets).filter(([, value]) => value.trim())) }
      update.mutate({ id: form.id, body }, { onSuccess: () => { if (ownsSession()) { setForm(null); notify.success({ key: 'settings.ttsSaved' }) } }, onError: showError })
    } else {
      const body: TtsServiceCreateReq = { ...common, secrets: Object.fromEntries(Object.entries(form.secrets).filter(([, value]) => value.trim())) }
      create.mutate(body, { onSuccess: () => { if (ownsSession()) { setForm(null); notify.success({ key: 'settings.ttsSaved' }) } }, onError: showError })
    }
  }

  function confirmDelete() {
    if (!pendingDelete || !ownsSession()) return
    const serviceId = pendingDelete.id
    remove.mutate(serviceId, {
      onSuccess: () => {
        if (!ownsSession()) return
        if (form?.id === serviceId) setForm(null)
        // Keep the edit-mode draft in step, or submitting a stale id would be rejected.
        setDraftIds((current) => current?.filter((id) => id !== serviceId) ?? current)
        notify.success({ key: 'settings.ttsDeleted' })
      },
      onError: showError,
    })
    setPendingDelete(null)
  }

  function toggleEditing() {
    if (busy) return
    closeMenu()
    if (!editing) {
      setDraftIds(savedServices.map((service) => service.id))
      setEditing(true)
      return
    }
    const draft = draftIds ?? []
    const sourceIds = savedServices.map((service) => service.id)
    // The server demands the exact current set: drop ids removed elsewhere and
    // append ones this draft never saw (another tab) rather than sending a
    // partial order it would reject.
    const nextOrder = [...draft.filter((id) => sourceIds.includes(id)), ...sourceIds.filter((id) => !draft.includes(id))]
    setEditing(false)
    if (nextOrder.every((id, index) => id === sourceIds[index])) {
      setDraftIds(null)
      return
    }
    reorder.mutate(nextOrder, { onSuccess: () => setDraftIds(null), onError: (error) => { setDraftIds(null); showError(error) } })
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!editing || busy || !over || active.id === over.id) return
    const currentIds = services.map((service) => service.id)
    const from = currentIds.indexOf(String(active.id))
    const to = currentIds.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    setDraftIds(arrayMove(currentIds, from, to))
  }

  function testCurrent() {
    if (!form || !ownsSession()) return
    if (form.id) {
      test.mutate(form.id, { onSuccess: () => { if (ownsSession()) notify.success({ key: 'settings.ttsTestSuccess' }) }, onError: showError })
      return
    }
    const body: TtsServiceCreateReq = {
      name: form.name.trim(),
      provider: form.provider,
      baseUrl: form.baseUrl.trim() || null,
      model: form.model.trim() || null,
      defaultVoice: form.defaultVoice.trim() || null,
      options: form.options,
      secrets: Object.fromEntries(Object.entries(form.secrets).filter(([, value]) => value.trim())),
    }
    testDraft.mutate(body, { onSuccess: () => { if (ownsSession()) notify.success({ key: 'settings.ttsTestSuccess' }) }, onError: showError })
  }

  return (
    <>
      <SettingsCard
        id={id}
        className="scroll-mt-6"
        icon={<HeadphonesIcon className="h-5 w-5" />}
        iconBgClass="bg-sky-500/10 text-sky-600 dark:bg-sky-500/20 dark:text-sky-400"
        title={
          <span className="flex items-baseline gap-1.5">
            <span>{_('settings.tts')}</span>
            {services.length > 0 && <span className="text-xs font-normal tabular-nums text-stone-400 dark:text-stone-500">· {services.length}</span>}
          </span>
        }
        action={
          !isGuest ? (
            <div className="flex shrink-0 items-center gap-1">
              {services.length > 0 && (
                <EditModeButton
                  active={editing}
                  disabled={busy}
                  onClick={toggleEditing}
                />
              )}
              <button
                ref={menuBtnRef}
                type="button"
                disabled={editing || busy}
                onClick={(event) => toggleFromButton(event, 'below')}
                aria-expanded={menuOpen}
                aria-label={_('settings.ttsAdd')}
                title={_('settings.ttsAdd')}
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
                  <div className="flex flex-col gap-0.5">
                    {providers.map((provider) => (
                      <button
                        key={provider.id}
                        type="button"
                        onClick={() => openCreate(provider.id)}
                        className={menuItemClass}
                        title={PROVIDER_NAMES[provider.id]}
                      >
                        <TtsProviderIcon provider={provider.id} className="h-5 w-5" />
                        <span className="truncate">{PROVIDER_NAMES[provider.id]}</span>
                      </button>
                    ))}
                  </div>
                </SmartMenu>
              )}
            </div>
          ) : undefined
        }
      >
        {isGuest ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-stone-100/80 px-3.5 py-2.5 text-xs text-stone-500 dark:bg-stone-800/80 dark:text-stone-400">
            <span className="min-w-0 flex-1">{_('settings.ttsGuestHint')}</span>
            <button
              type="button"
              onClick={() => void navigate({ to: '/login' })}
              className="shrink-0 font-medium text-stone-700 underline-offset-2 hover:underline dark:text-stone-300 dark:hover:text-stone-100"
            >
              {_('auth.signIn')} →
            </button>
          </div>
        ) : servicesQuery.isError ? (
          <QueryErrorState isRetrying={servicesQuery.isFetching} onRetry={servicesQuery.refetch} />
        ) : servicesQuery.isPending && !servicesQuery.data ? (
          <div className="space-y-3 py-1">
            {[1, 2].map((i) => (
              <div key={i} className="flex animate-pulse items-center justify-between py-2.5">
                <div className="space-y-1.5">
                  <div className="h-4 w-28 rounded bg-stone-200/80 dark:bg-stone-800" />
                  <div className="h-3 w-44 rounded bg-stone-100 dark:bg-stone-800/60" />
                </div>
                <div className="h-5 w-9 rounded-full bg-stone-200/80 dark:bg-stone-800" />
              </div>
            ))}
          </div>
        ) : services.length === 0 ? (
          <SettingsEmptyState>{_('settings.ttsEmpty')}</SettingsEmptyState>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={services.map((service) => service.id)} strategy={verticalListSortingStrategy}>
              <ul className="divide-y divide-stone-100 dark:divide-stone-800">
                {services.map((service) => (
                  <TtsServiceRow
                    key={service.id}
                    service={service}
                    editing={editing}
                    disabled={busy}
                    onToggle={(enabled) => toggleEnabled(service, enabled)}
                    canEdit={service.mine}
                    onEdit={() => openEdit(service)}
                    onDelete={() => setPendingDelete(service)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </SettingsCard>

      {ownsState && pendingDelete && (
        <ConfirmDialog
          title={_('settings.confirmDeleteTitle')}
          message={_('settings.ttsDeleteConfirm', { name: pendingDelete.name })}
          confirmLabel={_('settings.confirmDeleteAction')}
          onConfirm={confirmDelete}
          onClose={() => setPendingDelete(null)}
        />
      )}
      {ownsState && form && (
        <Modal title={_(form.id ? 'settings.ttsEdit' : 'settings.ttsAdd')} onClose={() => setForm(null)}>
          <TtsServiceForm
            form={form}
            canEdit={isOwner && servicesData?.data.some((service) => service.id === form.id && service.mine) === true}
            savedCredentialsAvailable={servicesData?.data.some((service) => service.id === form.id && service.credentialsConfigured) === true}
            setForm={setForm}
            onSave={save}
            onTest={testCurrent}
            onCancel={() => setForm(null)}
            saving={create.isPending || update.isPending}
            testing={test.isPending || testDraft.isPending}
          />
        </Modal>
      )}
    </>
  )
}

function TtsServiceForm({
  form,
  setForm,
  onSave,
  onTest,
  onCancel,
  saving,
  testing,
  savedCredentialsAvailable,
  canEdit,
}: {
  savedCredentialsAvailable: boolean
  canEdit: boolean
  form: TtsFormState
  setForm: (value: TtsFormState) => void
  onSave: () => void
  onTest: () => void
  onCancel: () => void
  saving: boolean
  testing: boolean
}) {
  const _ = useTranslation()
  const field = 'h-9 rounded-lg border border-stone-200 bg-transparent px-3 text-sm outline-none focus:border-blue-500 dark:border-stone-700'
  const set = (patch: Partial<TtsFormState>) => setForm({ ...form, ...patch })
  const setSecret = (key: string, value: string) => set({ secrets: { ...form.secrets, [key]: value } })
  const isAliyun = form.provider === 'aliyun'
  const isAzure = form.provider === 'azure'
  const needsModel = !isAliyun && !isAzure

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (validatePasswordInputs(event)) onSave() }}>
      <label className="flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-300">
        <span>{_('settings.ttsName')}</span>
        <input required value={form.name} onChange={(event) => set({ name: event.target.value })} className={field} />
      </label>
      {isAzure ? (
        <label className="flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-300">
          <span>Region</span>
          <input required value={String(form.options.region ?? '')} onChange={(event) => set({ options: { ...form.options, region: event.target.value } })} placeholder="global" className={field} />
        </label>
      ) : (
        <label className="flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-300">
          <span>{_('settings.ttsBaseUrl')}</span>
          <input value={form.baseUrl} onChange={(event) => set({ baseUrl: event.target.value })} className={field} />
        </label>
      )}
      {needsModel && (
        <label className="flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-300">
          <span>{_('settings.ttsModel')}</span>
          <input required value={form.model} onChange={(event) => set({ model: event.target.value })} className={field} />
        </label>
      )}
      {isAliyun ? (
        <>
          <div className="flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-300">
            <span>App Key</span>
            <PasswordInput key={`${form.id ?? 'new'}-${form.provider}`} aria-label="App Key" secret disabled={saving} required={!form.id} value={form.secrets.appKey ?? ''} onChange={(event) => setSecret('appKey', event.target.value)} className={field} />
          </div>
          <label className="flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-300">
            <span>Access Key ID</span>
            <input required={!form.id} value={form.secrets.accessKeyId ?? ''} onChange={(event) => setSecret('accessKeyId', event.target.value)} className={field} />
          </label>
          <div className="flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-300">
            <span>Access Key Secret</span>
            <PasswordInput key={`${form.id ?? 'new'}-${form.provider}`} aria-label="Access Key Secret" secret disabled={saving} required={!form.id} value={form.secrets.accessKeySecret ?? ''} onChange={(event) => setSecret('accessKeySecret', event.target.value)} className={field} />
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-300">
          <span>{_('settings.ttsApiKey')}</span>
          <PasswordInput key={`${form.id ?? 'new'}-${form.provider}`} aria-label={_('settings.ttsApiKey')} secret disabled={saving} required={!form.id} value={form.secrets.apiKey ?? ''} onChange={(event) => setSecret('apiKey', event.target.value)} autoComplete="new-password" className={field} />
        </div>
      )}
      {savedCredentialsAvailable && <p className="text-xs leading-5 text-stone-400">{_('settings.ttsSecretHint')}</p>}
      <label className="flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-300">
        <span>{_('settings.ttsDefaultVoice')}</span>
        <input value={form.defaultVoice} onChange={(event) => set({ defaultVoice: event.target.value })} placeholder={isAzure ? 'zh-CN-XiaoxiaoNeural' : form.provider === 'mimo' ? '冰糖' : form.provider === 'minimax' ? 'Chinese (Mandarin)_Male_Announcer' : 'alloy'} className={field} />
      </label>
      {form.provider === 'openai' && (
        <label className="flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-300">
          <span>{_('settings.ttsInstructions')}</span>
          <textarea value={String(form.options.instructions ?? '')} onChange={(event) => set({ options: { ...form.options, instructions: event.target.value } })} className="min-h-20 rounded-lg border border-stone-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-stone-700" />
        </label>
      )}
      {form.id && canEdit && (
        <fieldset className="space-y-1.5">
          <legend className="text-xs text-stone-400 dark:text-stone-500">{_('settings.resourceScope')}</legend>
          <SegmentedControl
            ariaLabel={_('settings.resourceScope')}
            fullWidth
            size="md"
            pending={saving}
            value={form.availability}
            onChange={(value) => set({ availability: value })}
            options={(['user', 'instance'] as ResourceAvailability[]).map((value) => ({
              value,
              label: _(value === 'user' ? 'settings.resourceScopeUser' : 'settings.resourceScopeInstance'),
            }))}
          />
        </fieldset>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-100 pt-4 dark:border-stone-800">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={testing || saving}
          onClick={onTest}
        >
          <TestIcon className={testing ? 'animate-pulse text-blue-500' : 'text-stone-400'} />
          <span>{_(testing ? 'settings.ttsTesting' : 'settings.ttsTest')}</span>
        </Button>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={saving || testing}
            onClick={onCancel}
          >
            {_('common.cancel')}
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={saving || testing}
          >
            {_(saving ? 'passwordInput.saving' : 'settings.ttsSave')}
          </Button>
        </div>
      </div>
    </form>
  )
}

function TestIcon({ className }: { className?: string }) {
  return <svg className={className} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.2 8.8a4.7 4.7 0 0 1 8.8-2.4 4.7 4.7 0 0 1 8.8 2.4c0 5.1-4.3 8.3-8.8 11.2C7.5 17.1 3.2 13.9 3.2 8.8Z" /><path d="M3 12h4l1.5-3 3 6 1.5-3H21" /></svg>
}
