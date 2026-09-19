import { useEffect, useState } from 'react'

import { AUTH_REGISTER_USERNAME_MAX_LENGTH } from '@bookdock/shared'

import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import Toggle from '@/components/ui/Toggle'
import ChangePasswordDialog from '@/features/auth/ChangePasswordDialog'
import { authErrorKey } from '@/features/auth/errors'
import { useUpdateUsername } from '@/features/auth/hooks'
import { useTranslation } from '@/hooks/useTranslation'
import { notify } from '@/lib/notifications'
import { useAuthStore } from '@/stores/auth.store'
import { useProfilePrefs } from '../profile-prefs'

interface ProfileSettingsDialogProps {
  open: boolean
  onClose: () => void
}

export default function ProfileSettingsDialog({ open, onClose }: ProfileSettingsDialogProps) {
  const _ = useTranslation()
  const user = useAuthStore((s) => s.user)
  const updateUsername = useUpdateUsername()
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)
  const [nameDraft, setNameDraft] = useState(user?.username ?? '')
  const [nameError, setNameError] = useState<string | null>(null)
  const { showStats, showShowcase, isPublic, setShowStats, setShowShowcase, setIsPublic } = useProfilePrefs()

  useEffect(() => {
    if (open) {
      setNameDraft(user?.username ?? '')
      setNameError(null)
    }
  }, [open, user?.username])

  async function onSaveUsername() {
    const username = nameDraft.trim()
    setNameError(null)
    if (!username) {
      setNameError(_('auth.errors.usernameRequired'))
      return
    }
    if (username.length > AUTH_REGISTER_USERNAME_MAX_LENGTH) {
      setNameError(_('auth.errors.registerUsernameTooLong'))
      return
    }
    try {
      await updateUsername.mutateAsync({ username })
      notify.success({ key: 'settings.usernameUpdated' })
    } catch (err) {
      setNameError(_(authErrorKey(err)))
    }
  }

  if (!open) return null

  return (
    <>
      <Modal title={_('profile.settingsTitle')} onClose={onClose} size="default">
        <div className="flex flex-col gap-6 py-1">
          {/* Section 1: Profile Information */}
          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
              {_('profile.sectionProfile')}
            </h3>
            <div className="flex flex-col gap-2 rounded-xl border border-stone-200/80 bg-stone-50/50 p-3.5 dark:border-stone-800 dark:bg-stone-900/40">
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
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={updateUsername.isPending || !nameDraft.trim() || nameDraft.trim() === user?.username}
                    onClick={() => void onSaveUsername()}
                  >
                    {_('library.save')}
                  </Button>
                </div>
                {nameError && <p className="text-xs text-red-600">{nameError}</p>}
                <p className="text-xs text-stone-400 dark:text-stone-500">
                  {_('profile.usernameHint')}
                </p>
              </div>
            </div>
          </section>

          {/* Section 2: Display Modules */}
          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
              {_('profile.sectionModules')}
            </h3>
            <div className="flex flex-col divide-y divide-stone-100 rounded-xl border border-stone-200/80 bg-stone-50/50 p-3.5 dark:divide-stone-800/60 dark:border-stone-800 dark:bg-stone-900/40">
              <div className="flex items-center justify-between gap-4 pb-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-stone-900 dark:text-stone-100">
                    {_('profile.settingShowStats')}
                  </span>
                  <span className="text-xs text-stone-500 dark:text-stone-400">
                    {_('profile.settingShowStatsHint')}
                  </span>
                </div>
                <Toggle checked={showStats} onChange={setShowStats} ariaLabel={_('profile.settingShowStats')} />
              </div>

              <div className="flex items-center justify-between gap-4 pt-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-stone-900 dark:text-stone-100">
                    {_('profile.settingShowShowcase')}
                  </span>
                  <span className="text-xs text-stone-500 dark:text-stone-400">
                    {_('profile.settingShowShowcaseHint')}
                  </span>
                </div>
                <Toggle checked={showShowcase} onChange={setShowShowcase} ariaLabel={_('profile.settingShowShowcase')} />
              </div>
            </div>
          </section>

          {/* Section 3: Privacy & Visibility */}
          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
              {_('profile.sectionPrivacy')}
            </h3>
            <div className="flex items-center justify-between gap-4 rounded-xl border border-stone-200/80 bg-stone-50/50 p-3.5 dark:border-stone-800 dark:bg-stone-900/40">
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-stone-900 dark:text-stone-100">
                    {_('profile.settingPublicProfile')}
                  </span>
                </div>
                <span className="text-xs text-stone-500 dark:text-stone-400">
                  {_('profile.settingPublicProfileHint')}
                </span>
              </div>
              <Toggle checked={isPublic} onChange={setIsPublic} ariaLabel={_('profile.settingPublicProfile')} />
            </div>
          </section>

          {/* Section 4: Account & Security */}
          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
              {_('profile.sectionSecurity')}
            </h3>
            <div className="flex items-center justify-between gap-4 rounded-xl border border-stone-200/80 bg-stone-50/50 p-3.5 dark:border-stone-800 dark:bg-stone-900/40">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-stone-900 dark:text-stone-100">
                  {_('auth.changePassword')}
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
