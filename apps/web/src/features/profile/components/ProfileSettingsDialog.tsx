import { useEffect, useState } from 'react'

import { AUTH_REGISTER_USERNAME_MAX_LENGTH } from '@bookdock/shared'

import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import Toggle from '@/components/ui/Toggle'
import ChangePasswordDialog from '@/features/auth/ChangePasswordDialog'
import { authErrorKey } from '@/features/auth/errors'
import { useUpdateBio, useUpdateUsername } from '@/features/auth/hooks'
import { useProfileSettings, useUpdateProfileSettings } from '@/features/library/hooks'
import { useReaderProfile } from '@/features/reviews/hooks/useReviews'
import { useTranslation } from '@/hooks/useTranslation'
import { notify } from '@/lib/notifications'
import { useAuthStore } from '@/stores/auth.store'

interface ProfileSettingsDialogProps {
  open: boolean
  onClose: () => void
}

export default function ProfileSettingsDialog({ open, onClose }: ProfileSettingsDialogProps) {
  const _ = useTranslation()
  const user = useAuthStore((s) => s.user)
  const updateUsername = useUpdateUsername()
  const updateBio = useUpdateBio()
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)
  const [nameDraft, setNameDraft] = useState(user?.username ?? '')
  const [nameError, setNameError] = useState<string | null>(null)
  const [bioDraft, setBioDraft] = useState('')
  const profile = useProfileSettings()
  const reader = useReaderProfile(user?.id)
  const updateProfile = useUpdateProfileSettings()
  const showStats = profile.showPublicStats ?? profile.showStats !== false
  const showShowcase = profile.showPublicShowcase ?? profile.showShowcase !== false
  const isPublic = profile.isPublic !== false
  const savedBio = reader.data?.data.author.bio ?? ''
  const normalizedName = nameDraft.trim()
  const normalizedBio = bioDraft.trim()
  const hasProfileChanges = normalizedName !== (user?.username ?? '') || normalizedBio !== savedBio
  const isSavingProfile = updateUsername.isPending || updateBio.isPending

  useEffect(() => {
    if (open) {
      setNameDraft(user?.username ?? '')
      setNameError(null)
      setBioDraft(savedBio)
    }
  }, [open, user?.username, savedBio])

  async function onSaveProfile() {
    setNameError(null)
    if (!normalizedName) {
      setNameError(_('auth.errors.usernameRequired'))
      return
    }
    if (normalizedName.length > AUTH_REGISTER_USERNAME_MAX_LENGTH) {
      setNameError(_('auth.errors.registerUsernameTooLong'))
      return
    }

    try {
      if (normalizedName !== user?.username) {
        await updateUsername.mutateAsync({ username: normalizedName })
      }
    } catch (err) {
      setNameError(_(authErrorKey(err)))
      return
    }

    try {
      if (normalizedBio !== savedBio) {
        await updateBio.mutateAsync({ bio: normalizedBio })
      }
      notify.success({ key: 'settings.profileUpdated' })
    } catch {
      notify.error({ key: 'settings.profileUpdateFailed' })
    }
  }

  if (!open) return null

  return (
    <>
      <Modal title={_('profile.settingsTitle')} onClose={onClose} size="default">
        <div className="flex flex-col gap-6 py-1">
          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
              {_('profile.sectionProfile')}
            </h3>
            <div className="flex flex-col gap-3.5 rounded-xl border border-stone-200/80 bg-stone-50/50 p-3.5 dark:border-stone-800 dark:bg-stone-900/40">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="profile-settings-username" className="text-xs font-medium text-stone-600 dark:text-stone-300">
                  {_('auth.username')}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="profile-settings-username"
                    value={nameDraft}
                    onChange={(e) => {
                      setNameDraft(e.target.value)
                      setNameError(null)
                    }}
                    maxLength={AUTH_REGISTER_USERNAME_MAX_LENGTH}
                    className="h-8 flex-1 rounded-lg border border-stone-200 bg-white px-3 text-sm outline-none focus:border-stone-400 dark:border-stone-700 dark:bg-stone-900"
                    placeholder={_('auth.username')}
                  />
                </div>
                {nameError && <p className="text-xs text-red-600">{nameError}</p>}
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="profile-settings-bio" className="text-xs font-medium text-stone-600 dark:text-stone-300">{_('profile.bio')}</label>
                </div>
                <div className="relative">
                  <textarea
                    id="profile-settings-bio"
                    value={bioDraft}
                    onChange={(event) => setBioDraft(event.target.value)}
                    maxLength={500}
                    rows={4}
                    className="min-h-24 w-full resize-y rounded-lg border border-stone-200 bg-white px-3 py-2 pr-16 pb-7 text-sm outline-none focus:border-stone-400 dark:border-stone-700 dark:bg-stone-900"
                    placeholder={_('profile.bioPlaceholder')}
                  />
                  <span className="pointer-events-none absolute bottom-2 right-3 text-xs tabular-nums text-stone-400 dark:text-stone-500">
                    {_('profile.bioCount', { count: bioDraft.length })}
                  </span>
                </div>
              </div>
              <div className="flex justify-end">
                <Button size="sm" variant="primary" disabled={isSavingProfile || !hasProfileChanges} onClick={() => void onSaveProfile()}>
                  {_('profile.saveProfile')}
                </Button>
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
              {_('profile.sectionPrivacy')}
            </h3>
            <div className="rounded-xl border border-stone-200/80 bg-stone-50/50 p-3.5 dark:border-stone-800 dark:bg-stone-900/40">
              <div className="flex items-center justify-between gap-4 border-b border-stone-200/70 pb-3 dark:border-stone-800/70">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-stone-900 dark:text-stone-100">
                    {_('profile.settingPublicProfile')}
                  </span>
                  <span className="text-xs text-stone-500 dark:text-stone-400">
                    {_('profile.settingPublicProfileHint')}
                  </span>
                </div>
                <Toggle checked={isPublic} disabled={updateProfile.isPending} onChange={(v) => updateProfile.mutate({ isPublic: v })} ariaLabel={_('profile.settingPublicProfile')} />
              </div>
              <div className="flex flex-col divide-y divide-stone-100 dark:divide-stone-800/60">
                <div className="flex items-center justify-between gap-4 py-3">
                  <span className={isPublic ? 'text-sm text-stone-700 dark:text-stone-200' : 'text-sm text-stone-400 dark:text-stone-500'}>{_('profile.settingShowStats')}</span>
                  <Toggle checked={showStats} disabled={!isPublic || updateProfile.isPending} onChange={(v) => updateProfile.mutate({ showPublicStats: v })} ariaLabel={_('profile.settingShowStats')} />
                </div>
                <div className="flex items-center justify-between gap-4 pt-3">
                  <span className={isPublic ? 'text-sm text-stone-700 dark:text-stone-200' : 'text-sm text-stone-400 dark:text-stone-500'}>{_('profile.settingShowShowcase')}</span>
                  <Toggle checked={showShowcase} disabled={!isPublic || updateProfile.isPending} onChange={(v) => updateProfile.mutate({ showPublicShowcase: v })} ariaLabel={_('profile.settingShowShowcase')} />
                </div>
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
              {_('profile.sectionSecurity')}
            </h3>
            <div className="flex items-center justify-between gap-4 rounded-xl border border-stone-200/80 bg-stone-50/50 p-3.5 dark:border-stone-800 dark:bg-stone-900/40">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-stone-900 dark:text-stone-100">
                  {_('profile.passwordTitle')}
                </span>
                <span className="text-xs text-stone-500 dark:text-stone-400">
                  {_('profile.securityHint')}
                </span>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setChangePasswordOpen(true)}
              >
                {_('auth.changePassword')}
              </Button>
            </div>
          </section>
        </div>
      </Modal>

      <ChangePasswordDialog open={changePasswordOpen} onClose={() => setChangePasswordOpen(false)} />
    </>
  )
}
