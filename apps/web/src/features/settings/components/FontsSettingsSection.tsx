import { useEffect, useMemo, useRef } from 'react'

import type { FontListItem } from '@bookdock/shared'

import { useDeleteFont, useFonts, useUpdateFontScope, useUploadFont } from '@/api/hooks/useFonts'
import { ensureUploadedFontLoaded, uploadedFontAlias } from '@/features/reader/fonts'
import { useTranslation } from '@/hooks/useTranslation'
import { useAuthStore } from '@/stores/auth.store'
import { useToastStore } from '@/stores/toast.store'

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.ceil(bytes / 1024)} KB`
}

export default function FontsSettingsSection() {
  const _ = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const isOwner = useAuthStore((s) => s.user?.role === 'owner' && s.user.guest !== true)
  const { data } = useFonts()
  const fonts = useMemo(() => data?.data ?? [], [data])
  const uploadFont = useUploadFont()
  const deleteFont = useDeleteFont()
  const updateScope = useUpdateFontScope()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Family names render in their own font, so every listed font must be
  // registered in the main document
  useEffect(() => {
    fonts.forEach((f) => void ensureUploadedFontLoaded(f))
  }, [fonts])

  async function onFilesSelected(fileList: FileList | null) {
    if (!fileList?.length) return
    for (const file of Array.from(fileList)) {
      try {
        await uploadFont.mutateAsync(file)
      } catch (err) {
        addToast(err instanceof Error ? err.message : String(err), 'error')
      }
    }
    // Reset so picking the same file again still fires onChange
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function onDelete(font: FontListItem) {
    if (!window.confirm(_('settings.fontsDeleteConfirm', { name: font.family }))) return
    deleteFont.mutate(font.id, {
      onError: (err) => addToast(err.message, 'error'),
    })
  }

  function onToggleScope(font: FontListItem) {
    updateScope.mutate(
      { id: font.id, scope: font.scope === 'instance' ? 'user' : 'instance' },
      { onError: (err) => addToast(err.message, 'error') },
    )
  }

  const badge = 'rounded border border-stone-200 px-1.5 py-0.5 text-[11px] text-stone-500 dark:border-stone-700 dark:text-stone-400'

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6 dark:border-stone-800 dark:bg-stone-900">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium">{_('settings.fonts')}</h2>
        <input
          ref={fileInputRef}
          type="file"
          accept=".ttf,.otf,.woff,.woff2"
          multiple
          className="hidden"
          onChange={(e) => void onFilesSelected(e.target.files)}
        />
        <button
          type="button"
          disabled={uploadFont.isPending}
          onClick={() => fileInputRef.current?.click()}
          className="rounded-lg bg-stone-900 px-3 py-1.5 text-xs text-white transition-colors hover:bg-stone-700 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
        >
          {_('settings.fontsUpload')}
        </button>
      </div>
      {fonts.length === 0 ? (
        <p className="text-xs text-stone-400 dark:text-stone-500">{_('settings.fontsEmpty')}</p>
      ) : (
        <ul className="divide-y divide-stone-200 dark:divide-stone-800">
          {fonts.map((f) => (
            <li key={f.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm" style={{ fontFamily: `"${uploadedFontAlias(f.id)}", serif` }}>
                  {f.family}
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <span className={badge}>{f.format}</span>
                  <span className={badge}>{formatSize(f.size)}</span>
                  <span className={badge}>
                    {_(f.scope === 'instance' ? 'settings.fontsScopeInstance' : 'settings.fontsScopeUser')}
                  </span>
                </div>
              </div>
              {isOwner && (
                <button
                  type="button"
                  disabled={updateScope.isPending}
                  onClick={() => onToggleScope(f)}
                  className="shrink-0 rounded-lg border border-stone-200 px-2 py-1 text-xs text-stone-500 transition-colors hover:text-stone-800 disabled:opacity-50 dark:border-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
                >
                  {_(f.scope === 'instance' ? 'settings.fontsToUser' : 'settings.fontsToInstance')}
                </button>
              )}
              {(f.mine || isOwner) && (
                <button
                  type="button"
                  disabled={deleteFont.isPending}
                  onClick={() => onDelete(f)}
                  className="shrink-0 rounded-lg border border-stone-200 px-2 py-1 text-xs text-red-500 transition-colors hover:border-red-300 hover:text-red-600 disabled:opacity-50 dark:border-stone-700"
                >
                  {_('settings.fontsDelete')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
