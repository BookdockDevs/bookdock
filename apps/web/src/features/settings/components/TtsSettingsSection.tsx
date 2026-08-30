import { useMemo, useRef, useState } from 'react'

import type { TtsProvider, TtsServiceCreateReq, TtsServiceRes, TtsServiceUpdateReq } from '@bookdock/shared'

import { useCreateTtsService, useDeleteTtsService, useTestTtsService, useTestTtsServiceDraft, useTtsProviders, useTtsServices, useUpdateTtsService } from '@/api/hooks/useTts'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Modal from '@/components/ui/Modal'
import { useDismissiblePopup } from '@/hooks/useDismissiblePopup'
import { useTranslation } from '@/hooks/useTranslation'
import { useAuthStore } from '@/stores/auth.store'
import { useToastStore } from '@/stores/toast.store'

interface TtsFormState {
  id?: string
  provider: TtsProvider
  name: string
  baseUrl: string
  model: string
  defaultVoice: string
  options: Record<string, string | number | boolean>
  secrets: Record<string, string>
}

const FALLBACK_PROVIDERS: { id: TtsProvider; kind: 'native' | 'openai-compatible'; defaultBaseUrl: string | null; defaultModel: string | null }[] = [
  { id: 'openai', kind: 'native', defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini-tts' },
  { id: 'azure', kind: 'native', defaultBaseUrl: null, defaultModel: null },
  { id: 'aliyun', kind: 'native', defaultBaseUrl: 'https://nls-gateway.aliyuncs.com/stream/v1/tts', defaultModel: null },
  { id: 'dashscope', kind: 'native', defaultBaseUrl: 'https://dashscope.aliyuncs.com', defaultModel: 'qwen3-tts-instruct-flash' },
  { id: 'minimax', kind: 'native', defaultBaseUrl: 'https://api.minimaxi.com', defaultModel: 'speech-2.8-turbo' },
  { id: 'mimo', kind: 'native', defaultBaseUrl: 'https://api.xiaomimimo.com/v1', defaultModel: 'mimo-v2.5-tts' },
  { id: 'volcengine', kind: 'native', defaultBaseUrl: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional', defaultModel: 'seed-tts-2.0' },
  { id: 'openai-compatible', kind: 'openai-compatible', defaultBaseUrl: '', defaultModel: '' },
]

const PROVIDER_NAMES: Record<TtsProvider, string> = {
  openai: 'OpenAI',
  azure: 'Azure OpenAI / Speech',
  aliyun: '阿里云智能语音',
  dashscope: '通义千问 TTS',
  minimax: 'MiniMax',
  mimo: 'MiMo',
  volcengine: '火山引擎',
  'openai-compatible': 'OpenAI 兼容接口',
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
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

function makeForm(provider: TtsProvider, catalog: typeof FALLBACK_PROVIDERS, service?: TtsServiceRes): TtsFormState {
  const meta = catalog.find((item) => item.id === provider) ?? FALLBACK_PROVIDERS.find((item) => item.id === provider)!
  return {
    id: service?.id,
    provider,
    name: service?.name ?? PROVIDER_NAMES[provider],
    baseUrl: service?.baseUrl ?? meta.defaultBaseUrl ?? '',
    model: service?.model ?? meta.defaultModel ?? '',
    defaultVoice: service?.defaultVoice ?? '',
    options: service?.options ?? (provider === 'azure' ? { region: 'global' } : {}),
    secrets: {},
  }
}

export default function TtsSettingsSection({ id }: { id?: string }) {
  const _ = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const user = useAuthStore((s) => s.user)
  const isGuest = user?.role === 'guest' || user?.guest === true
  const { data: servicesData } = useTtsServices()
  const { data: providersData } = useTtsProviders()
  const providers = providersData?.data ?? FALLBACK_PROVIDERS
  const create = useCreateTtsService()
  const update = useUpdateTtsService()
  const remove = useDeleteTtsService()
  const test = useTestTtsService()
  const testDraft = useTestTtsServiceDraft()
  const [form, setForm] = useState<TtsFormState | null>(null)
  const [providerMenuOpen, setProviderMenuOpen] = useState(false)
  const providerMenuRef = useRef<HTMLDivElement>(null)
  const [pendingDelete, setPendingDelete] = useState<TtsServiceRes | null>(null)
  const services = useMemo(() => servicesData?.data ?? [], [servicesData])
  useDismissiblePopup(providerMenuOpen, providerMenuRef, () => setProviderMenuOpen(false))

  function openCreate(provider: TtsProvider) {
    setProviderMenuOpen(false)
    setForm(makeForm(provider, providers))
  }

  function openEdit(service: TtsServiceRes) {
    setForm(makeForm(service.provider, providers, service))
  }

  function save() {
    if (!form) return
    const common = {
      name: form.name.trim(),
      provider: form.provider,
      baseUrl: form.baseUrl.trim() || null,
      model: form.model.trim() || null,
      defaultVoice: form.defaultVoice.trim() || null,
      options: form.options,
    }
    if (form.id) {
      const body: TtsServiceUpdateReq = { ...common, secrets: Object.fromEntries(Object.entries(form.secrets).filter(([, value]) => value.trim())) }
      update.mutate({ id: form.id, body }, { onSuccess: () => { setForm(null); addToast(_('settings.ttsSaved'), 'success') }, onError: (error) => addToast(error.message, 'error') })
    } else {
      const body: TtsServiceCreateReq = { ...common, secrets: Object.fromEntries(Object.entries(form.secrets).filter(([, value]) => value.trim())) }
      create.mutate(body, { onSuccess: () => { setForm(null); addToast(_('settings.ttsSaved'), 'success') }, onError: (error) => addToast(error.message, 'error') })
    }
  }

  function confirmDelete() {
    if (!pendingDelete) return
    remove.mutate(pendingDelete.id, { onSuccess: () => { if (form?.id === pendingDelete.id) setForm(null); addToast(_('settings.ttsDeleted'), 'success') }, onError: (error) => addToast(error.message, 'error') })
    setPendingDelete(null)
  }

  function testCurrent() {
    if (!form) return
    if (form.id) {
      test.mutate(form.id, { onSuccess: () => addToast(_('settings.ttsTestSuccess'), 'success'), onError: (error) => addToast(error.message, 'error') })
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
    testDraft.mutate(body, { onSuccess: () => addToast(_('settings.ttsTestSuccess'), 'success'), onError: (error) => addToast(error.message, 'error') })
  }

  return (
    <section id={id} className="scroll-mt-6 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6 dark:border-stone-800 dark:bg-stone-900">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">{_('settings.tts')}</h2>
        </div>
        {!isGuest && <div ref={providerMenuRef} className="relative shrink-0">
          <button type="button" onClick={() => setProviderMenuOpen((value) => !value)} className="rounded-lg border border-stone-200 px-3 py-2 text-xs font-medium text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800">{_('settings.ttsAdd')}⌄</button>
          {providerMenuOpen && <div className="absolute right-0 z-10 mt-2 w-max min-w-full max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-stone-200 bg-white py-1 shadow-lg dark:border-stone-700 dark:bg-stone-900">
            {providers.map((provider) => <button key={provider.id} type="button" onClick={() => openCreate(provider.id)} className="block w-full truncate whitespace-nowrap px-3 py-2 text-left text-xs text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-800" title={PROVIDER_NAMES[provider.id]}>{PROVIDER_NAMES[provider.id]}</button>)}
          </div>}
        </div>}
      </div>

      {isGuest ? <p className="rounded-lg bg-stone-100 px-3 py-2 text-xs text-stone-500 dark:bg-stone-800 dark:text-stone-400">{_('settings.ttsGuestHint')}</p> : services.length === 0 ? <p className="rounded-lg border border-dashed border-stone-200 px-4 py-8 text-center text-sm text-stone-400 dark:border-stone-700 dark:text-stone-500">{_('settings.ttsEmpty')}</p> : <div className="divide-y divide-stone-100 dark:divide-stone-800">
        {services.map((service) => <div key={service.id} className="flex items-center gap-3 py-3">
          <div className="min-w-0 flex-1"><p className="truncate text-sm text-stone-800 dark:text-stone-100">{service.name}</p><p className="mt-0.5 truncate text-xs text-stone-400">{PROVIDER_NAMES[service.provider]}{service.model ? ` · ${service.model}` : ''}</p></div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => openEdit(service)}
              aria-label={_('library.edit')}
              title={_('library.edit')}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            >
              <EditIcon />
            </button>
            <button
              type="button"
              onClick={() => setPendingDelete(service)}
              aria-label={_('settings.fontsDelete')}
              title={_('settings.fontsDelete')}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-red-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-stone-800 dark:hover:text-red-400"
            >
              <TrashIcon />
            </button>
          </div>
        </div>)}
      </div>}

      {pendingDelete && <ConfirmDialog message={_('settings.ttsDeleteConfirm')} onConfirm={confirmDelete} onClose={() => setPendingDelete(null)} />}
      {form && <Modal title={_(form.id ? 'settings.ttsEdit' : 'settings.ttsAdd')} onClose={() => setForm(null)}>
        <TtsServiceForm form={form} setForm={setForm} onSave={save} onTest={testCurrent} saving={create.isPending || update.isPending} testing={test.isPending || testDraft.isPending} />
      </Modal>}
    </section>
  )
}

function TtsServiceForm({ form, setForm, onSave, onTest, saving, testing }: { form: TtsFormState; setForm: (value: TtsFormState) => void; onSave: () => void; onTest: () => void; saving: boolean; testing: boolean }) {
  const _ = useTranslation()
  const field = 'h-9 rounded-lg border border-stone-200 bg-transparent px-3 text-sm outline-none focus:border-blue-500 dark:border-stone-700'
  const set = (patch: Partial<TtsFormState>) => setForm({ ...form, ...patch })
  const setSecret = (key: string, value: string) => set({ secrets: { ...form.secrets, [key]: value } })
  const isAliyun = form.provider === 'aliyun'
  const isAzure = form.provider === 'azure'
  const needsModel = !isAliyun && !isAzure
  return <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); onSave() }}>
    <label className="flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-300"><span>{_('settings.ttsName')}</span><input required value={form.name} onChange={(event) => set({ name: event.target.value })} className={field} /></label>
    {isAzure ? <label className="flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-300"><span>Region</span><input required value={String(form.options.region ?? '')} onChange={(event) => set({ options: { ...form.options, region: event.target.value } })} placeholder="global" className={field} /></label> : <label className="flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-300"><span>{_('settings.ttsBaseUrl')}</span><input required={form.provider === 'openai-compatible'} value={form.baseUrl} onChange={(event) => set({ baseUrl: event.target.value })} className={field} /></label>}
    {needsModel && <label className="flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-300"><span>{_('settings.ttsModel')}</span><input required value={form.model} onChange={(event) => set({ model: event.target.value })} className={field} /></label>}
    {isAliyun ? <><label className="flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-300"><span>App Key</span><input required={!form.id} value={form.secrets.appKey ?? ''} onChange={(event) => setSecret('appKey', event.target.value)} className={field} /></label><label className="flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-300"><span>Access Key ID</span><input required={!form.id} value={form.secrets.accessKeyId ?? ''} onChange={(event) => setSecret('accessKeyId', event.target.value)} className={field} /></label><label className="flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-300"><span>Access Key Secret</span><input required={!form.id} type="password" value={form.secrets.accessKeySecret ?? ''} onChange={(event) => setSecret('accessKeySecret', event.target.value)} className={field} /></label></> : <label className="flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-300"><span>{_('settings.ttsApiKey')}</span><input required={!form.id} type="password" value={form.secrets.apiKey ?? ''} onChange={(event) => setSecret('apiKey', event.target.value)} autoComplete="new-password" className={field} /></label>}
    <label className="flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-300"><span>{_('settings.ttsDefaultVoice')}</span><input value={form.defaultVoice} onChange={(event) => set({ defaultVoice: event.target.value })} placeholder={isAzure ? 'zh-CN-XiaoxiaoNeural' : form.provider === 'mimo' ? '冰糖' : form.provider === 'minimax' ? 'Chinese (Mandarin)_Male_Announcer' : 'alloy'} className={field} /></label>
    {form.provider === 'openai' && <label className="flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-300"><span>{_('settings.ttsInstructions')}</span><textarea value={String(form.options.instructions ?? '')} onChange={(event) => set({ options: { ...form.options, instructions: event.target.value } })} className="min-h-20 rounded-lg border border-stone-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-stone-700" /></label>}
    <p className="text-xs leading-5 text-stone-400">{_('settings.ttsSecretHint')}</p>
    <div className="flex justify-end gap-2 border-t border-stone-100 pt-4 dark:border-stone-800"><button type="button" disabled={testing} onClick={onTest} className="rounded-lg border border-stone-200 px-4 py-2 text-xs font-medium text-stone-700 disabled:opacity-50 dark:border-stone-700 dark:text-stone-200">{_('settings.ttsTest')}</button><button type="submit" disabled={saving} className="rounded-lg bg-stone-900 px-4 py-2 text-xs font-medium text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900">{_('settings.ttsSave')}</button></div>
  </form>
}
