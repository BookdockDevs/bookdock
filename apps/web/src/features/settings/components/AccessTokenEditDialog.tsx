import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import { ACCESS_TOKEN_DURATIONS, ACCESS_TOKEN_NAME_MAX_LENGTH } from '@bookdock/shared'
import type { AccessToken, AccessTokenDuration, AccessTokenPermission, AccessTokenUpdateReq } from '@bookdock/shared'

import { apiPatch } from '@/api/client'
import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { cn } from '@/lib/utils'

import AccessTokenPermissionSelector from './AccessTokenPermissionSelector'

interface AccessTokenEditDialogProps {
  token: AccessToken
  onClose: () => void
  onUpdated: (token: AccessToken) => void
}

const DURATION_LABEL_KEYS: Record<AccessTokenDuration, string> = {
  '90d': 'settings.tokensExpiry90d',
  '1y': 'settings.tokensExpiry1y',
  permanent: 'settings.tokensExpiryPermanent',
}

export default function AccessTokenEditDialog({ token, onClose, onUpdated }: AccessTokenEditDialogProps) {
  const _ = useTranslation()
  const [name, setName] = useState(token.name)
  const [permissions, setPermissions] = useState<AccessTokenPermission[]>(token.permissions)
  const [expiresIn, setExpiresIn] = useState<AccessTokenDuration | ''>('')

  const mutation = useMutation({
    mutationFn: () => {
      const body: AccessTokenUpdateReq = {
        name: name.trim(),
        permissions,
        ...(expiresIn ? { expiresIn } : {}),
      }
      return apiPatch<{ data: AccessToken }>(`/tokens/${token.id}`, body)
    },
    onSuccess: (result) => {
      notify.success({ key: 'settings.tokensUpdated' })
      onUpdated(result.data)
    },
    onError: (error) => notify.error(getUserErrorNotification(error, 'settings.tokensUpdateFailed')),
  })

  return (
    <Modal title={_('settings.tokensEditTitle')} onClose={onClose} size="default">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          mutation.mutate()
        }}
      >
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-stone-600 dark:text-stone-300">
            {_('settings.tokensName')}
          </span>
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={ACCESS_TOKEN_NAME_MAX_LENGTH}
            placeholder={_('settings.tokensNamePlaceholder')}
            className="h-9 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm text-stone-800 outline-none transition-colors focus:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:focus:border-stone-500"
          />
        </label>

        <AccessTokenPermissionSelector value={permissions} onChange={setPermissions} />

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-stone-600 dark:text-stone-300">
            {_('settings.tokensEditExpiry')}
          </span>
          <div className="inline-flex w-fit flex-wrap items-center gap-0.5 rounded-lg bg-stone-100 p-0.5 dark:bg-stone-800" role="group">
            <button
              type="button"
              onClick={() => setExpiresIn('')}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                expiresIn === ''
                  ? 'bg-white text-stone-900 shadow-2xs dark:bg-stone-700 dark:text-stone-100'
                  : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200',
              )}
            >
              {_('settings.tokensEditExpiryKeep')}
            </button>
            {ACCESS_TOKEN_DURATIONS.map((duration) => (
              <button
                key={duration}
                type="button"
                onClick={() => setExpiresIn(duration)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  expiresIn === duration
                    ? 'bg-white text-stone-900 shadow-2xs dark:bg-stone-700 dark:text-stone-100'
                    : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200',
                )}
              >
                {_(DURATION_LABEL_KEYS[duration])}
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            {_('library.cancel')}
          </Button>
          <Button type="submit" size="sm" disabled={mutation.isPending}>
            {_('settings.tokensEditSubmit')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
