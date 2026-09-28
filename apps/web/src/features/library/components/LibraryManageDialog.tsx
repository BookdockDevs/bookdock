import { useEffect, useState } from 'react'

import type { Library, LibraryVisibility } from '@bookdock/shared'

import { Button } from '@/components/ui/Button'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Modal from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { cn } from '@/lib/utils'

import {
  useDeleteLibrary,
  useUpdateLibrary,
} from '../hooks'

interface LibraryManageDialogProps {
  library: Library
  /** True for owners and admins, who may edit settings and the roster. */
  canManage: boolean
  isOwner: boolean
  onClose: () => void
  onDeleted: () => void
}

type Danger = 'delete' | null

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
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
 * 0.4.0: library management. Settings and membership for owners and admins,
 * plus the two irreversible actions behind an explicit confirmation that names
 * the consequence - deleting a library leaves members' collected copies in place
 * but unreadable, and that must never happen by surprise.
 */
export default function LibraryManageDialog({ library, canManage, isOwner, onClose, onDeleted }: LibraryManageDialogProps) {
  const _ = useTranslation()
  const [name, setName] = useState(library.name)
  const [description, setDescription] = useState(library.description)
  const [visibility, setVisibility] = useState<LibraryVisibility>(library.visibility ?? 'private')
  const [password, setPassword] = useState('')
  const [danger, setDanger] = useState<Danger>(null)

  const updateLibrary = useUpdateLibrary()
  const deleteLibrary = useDeleteLibrary()

  // Settings are edited from the library we were handed; keep them in sync when
  // another surface (another tab) changed it.
  useEffect(() => {
    setName(library.name)
    setDescription(library.description)
    setVisibility(library.visibility ?? 'private')
  }, [library])

  const settingsChanged = name !== library.name
    || description !== library.description
    || visibility !== (library.visibility ?? 'private')

  function reportError(err: unknown, fallback: string) {
    notify.error(getUserErrorNotification(err, fallback))
  }

  function handleSave() {
    updateLibrary.mutate({
      libraryId: library.id,
      patch: {
        name: name.trim(),
        description,
        visibility,
        ...(visibility === 'password' ? { accessPassword: password.length >= 4 ? password : null } : {}),
      },
    }, {
      onSuccess: () => {
        setPassword('')
        notify.success(_('library.librarySettingsSaved'))
      },
      onError: (err) => reportError(err, 'library.librarySettingsSaveFailed'),
    })
  }

  const visibilityOptions: Array<{
    value: LibraryVisibility
    icon: typeof LockIcon
    label: string
  }> = [
    {
      value: 'private',
      icon: LockIcon,
      label: _('library.visibilityPrivate'),
    },
    {
      value: 'password',
      icon: KeyIcon,
      label: _('library.visibilityPassword'),
    },
    {
      value: 'public',
      icon: GlobeIcon,
      label: _('library.visibilityPublic'),
    },
  ]

  return (
    <>
      <Modal
        title={_('library.manageLibrary')}
        onClose={onClose}
        closeLabel={_('library.close')}
        size="wide"
        footer={
          <div className="flex w-full items-center justify-between">
            <div className="flex items-center gap-3">
              {isOwner && (
                <button
                  type="button"
                  disabled={deleteLibrary.isPending}
                  onClick={() => setDanger('delete')}
                  className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40 dark:hover:text-red-300 cursor-pointer"
                >
                  {_('library.deleteLibrary')}
                </button>
              )}
              {settingsChanged ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  {_('library.unsavedChanges')}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={onClose}>
                {_('library.close')}
              </Button>
              {canManage && (
                <Button
                  disabled={!settingsChanged || name.trim().length === 0 || updateLibrary.isPending}
                  onClick={handleSave}
                >
                  {_('library.save')}
                </Button>
              )}
            </div>
          </div>
        }
      >
        <div className="flex flex-col gap-6">
          {canManage && (
            <section className="flex flex-col gap-3 rounded-2xl border border-stone-200/80 bg-stone-50/30 p-4 dark:border-stone-800 dark:bg-stone-800/20">
              <div className="flex items-center gap-2 pb-1 border-b border-stone-100 dark:border-stone-800">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400">
                  <SettingsIcon className="h-3.5 w-3.5" />
                </div>
                <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-200">
                  {_('library.librarySettings')}
                </h3>
              </div>

              <label className="flex flex-col gap-1.5 text-sm text-stone-700 dark:text-stone-300">
                <span className="font-medium text-xs text-stone-500 dark:text-stone-400">{_('library.libraryName')}</span>
                <input
                  aria-label={_('library.libraryName')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={64}
                  className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none transition-all placeholder:text-stone-400 focus:border-stone-900 focus:ring-1 focus:ring-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:focus:border-stone-200 dark:focus:ring-stone-200"
                />
              </label>

              <label className="flex flex-col gap-1.5 text-sm text-stone-700 dark:text-stone-300">
                <span className="font-medium text-xs text-stone-500 dark:text-stone-400">{_('library.libraryDescription')}</span>
                <textarea
                  aria-label={_('library.libraryDescription')}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={2000}
                  rows={2}
                  className="resize-y rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none transition-all placeholder:text-stone-400 focus:border-stone-900 focus:ring-1 focus:ring-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:focus:border-stone-200 dark:focus:ring-stone-200"
                />
              </label>

              <div className="flex flex-col gap-1.5 text-sm text-stone-700 dark:text-stone-300">
                <span className="font-medium text-xs text-stone-500 dark:text-stone-400">{_('library.libraryVisibility')}</span>
                <div className="grid grid-cols-3 gap-2">
                  {visibilityOptions.map((opt) => {
                    const Icon = opt.icon
                    const selected = visibility === opt.value
                    return (
                      <label
                        key={opt.value}
                        className={cn(
                          'flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border py-2 px-3 text-xs font-medium transition-all select-none',
                          selected
                            ? 'border-stone-900 bg-stone-900 text-white shadow-xs dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900'
                            : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-stone-600',
                        )}
                      >
                        <input
                          type="radio"
                          name="manage-library-visibility"
                          value={opt.value}
                          checked={selected}
                          onChange={() => setVisibility(opt.value)}
                          className="sr-only"
                        />
                        <Icon className="h-3.5 w-3.5" />
                        <span>{opt.label}</span>
                      </label>
                    )
                  })}
                </div>
              </div>

              {visibility === 'password' && (
                <label className="flex flex-col gap-1.5 text-sm text-stone-700 dark:text-stone-300">
                  <span className="font-medium text-xs text-stone-500 dark:text-stone-400">{_('library.libraryAccessPassword')}</span>
                  <input
                    type="password"
                    aria-label={_('library.libraryAccessPassword')}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    placeholder={_('library.libraryAccessPasswordKeep')}
                    className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none transition-all placeholder:text-stone-400 focus:border-stone-900 focus:ring-1 focus:ring-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:focus:border-stone-200 dark:focus:ring-stone-200"
                  />
                  <span className="text-xs text-stone-400">{_('library.libraryAccessPasswordHint')}</span>
                </label>
              )}
            </section>
          )}
        </div>
      </Modal>

      {danger === 'delete' && (
        <ConfirmDialog
          title={_('library.deleteLibrary')}
          message={_('library.deleteLibraryConfirm', { name: library.name })}
          confirmLabel={_('library.deleteLibrary')}
          onClose={() => setDanger(null)}
          onConfirm={() => {
            setDanger(null)
            deleteLibrary.mutate({ libraryId: library.id }, {
              onSuccess: () => {
                notify.success(_('library.deleteLibrarySuccess', { name: library.name }))
                onClose()
                onDeleted()
              },
              onError: (err) => reportError(err, 'library.deleteLibraryFailed'),
            })
          }}
        />
      )}
    </>
  )
}
