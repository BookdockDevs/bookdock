import { useState } from 'react'

import type { AiConnectionRes, AiModelEntryRes, AiProvider, AiProviderRes, ResourceAvailability } from '@bookdock/shared'

import { useCreateAiConnection, useUpdateAiConnection, useUpdateAiModel } from '@/api/hooks/useAi'
import AiBrandIcon from '@/components/ui/AiBrandIcon'
import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import PasswordInput from '@/components/ui/PasswordInput'
import SegmentedControl from '@/components/ui/SegmentedControl'
import SmartMenu from '@/components/ui/SmartMenu'
import { useMenuAnchor } from '@/hooks/useMenuAnchor'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { useAuthStore } from '@/stores/auth.store'

import AiModelsPanel from './AiModelsPanel'
import AiProviderMenuItems from './AiProviderMenuItems'
import SettingsFormField from './SettingsFormField'
import { settingsFormClass, settingsInputClass } from './settingsForm'

interface AiConnectionEditorProps {
  connection: AiConnectionRes | null
  /** Provider picked from the "add" menu; only used while creating a new connection. */
  initialProvider?: AiProvider
  providers: AiProviderRes[]
  /** Models of the edited connection, shown below the form (empty while creating). */
  models: AiModelEntryRes[]
  onClose: () => void
}

