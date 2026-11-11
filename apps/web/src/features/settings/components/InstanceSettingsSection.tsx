import { REGISTRATION_MODES, type RegistrationMode } from '@bookdock/shared'

import QueryErrorState from '@/components/ui/QueryErrorState'
import SegmentedControl from '@/components/ui/SegmentedControl'
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
        <SegmentedControl
          role="radiogroup"
          ariaLabel={_('admin.registrationMode')}
          value={registrationMode}
          pending={updateInstance.isPending}
          onChange={setRegistrationMode}
          options={REGISTRATION_MODES.map((mode) => ({ value: mode, label: modeLabels[mode] }))}
        />
      </div>
      <ToggleRow
        label={_('admin.allowGuestAccess')}
        hint={_('admin.allowGuestAccessHint')}
        checked={instance.allowGuestAccess}
        pending={updateInstance.isPending}
        onChange={(v) => toggle('allowGuestAccess', v)}
      />
      <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p id="member-permissions-label" className="text-sm font-medium text-stone-700 dark:text-stone-200">{_('admin.memberPermissions')}</p>
          <p id="member-permissions-hint" className="mt-0.5 text-xs text-stone-400 dark:text-stone-500">{_('admin.memberPermissionsHint')}</p>
        </div>
        <div role="group" aria-labelledby="member-permissions-label" aria-describedby="member-permissions-hint" aria-busy={updateInstance.isPending} className="inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-stone-100 p-0.5 dark:bg-stone-800">
          {([
            ['allowUserUpload', 'admin.memberPermissionUpload'],
            ['allowUserCreateLibrary', 'admin.memberPermissionCreateLibrary'],
          ] as const).map(([key, label]) => {
            const checked = instance[key] !== false
            return (
              <button
                key={key}
                type="button"
                role="checkbox"
                aria-checked={checked}
                disabled={updateInstance.isPending}
                onClick={() => toggle(key, !checked)}
                className={cn(
                  'flex h-7 items-center justify-center rounded-md px-2.5 text-xs font-medium transition-all select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 disabled:cursor-not-allowed',
                  checked
                    ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-stone-100'
                    : 'text-stone-400 hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-300',
                )}
              >
                {_(label)}
              </button>
            )
          })}
        </div>
      </div>
    </SettingsCard>
  )
}

function ToggleRow({ label, hint, checked, pending, onChange }: {
  label: string
  hint: string
  checked: boolean
  pending?: boolean
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
        disabled={pending}
        aria-busy={pending}
        onClick={() => onChange(!checked)}
        className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed', checked ? 'bg-stone-900 dark:bg-stone-100' : 'bg-stone-300 dark:bg-stone-700')}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform dark:bg-stone-900 ${checked ? 'translate-x-5' : ''}`}
        />
      </button>
    </div>
  )
}
