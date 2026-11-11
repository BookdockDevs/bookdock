import { REGISTRATION_MODES, type RegistrationMode } from '@bookdock/shared'

import QueryErrorState from '@/components/ui/QueryErrorState'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { cn } from '@/lib/utils'
import { useInstanceInfo, useUpdateInstance } from '@/features/auth/hooks'
import SettingsCard from './SettingsCard'

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
    </svg>
  )
}

export default function InstanceSettingsSection() {
  const _ = useTranslation()
  const instanceQuery = useInstanceInfo()
  const updateInstance = useUpdateInstance()

  const instance = instanceQuery.data?.data
  if (instanceQuery.isError) {
    return (
      <SettingsCard
        icon={<ShieldIcon className="h-5 w-5" />}
        iconBgClass="bg-slate-500/10 text-slate-600 dark:bg-slate-500/20 dark:text-slate-400"
        title={_('admin.instanceSettings')}
      >
        <QueryErrorState className="py-4" isRetrying={instanceQuery.isFetching} onRetry={instanceQuery.refetch} />
      </SettingsCard>
    )
  }
  if (!instance) return null

  const registrationMode: RegistrationMode = instance.registrationMode ?? (instance.allowRegistration ? 'open' : 'closed')

  function toggle(key: 'allowGuestAccess' | 'allowUserCreateLibrary' | 'allowUserUpload', value: boolean) {
    updateInstance.mutate(
      { [key]: value },
      { onError: (error) => notify.error(getUserErrorNotification(error, 'settings.instanceSettingsUpdateFailed')) },
    )
  }

  function setRegistrationMode(mode: RegistrationMode) {
    if (mode === registrationMode) return
    updateInstance.mutate(
      { registrationMode: mode },
      { onError: (error) => notify.error(getUserErrorNotification(error, 'settings.instanceSettingsUpdateFailed')) },
    )
  }

  const modeLabels: Record<RegistrationMode, string> = {
    closed: _('admin.registrationModeClosed'),
    invite: _('admin.registrationModeInvite'),
    open: _('admin.registrationModeOpen'),
  }
  const modeHints: Record<RegistrationMode, string> = {
    closed: _('admin.registrationModeClosedHint'),
    invite: _('admin.registrationModeInviteHint'),
    open: _('admin.registrationModeOpenHint'),
  }

  return (
    <SettingsCard
      icon={<ShieldIcon className="h-5 w-5" />}
      iconBgClass="bg-slate-500/10 text-slate-600 dark:bg-slate-500/20 dark:text-slate-400"
      title={_('admin.instanceSettings')}
      bodyClassName="divide-y divide-stone-100 dark:divide-stone-800/80"
    >
      <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-stone-700 dark:text-stone-200">{_('admin.registrationMode')}</p>
          <p className="mt-0.5 text-xs text-stone-400 dark:text-stone-500">{modeHints[registrationMode]}</p>
        </div>
        <div
          role="radiogroup"
          aria-label={_('admin.registrationMode')}
          className="inline-flex shrink-0 rounded-xl border border-stone-200 bg-stone-50 p-0.5 dark:border-stone-700 dark:bg-stone-800/60"
        >
          {REGISTRATION_MODES.map((mode) => {
            const active = registrationMode === mode
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={updateInstance.isPending}
                onClick={() => setRegistrationMode(mode)}
                className={cn(
                  'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50',
                  active
                    ? 'bg-white text-stone-900 shadow-xs dark:bg-stone-700 dark:text-stone-100'
                    : 'text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200',
                )}
              >
                {modeLabels[mode]}
              </button>
            )
          })}
        </div>
      </div>
      <ToggleRow
        label={_('admin.allowGuestAccess')}
        hint={_('admin.allowGuestAccessHint')}
        checked={instance.allowGuestAccess}
        disabled={updateInstance.isPending}
        onChange={(v) => toggle('allowGuestAccess', v)}
      />
      <ToggleRow
        label={_('admin.allowUserCreateLibrary')}
        hint={_('admin.allowUserCreateLibraryHint')}
        checked={instance.allowUserCreateLibrary !== false}
        disabled={updateInstance.isPending}
        onChange={(v) => toggle('allowUserCreateLibrary', v)}
      />
      <ToggleRow
        label={_('admin.allowUserUpload')}
        hint={_('admin.allowUserUploadHint')}
        checked={instance.allowUserUpload !== false}
        disabled={updateInstance.isPending}
        onChange={(v) => toggle('allowUserUpload', v)}
      />
    </SettingsCard>
  )
}

function ToggleRow({ label, hint, checked, disabled, onChange }: {
  label: string
  hint: string
  checked: boolean
  disabled?: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-stone-700 dark:text-stone-200">{label}</p>
        <p className="mt-0.5 text-xs text-stone-400 dark:text-stone-500">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${checked ? 'bg-stone-900 dark:bg-stone-100' : 'bg-stone-300 dark:bg-stone-700'}`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform dark:bg-stone-900 ${checked ? 'translate-x-5' : ''}`}
        />
      </button>
    </div>
  )
}