export default function AiConnectionEditor({ connection, initialProvider, providers, models, onClose }: AiConnectionEditorProps) {
  const _ = useTranslation()
  const user = useAuthStore((state) => state.user)
  const isOwner = user?.role === 'owner'
  const create = useCreateAiConnection()
  const update = useUpdateAiConnection()
  const updateModel = useUpdateAiModel()
  // Model exposure flips are drafts like the form fields: nothing hits the
  // server until 保存 commits the connection and the toggles together.
  const [enabledDrafts, setEnabledDrafts] = useState<Record<string, boolean>>({})
  const { open: providerMenuOpen, anchor: providerMenuAnchor, menuRef: providerMenuRef, btnRef: providerBtnRef, close: closeProviderMenu, toggleFromButton: toggleProviderMenu } = useMenuAnchor()
  const initial = providers.find((provider) => provider.id === (connection?.provider ?? initialProvider)) ?? providers[0]
  const [name, setName] = useState(connection?.name ?? initial?.name ?? '')
  const [provider, setProvider] = useState<AiProvider>(connection?.provider ?? initial?.id ?? 'openai')
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? initial?.defaultBaseUrl ?? '')
  const [apiKey, setApiKey] = useState('')
  const [availability, setAvailability] = useState<ResourceAvailability>(connection?.availability ?? 'user')
  const selectedProvider = providers.find((item) => item.id === provider)
  const savedKeyAvailable = Boolean(connection?.apiKeyConfigured && connection.provider === provider)
  const requiresApiKey = Boolean(selectedProvider?.requiresApiKey && (provider !== 'openai' || !baseUrl.trim() || baseUrl.trim().replace(/\/+$/, '').toLowerCase() === 'https://api.openai.com/v1'))
  const apiKeyRequired = requiresApiKey && !savedKeyAvailable && !connection
  const saving = create.isPending || update.isPending

  function changeProvider(next: AiProvider) {
    const catalog = providers.find((item) => item.id === next)
    setProvider(next)
    setBaseUrl(catalog?.defaultBaseUrl ?? '')
    setApiKey('')
    if (!connection) setName(catalog?.name ?? '')
  }

  function save() {
    const body = {
      name: name.trim(),
      provider,
      baseUrl: baseUrl.trim() || null,
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    }
    const onSuccess = () => { onClose(); notify.success({ key: 'settings.aiSaved' }) }
    const onError = (error: unknown) => notify.error(getUserErrorNotification(error, 'settings.aiOperationFailed'))
    if (connection) {
      update.mutate({ id: connection.id, body: { ...body, availability } }, { onSuccess, onError })
      // The dialog closes on the connection success; these keep running in the
      // background and invalidate the same catalog query.
      for (const model of models) {
        const enabled = enabledDrafts[model.id]
        if (enabled !== undefined && enabled !== model.enabled) updateModel.mutate({ id: model.id, body: { enabled } }, { onError })
      }
    }
    else create.mutate(body, { onSuccess, onError })
  }

  function clearApiKey() {
    if (!connection) return
    update.mutate({ id: connection.id, body: { apiKey: null } }, {
      onSuccess: () => { setApiKey(''); notify.success({ key: 'settings.aiKeyCleared' }) },
      onError: (error) => notify.error(getUserErrorNotification(error, 'settings.aiOperationFailed')),
    })
  }

  // Shared connections stay in their owner's hands: consumers only get the model list.
  const showForm = !connection || connection.mine
  const connectionTitle = connection
    ? connection.name || providers.find((item) => item.id === connection.provider)?.name || connection.provider
    : null

  return (
    <Modal
      title={connection
        ? (
            <span className="flex items-center gap-2">
              <AiBrandIcon provider={connection.provider} className="h-6 w-6" />
              <span className="truncate">{connectionTitle}</span>
            </span>
          )
        : _('settings.aiAdd')}
      size={connection ? 'wide' : 'default'}
      onClose={onClose}
      footer={showForm ? (
        // Sticky bar: the form saves as a whole, while model changes save instantly.
        <div className="ml-auto flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={saving}>{_('library.cancel')}</Button>
          <Button type="submit" size="sm" form="ai-connection-form" disabled={saving || !name.trim()}>{_('library.save')}</Button>
        </div>
      ) : undefined}
    >
      {connection && !connection.mine ? (
        <AiModelsPanel connection={connection} models={models} />
      ) : (
        <>
          <form id="ai-connection-form" className={settingsFormClass} onSubmit={(event) => { event.preventDefault(); save() }}>
            <div className="flex flex-col gap-4 sm:flex-row sm:gap-3">
              <SettingsFormField label={_('settings.aiName')} required className="min-w-0 flex-1">
                <input required value={name} onChange={(event) => setName(event.target.value)} placeholder={_('settings.aiNamePlaceholder')} className={settingsInputClass} />
              </SettingsFormField>
              <SettingsFormField label={_('settings.aiProvider')} className="shrink-0 sm:w-44">
                <button
                  ref={providerBtnRef}
                  type="button"
                  onClick={(event) => toggleProviderMenu(event, 'below')}
                  aria-label={_('settings.aiProvider')}
                  aria-expanded={providerMenuOpen}
                  className="flex h-9 w-full items-center gap-2 rounded-lg border border-(--bd-field-border) bg-(--bd-field-bg) px-2 text-sm text-(--bd-field-text) outline-none transition-colors focus:border-(--bd-field-focus-border)"
                >
                  <AiBrandIcon provider={selectedProvider ?? provider} className="h-5 w-5" />
                  <span className="min-w-0 flex-1 truncate text-left">{selectedProvider?.name ?? provider}</span>
                  <svg className="shrink-0 text-stone-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                </button>
                {providerMenuOpen && (
                  <SmartMenu
                    triggerRef={providerBtnRef}
                    innerRef={providerMenuRef}
                    anchor={providerMenuAnchor}
                    size={{ width: 'auto', height: providers.length * 36 + 8 }}
                    minWidth={180}
                    maxWidth={260}
                    onClose={closeProviderMenu}
                  >
                    <AiProviderMenuItems providers={providers} onPick={(next) => { closeProviderMenu(); changeProvider(next) }} />
                  </SmartMenu>
                )}
              </SettingsFormField>
            </div>
            <SettingsFormField label={_('settings.aiBaseUrl')} required>
              <input aria-label={_('settings.aiBaseUrl')} readOnly={!isOwner} type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="http://localhost:11434" className={`${settingsInputClass} ${!isOwner ? 'cursor-default bg-stone-50 text-stone-500 dark:bg-stone-800/50' : ''}`} />
              {!isOwner && <p className="mt-1 text-[11px] text-stone-400 dark:text-stone-500">{_('settings.aiBaseUrlMemberHint')}</p>}
            </SettingsFormField>
            <SettingsFormField label={_('settings.aiApiKey')} required={apiKeyRequired}>
              <PasswordInput
                key={connection?.id ?? provider}
                aria-label={_('settings.aiApiKey')}
                secret
                disabled={saving}
                required={apiKeyRequired}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={savedKeyAvailable ? _('settings.aiKeyKeep') : _('settings.aiApiKeyPlaceholder')}
                autoComplete="new-password"
                className={settingsInputClass}
                action={savedKeyAvailable ? (
                  <button type="button" disabled={saving} onClick={clearApiKey} aria-label={_('settings.aiKeyClear')} title={_('settings.aiKeyClear')} className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-stone-800 dark:hover:text-red-400">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
                  </button>
                ) : undefined}
              />
            </SettingsFormField>
            {connection && isOwner && (
              <fieldset className="space-y-1.5">
                <legend className="text-xs text-stone-400 dark:text-stone-500">{_('settings.resourceScope')}</legend>
                <SegmentedControl
                  ariaLabel={_('settings.resourceScope')}
                  fullWidth
                  size="md"
                  pending={saving}
                  value={availability}
                  onChange={setAvailability}
                  options={(['user', 'instance'] as ResourceAvailability[]).map((value) => ({
                    value,
                    label: _(value === 'user' ? 'settings.resourceScopeUser' : 'settings.resourceScopeInstance'),
                  }))}
                />
              </fieldset>
            )}
          </form>
          {connection && (
            <div className="mt-4 border-t border-(--bd-divider) pt-4">
              <AiModelsPanel
                connection={connection}
                models={models}
                enabledDrafts={enabledDrafts}
                onToggleEnabled={(modelId, enabled) => setEnabledDrafts((drafts) => ({ ...drafts, [modelId]: enabled }))}
              />
            </div>
          )}
        </>
      )}
    </Modal>
  )
}
