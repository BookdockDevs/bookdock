import { useEffect, useRef, useState } from 'react'

import { AUTH_REGISTER_USERNAME_MAX_LENGTH } from '@bookdock/shared'

import { Button } from '@/components/ui/Button'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import ChangePasswordDialog from '@/features/auth/ChangePasswordDialog'
import { authErrorKey } from '@/features/auth/errors'
import { useDeleteAvatar, useUpdateUsername, useUploadAvatar } from '@/features/auth/hooks'
import { useTranslation } from '@/hooks/useTranslation'
import { avatarUrl } from '@/lib/avatar'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { useAuthStore } from '@/stores/auth.store'

const MAX_AVATAR_SIDE = 512

// Scale the longest side down to MAX_AVATAR_SIDE, keeping the original format.
// Canvas cannot re-encode GIF (animation would be lost), so GIFs upload as-is.
async function compressAvatar(file: File): Promise<File> {
  if (file.type === 'image/gif') return file
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_AVATAR_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return file
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, file.type))
  return blob ? new File([blob], file.name, { type: file.type }) : file
}

export default function AccountSection() {
  const _ = useTranslation()
  const user = useAuthStore((s) => s.user)
  const uploadAvatar = useUploadAvatar()
  const deleteAvatar = useDeleteAvatar()
  const updateUsername = useUpdateUsername()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)
  const [removeAvatarOpen, setRemoveAvatarOpen] = useState(false)

  // Preview URLs are object URLs; revoke on unmount to avoid leaking them
  useEffect(() => {
    return () => {
      setPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev.url)
        return null
      })
    }
  }, [])

  async function onFileSelected(fileList: FileList | null) {
    const file = fileList?.[0]
    if (!file) return
    // Reset so picking the same file again still fires onChange
    if (fileInputRef.current) fileInputRef.current.value = ''
    try {
      const compressed = await compressAvatar(file)
      setPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev.url)
        return { file: compressed, url: URL.createObjectURL(compressed) }
      })
    } catch {
      notify.error({ key: 'settings.avatarProcessFailed' })
    }
  }

  function onCancelPreview() {
    if (preview) URL.revokeObjectURL(preview.url)
    setPreview(null)
  }

  async function onUploadPreview() {
    if (!preview) return
    try {
      await uploadAvatar.mutateAsync(preview.file)
      URL.revokeObjectURL(preview.url)
      setPreview(null)
      notify.success({ key: 'settings.avatarUpdated' })
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'errors.updateFailed'))
    }
  }

  function onRemoveAvatar() {
    setRemoveAvatarOpen(true)
  }

  function confirmRemoveAvatar() {
    deleteAvatar.mutate(undefined, {
      onSuccess: () => notify.success({ key: 'settings.avatarRemoved' }),
      onError: (err) => notify.error(getUserErrorNotification(err, 'errors.deleteFailed')),
    })
    setRemoveAvatarOpen(false)
  }

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
      setEditingName(false)
      notify.success({ key: 'settings.usernameUpdated' })
    } catch (err) {
      setNameError(_(authErrorKey(err)))
    }
  }

  const url = avatarUrl(user?.avatarKey)

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6 dark:border-stone-800 dark:bg-stone-900">
      <h2 className="mb-2 text-sm font-medium">{_('settings.account')}</h2>

      <div className="divide-y divide-stone-100 dark:divide-stone-800/80">
        {/* Profile Row */}
        <div className="flex flex-col gap-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            {/* Avatar with hover reveal controls */}
            <div className="group relative shrink-0">
              {preview ? (
                <img src={preview.url} alt={_('settings.avatar')} className="h-16 w-16 rounded-full object-cover ring-2 ring-stone-100 shadow-xs dark:ring-stone-700" />
              ) : url ? (
                <img src={url} alt={_('settings.avatar')} className="h-16 w-16 rounded-full object-cover ring-2 ring-stone-100 shadow-xs dark:ring-stone-700" />
              ) : (
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-stone-200 text-xl font-semibold uppercase text-stone-700 ring-2 ring-stone-100 shadow-xs dark:bg-stone-700 dark:text-stone-200 dark:ring-stone-600">
                  {(user?.username ?? '').slice(0, 1)}
                </span>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={(e) => void onFileSelected(e.target.files)}
              />

              {/* Hover overlay button to change avatar */}
              <button
                type="button"
                aria-label={_('settings.avatarChange')}
                onClick={() => fileInputRef.current?.click()}
                className="absolute inset-0 flex flex-col items-center justify-center rounded-full bg-stone-950/60 text-white opacity-0 backdrop-blur-[1px] transition-opacity group-hover:opacity-100"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                <span className="mt-0.5 text-[10px] font-medium leading-tight">{_('settings.avatarChange')}</span>
              </button>

              {/* Hover remove button if avatar is set */}
              {url && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemoveAvatar()
                  }}
                  title={_('settings.avatarRemove')}
                  aria-label={_('settings.avatarRemove')}
                  className="absolute -right-1 -top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-stone-900 text-stone-300 shadow-sm opacity-0 ring-2 ring-white transition-all hover:bg-red-600 hover:text-white group-hover:opacity-100 dark:bg-stone-700 dark:ring-stone-900"
                >
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                  <span className="sr-only">{_('settings.avatarRemove')}</span>
                </button>
              )}
            </div>

            <div className="min-w-0 flex-1">
              {editingName ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    maxLength={AUTH_REGISTER_USERNAME_MAX_LENGTH}
                    className="h-8 w-full max-w-xs rounded-xl border border-stone-200 bg-white px-3 text-sm outline-none focus:border-stone-400 dark:border-stone-700 dark:bg-stone-900"
                    autoFocus
                  />
                  <Button size="sm" disabled={updateUsername.isPending || !nameDraft.trim()} onClick={() => void onSaveUsername()}>
                    {_('library.save')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingName(false)}>
                    {_('library.cancel')}
                  </Button>
                  {nameError && <p className="w-full text-xs text-red-600">{nameError}</p>}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-base font-semibold text-stone-900 dark:text-stone-100">
                    {user?.username}
                  </span>
                  <span className="shrink-0 rounded-md bg-stone-100 px-1.5 py-0.5 text-[11px] font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                    {user?.role === 'owner' ? _('auth.roleOwner') : user?.role === 'guest' ? _('auth.guest') : _('auth.roleMember')}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setNameDraft(user?.username ?? '')
                      setNameError(null)
                      setEditingName(true)
                    }}
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                    </svg>
                    <span>{_('settings.usernameEdit')}</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Confirmation buttons only when previewing a new avatar */}
          {preview && (
            <div className="flex shrink-0 items-center gap-2">
              <Button size="sm" disabled={uploadAvatar.isPending} onClick={() => void onUploadPreview()}>
                {_('settings.avatarUpload')}
              </Button>
              <Button size="sm" variant="ghost" onClick={onCancelPreview}>
                {_('library.cancel')}
              </Button>
            </div>
          )}
        </div>

        {/* Security & Password Row */}
        <div className="flex items-center justify-between gap-4 py-3.5">
          <span className="text-sm font-medium text-stone-700 dark:text-stone-200">{_('auth.password')}</span>
          <Button size="sm" variant="secondary" onClick={() => setChangePasswordOpen(true)}>
            {_('auth.changePassword')}
          </Button>
        </div>
      </div>

      {removeAvatarOpen && (
        <ConfirmDialog
          title={_('settings.confirmRemoveTitle')}
          message={_('settings.avatarRemoveConfirm')}
          confirmLabel={_('settings.confirmRemoveAction')}
          onConfirm={confirmRemoveAvatar}
          onClose={() => setRemoveAvatarOpen(false)}
        />
      )}

      <ChangePasswordDialog open={changePasswordOpen} onClose={() => setChangePasswordOpen(false)} />
    </section>
  )
}
