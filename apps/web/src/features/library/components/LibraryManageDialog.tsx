import { useEffect, useState } from 'react'

import type { Library, LibraryVisibility } from '@bookdock/shared'

import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { cn } from '@/lib/utils'

import {
  useUpdateLibrary,
} from '../hooks'
import LibraryInvitePanel from './LibraryInvitePanel'

interface LibraryManageDialogProps {
  library: Library
  isOwner: boolean
  onClose: () => void
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function KeyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="m21 2-9.6 9.6" />
      <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" />
    </svg>
  )
}

function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  )
}

/**
 * 0.4.0: library management. Settings are owner-only (updateLibrary rejects
 * managers); admins get a management dialog that explains that instead of a
 * save button that could never succeed. Deletion stays behind an explicit
 * confirmation that names the consequence - deleting a library leaves
 * members' collected copies in place but unreadable, and that must never
 * happen by surprise.
 */
export default function LibraryManageDialog({ library, isOwner, onClose }: LibraryManageDialogProps) {
  const _ = useTranslation()
  const [name, setName] = useState(library.name)
  const [description, setDescription] = useState(library.description)
  const [visibility, setVisibility] = useState<LibraryVisibility>(library.visibility ?? 'private')
  const [password, setPassword] = useState(library.accessPassword ?? '')

  const updateLibrary = useUpdateLibrary()

  // Settings are edited from the library we were handed; keep them in sync when
  // another surface (another tab) changed it.
  useEffect(() => {
    setName(library.name)
    setDescription(library.description)
    setVisibility(library.visibility ?? 'private')
    setPassword(library.accessPassword ?? '')
  }, [library])

  const passwordChanged = visibility === 'password' && password.trim() !== (library.accessPassword ?? '')
  const settingsChanged = name.trim() !== library.name
    || description !== library.description
    || visibility !== (library.visibility ?? 'private')
    || passwordChanged

  const isPasswordValid = visibility !== 'password' || password.trim().length >= 4
  const canSave = settingsChanged && name.trim().length > 0 && isPasswordValid && !updateLibrary.isPending

  function reportError(err: unknown, fallback: string) {
    notify.error(getUserErrorNotification(err, fallback))
  }

  function handleSave() {
    if (!canSave) return
    updateLibrary.mutate({
      libraryId: library.id,
      patch: {
        name: name.trim(),
        description,
        visibility,
        ...(visibility === 'password' ? { accessPassword: password.trim() } : {}),
      },
    }, {
      onSuccess: () => {
        notify.success(_('library.librarySettingsSaved'))
      },
      onError: (err) => reportError(err, 'library.librarySettingsSaveFailed'),
    })
  }

  const visibilityOptions: Array<{
    value: LibraryVisibility
    icon: typeof LockIcon
    label: string
    hint: string
  }> = [
    {
      value: 'public',
      icon: GlobeIcon,
      label: _('library.visibilityPublic'),
      hint: _('library.visibilityHintPublic'),
    },
    {
      value: 'password',
      icon: KeyIcon,
      label: _('library.visibilityPassword'),
      hint: _('library.visibilityHintPassword'),
    },
    {
      value: 'private',
      icon: LockIcon,
      label: _('library.visibilityPrivate'),
      hint: _('library.visibilityHintPrivate'),
    },
  ]

  return (
    <>
      <Modal
        title={`${_('library.manageLibrary')}「${library.name}」`}
        onClose={onClose}
        closeLabel={_('library.close')}
        footer={
          <div className="flex w-full items-center justify-end gap-2.5">
            <Button variant="secondary" onClick={onClose}>
              {_('library.cancel')}
            </Button>
            {isOwner && (
              <Button
                disabled={!canSave}
                onClick={handleSave}
              >
                {_('library.save')}
              </Button>
            )}
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          {/* Library settings are owner-only (the backend rejects managers
              with FORBIDDEN): admins see why the form is absent instead of a
              save button that can never succeed. */}
          {isOwner ? (
            <>
              <label className="flex flex-col gap-1.5 text-sm text-stone-700 dark:text-stone-300">
                <span className="font-medium text-xs text-stone-600 dark:text-stone-300">{_('library.libraryName')}</span>
                <input
                  aria-label={_('library.libraryName')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={64}
                  className="rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm text-stone-800 outline-none transition-all placeholder:text-stone-400 focus:border-stone-900 focus:ring-1 focus:ring-stone-900 dark:border-stone-700 dark:bg-stone-900/80 dark:text-stone-100 dark:focus:border-stone-200 dark:focus:ring-stone-200"
                />
              </label>

              <label className="flex flex-col gap-1.5 text-sm text-stone-700 dark:text-stone-300">
                <span className="font-medium text-xs text-stone-600 dark:text-stone-300">{_('library.libraryDescription')}</span>
                <textarea
                  aria-label={_('library.libraryDescription')}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={2000}
                  rows={3}
                  className="resize-y rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm text-stone-800 outline-none transition-all placeholder:text-stone-400 focus:border-stone-900 focus:ring-1 focus:ring-stone-900 dark:border-stone-700 dark:bg-stone-900/80 dark:text-stone-100 dark:focus:border-stone-200 dark:focus:ring-stone-200"
                />
              </label>

              <div className="flex flex-col gap-2 text-sm text-stone-700 dark:text-stone-300">
                <span className="font-medium text-xs text-stone-600 dark:text-stone-300">{_('library.libraryVisibility')}</span>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  {visibilityOptions.map((opt) => {
                    const Icon = opt.icon
                    const selected = visibility === opt.value
                    return (
                      <label
                        key={opt.value}
                        className={cn(
                          'group relative flex cursor-pointer flex-col justify-between rounded-xl border p-3.5 transition-all select-none',
                          selected
                            ? 'border-stone-900 bg-stone-50/70 shadow-xs ring-1 ring-stone-900 dark:border-stone-100 dark:bg-stone-800/60 dark:ring-stone-100'
                            : 'border-stone-200 bg-white hover:border-stone-300 hover:bg-stone-50/30 dark:border-stone-700/80 dark:bg-stone-900/60 dark:hover:border-stone-600',
                        )}
                      >
                        <input
                          type="radio"
                          name="manage-library-visibility"
                          value={opt.value}
                          checked={selected}
                          onChange={() => setVisibility(opt.value)}
                          aria-label={opt.label}
                          className="sr-only"
                        />
                        <div>
                          <div className="flex items-center justify-between">
                            <div className={cn(
                              'flex h-7 w-7 items-center justify-center rounded-lg transition-colors',
                              selected
                                ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                                : 'bg-stone-100 text-stone-500 group-hover:text-stone-700 dark:bg-stone-800 dark:text-stone-400',
                            )}>
                              <Icon className="h-4 w-4" />
                            </div>
                            <div className={cn(
                              'h-4 w-4 rounded-full border flex items-center justify-center transition-colors',
                              selected
                                ? 'border-stone-900 bg-stone-900 dark:border-stone-100 dark:bg-stone-100'
                                : 'border-stone-300 dark:border-stone-600',
                            )}>
                              {selected && <div className="h-1.5 w-1.5 rounded-full bg-white dark:bg-stone-900" />}
                            </div>
                          </div>
                          <span className="mt-2.5 block text-sm font-semibold text-stone-900 dark:text-stone-100">
                            {opt.label}
                          </span>
                        </div>
                        <span className="mt-1 block text-xs leading-relaxed text-stone-400 dark:text-stone-400">
                          {opt.hint}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>

              {visibility === 'password' && (
                <div className="rounded-xl border border-stone-200/80 bg-stone-50/50 p-3.5 dark:border-stone-800 dark:bg-stone-800/40">
                  <label className="flex flex-col gap-1.5 text-sm text-stone-700 dark:text-stone-300">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-xs text-stone-600 dark:text-stone-300">{_('library.libraryAccessPassword')}</span>
                      {password.trim().length > 0 && password.trim().length < 4 && (
                        <span className="text-xs font-medium text-red-500">
                          {_('library.libraryAccessPasswordMinHint')}
                        </span>
                      )}
                    </div>
                    <input
                      type="text"
                      aria-label={_('library.libraryAccessPassword')}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={_('library.libraryAccessPasswordPlaceholder')}
                      autoComplete="off"
                      className="font-mono tracking-wider rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none transition-all placeholder:text-stone-400 focus:border-stone-900 focus:ring-1 focus:ring-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:focus:border-stone-200 dark:focus:ring-stone-200"
                    />
                  </label>
                </div>
              )}
            </>
          ) : (
            <p className="rounded-xl border border-stone-200/80 bg-stone-50/50 p-4 text-sm text-stone-500 dark:border-stone-800 dark:bg-stone-800/30 dark:text-stone-400">
              {_('library.settingsOwnerOnly')}
            </p>
          )}
          {library.visibility === 'private' && <LibraryInvitePanel key={library.id} libraryId={library.id} />}
        </div>
      </Modal>

    </>
  )
}
