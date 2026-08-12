import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/Button'
import ChangePasswordDialog from '@/features/auth/ChangePasswordDialog'
import { authErrorKey } from '@/features/auth/errors'
import { useDeleteAvatar, useUpdateUsername, useUploadAvatar } from '@/features/auth/hooks'
import { useTranslation } from '@/hooks/useTranslation'
import { avatarUrl } from '@/lib/avatar'
import { useAuthStore } from '@/stores/auth.store'
import { useToastStore } from '@/stores/toast.store'

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
  const addToast = useToastStore((s) => s.addToast)
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
      addToast(_('settings.avatarProcessFailed'), 'error')
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
      addToast(_('settings.avatarUpdated'), 'success')
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  function onRemoveAvatar() {
    if (!window.confirm(_('settings.avatarRemoveConfirm'))) return
    deleteAvatar.mutate(undefined, {
      onSuccess: () => addToast(_('settings.avatarRemoved'), 'success'),
      onError: (err) => addToast(err.message, 'error'),
    })
  }

  async function onSaveUsername() {
    const username = nameDraft.trim()
    if (!username) return
    setNameError(null)
    try {
      await updateUsername.mutateAsync({ username })
      setEditingName(false)
      addToast(_('settings.usernameUpdated'), 'success')
    } catch (err) {
      setNameError(_(authErrorKey(err)))
    }
  }

  const url = avatarUrl(user?.avatarKey)
  const rowLabel = 'mb-1.5 block text-sm font-medium text-stone-600 dark:text-stone-400'

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <h2 className="mb-4 text-sm font-medium">{_('settings.account')}</h2>

      <div className="mb-5">
        <span className={rowLabel}>{_('settings.avatar')}</span>
        <div className="flex items-center gap-4">
          {preview ? (
            <img src={preview.url} alt={_('settings.avatar')} className="h-16 w-16 rounded-full object-cover" />
          ) : url ? (
            <img src={url} alt={_('settings.avatar')} className="h-16 w-16 rounded-full object-cover" />
          ) : (
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-stone-300/80 text-xl font-semibold uppercase text-stone-700 dark:bg-stone-700 dark:text-stone-200">
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
          {preview ? (
            <div className="flex gap-2">
              <Button size="sm" disabled={uploadAvatar.isPending} onClick={() => void onUploadPreview()}>
                {_('settings.avatarUpload')}
              </Button>
              <Button size="sm" variant="ghost" onClick={onCancelPreview}>
                {_('library.cancel')}
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => fileInputRef.current?.click()}>
                {_('settings.avatarChange')}
              </Button>
              {url && (
                <Button size="sm" variant="ghost" disabled={deleteAvatar.isPending} onClick={onRemoveAvatar}>
                  {_('settings.avatarRemove')}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mb-5">
        <span className={rowLabel}>{_('auth.username')}</span>
        {editingName ? (
          <div>
            <div className="flex gap-2">
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                maxLength={30}
                className="w-full max-w-xs rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-stone-400 dark:border-stone-800 dark:bg-stone-900"
              />
              <Button size="sm" disabled={updateUsername.isPending || !nameDraft.trim()} onClick={() => void onSaveUsername()}>
                {_('library.save')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingName(false)}>
                {_('library.cancel')}
              </Button>
            </div>
            {nameError && <p className="mt-2 text-sm text-red-600">{nameError}</p>}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-sm text-stone-900 dark:text-stone-100">{user?.username}</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setNameDraft(user?.username ?? '')
                setNameError(null)
                setEditingName(true)
              }}
            >
              {_('settings.usernameEdit')}
            </Button>
          </div>
        )}
      </div>

      <div>
        <span className={rowLabel}>{_('auth.password')}</span>
        <Button size="sm" variant="secondary" onClick={() => setChangePasswordOpen(true)}>
          {_('auth.changePassword')}
        </Button>
      </div>

      <ChangePasswordDialog open={changePasswordOpen} onClose={() => setChangePasswordOpen(false)} />
    </section>
  )
}
