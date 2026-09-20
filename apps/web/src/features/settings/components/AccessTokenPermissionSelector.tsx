import type { AccessTokenPermission } from '@bookdock/shared'
import { ACCESS_TOKEN_PERMISSION_REGISTRY } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'
import { ACCESS_TOKEN_PERMISSION_LABEL_KEYS } from './access-token-permissions'

interface AccessTokenPermissionSelectorProps {
  value: AccessTokenPermission[]
  onChange: (next: AccessTokenPermission[]) => void
}

export default function AccessTokenPermissionSelector({ value, onChange }: AccessTokenPermissionSelectorProps) {
  const _ = useTranslation()
  const totalCount = ACCESS_TOKEN_PERMISSION_REGISTRY.length
  const selectedCount = value.length
  const allSelected = selectedCount === totalCount && totalCount > 0

  function handleToggleAll() {
    if (allSelected) {
      onChange([])
    } else {
      onChange(ACCESS_TOKEN_PERMISSION_REGISTRY.map((item) => item.id))
    }
  }

  function togglePermission(id: AccessTokenPermission) {
    if (value.includes(id)) {
      onChange(value.filter((item) => item !== id))
    } else {
      onChange([...value, id])
    }
  }

  return (
    <fieldset className="block">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <legend className="text-xs font-medium text-stone-600 dark:text-stone-300">
            {_('settings.tokensPermissions')}
          </legend>
          <span className="rounded-full bg-stone-100 px-2 py-0.2 font-mono text-[11px] font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-400">
            {selectedCount}
          </span>
        </div>

        {/* Single Icon to Toggle All / Clear All */}
        <button
          type="button"
          onClick={handleToggleAll}
          aria-label={allSelected ? _('settings.tokensClearAll') : _('settings.tokensSelectAll')}
          title={allSelected ? _('settings.tokensClearAll') : _('settings.tokensSelectAll')}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
        >
          {allSelected ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-stone-800 dark:text-stone-200" aria-hidden="true">
              <polyline points="9 11 12 14 22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
              <rect width="18" height="18" x="3" y="3" rx="2" />
            </svg>
          )}
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        {ACCESS_TOKEN_PERMISSION_REGISTRY.map((entry) => {
          const isChecked = value.includes(entry.id)
          const labelKey = ACCESS_TOKEN_PERMISSION_LABEL_KEYS[entry.id] ?? entry.id
          const methods = Array.from(new Set(entry.endpoints.map((ep) => ep.split(' ')[0]).filter(Boolean)))

          return (
            <label
              key={entry.id}
              className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-2.5 transition-all select-none ${
                isChecked
                  ? 'border-stone-400/80 bg-white shadow-2xs dark:border-stone-600 dark:bg-stone-800'
                  : 'border-stone-200/70 bg-stone-50/40 hover:bg-stone-100/60 dark:border-stone-800/80 dark:bg-stone-850/30 dark:hover:bg-stone-800/50'
              }`}
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => togglePermission(entry.id)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-stone-300 accent-stone-900 dark:border-stone-700 dark:accent-stone-100"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-medium text-stone-800 dark:text-stone-200">
                    {_(labelKey)}
                  </span>
                  {methods.map((method) => (
                    <span
                      key={method}
                      className={`rounded px-1 py-0.2 font-mono text-[9px] font-semibold uppercase ${
                        method === 'GET' || method === 'HEAD'
                          ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400'
                          : 'bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400'
                      }`}
                    >
                      {method}
                    </span>
                  ))}
                </div>
                <span className="mt-0.5 block font-mono text-[10px] text-stone-400 dark:text-stone-500">
                  {entry.endpoints.join(' · ')}
                </span>
              </div>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
