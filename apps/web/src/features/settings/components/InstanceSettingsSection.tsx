import { useTranslation } from '@/hooks/useTranslation'
import { useToastStore } from '@/stores/toast.store'
import { useInstanceInfo, useUpdateInstance } from '@/features/auth/hooks'

export default function InstanceSettingsSection() {
  const _ = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const { data: instanceData } = useInstanceInfo()
  const updateInstance = useUpdateInstance()

  const instance = instanceData?.data
  if (!instance) return null

  function toggle(key: 'allowRegistration' | 'allowGuestAccess', value: boolean) {
    updateInstance.mutate(
      { [key]: value },
      { onError: () => addToast(_('auth.errors.generic'), 'error') },
    )
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <h2 className="mb-4 text-sm font-medium">{_('admin.instanceSettings')}</h2>
      <ToggleRow
        label={_('admin.allowRegistration')}
        hint={_('admin.allowRegistrationHint')}
        checked={instance.allowRegistration}
        onChange={(v) => toggle('allowRegistration', v)}
      />
      <ToggleRow
        label={_('admin.allowGuestAccess')}
        hint={_('admin.allowGuestAccessHint')}
        checked={instance.allowGuestAccess}
        onChange={(v) => toggle('allowGuestAccess', v)}
      />
    </section>
  )
}

function ToggleRow({ label, hint, checked, onChange }: {
  label: string
  hint: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="text-sm text-stone-700 dark:text-stone-200">{label}</p>
        <p className="mt-0.5 text-xs text-stone-500">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-stone-900 dark:bg-stone-100' : 'bg-stone-300 dark:bg-stone-700'}`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform dark:bg-stone-900 ${checked ? 'translate-x-5' : ''}`}
        />
      </button>
    </div>
  )
}
