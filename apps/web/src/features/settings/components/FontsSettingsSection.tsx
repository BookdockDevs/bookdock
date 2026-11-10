import { useEffect, useMemo, useRef, useState } from 'react'

import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable'

import { useDeleteFont, useFonts, useUploadFont } from '@/api/hooks/useFonts'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import QueryErrorState from '@/components/ui/QueryErrorState'
import { buildFontOptions, ensureBuiltinFontLoaded, ensureBuiltinFontsLoaded, ensureUploadedFontLoaded, useFontLoaderStore, type FontOption } from '@/features/reader/fonts'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { useAuthStore } from '@/stores/auth.store'
import { useUiStore } from '@/stores/ui.store'

import EditModeButton from './EditModeButton'
import FontEditor from './FontEditor'
import FontRow from './FontRow'
import SettingsCard from './SettingsCard'

function PlusIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
}

export default function FontsSettingsSection() {
  const _ = useTranslation()
  const user = useAuthStore((state) => state.user)
  const isGuest = !user
  const isOwner = user?.role === 'owner'
  // Fonts are account-scoped server assets; a vault-capable guest must not
  // probe /fonts from the unified surface.
  const fontsQuery = useFonts(Boolean(user))
  const uploadedFonts = useMemo(() => fontsQuery.data?.data ?? [], [fontsQuery.data])
  const fontPreferences = useUiStore((state) => state.fontPreferences)
  const fontOrder = useUiStore((state) => state.fontOrder)
  const setFontPreference = useUiStore((state) => state.setFontPreference)
  const removeFontPreference = useUiStore((state) => state.removeFontPreference)
  const setFontOrder = useUiStore((state) => state.setFontOrder)
  const uploadFont = useUploadFont()
  const deleteFont = useDeleteFont()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pendingDelete, setPendingDelete] = useState<FontOption | null>(null)
  const [editingFont, setEditingFont] = useState<FontOption | null>(null)
  const [uploadState, setUploadState] = useState<{
    fileName: string
    progress: number
    phase: 'uploading' | 'processing'
  } | null>(null)
  const fontLoadedIds = useFontLoaderStore((state) => state.loadedIds)
  const fontLoadingIds = useFontLoaderStore((state) => state.loadingIds)
  const fonts = useMemo(
    () => buildFontOptions(uploadedFonts, { loadedIds: fontLoadedIds, loadingIds: fontLoadingIds }, fontPreferences, fontOrder),
    [uploadedFonts, fontLoadedIds, fontLoadingIds, fontPreferences, fontOrder],
  )
  const [sorting, setSorting] = useState(false)
  const [draftFonts, setDraftFonts] = useState<FontOption[] | null>(null)
  const displayFonts = sorting ? draftFonts ?? fonts : fonts
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const enabledCount = displayFonts.filter((font) => font.enabled).length
  const showError = (error: unknown) => notify.error(getUserErrorNotification(error, 'settings.fontOperationFailed'))

  useEffect(() => {
    uploadedFonts.forEach((font) => void ensureUploadedFontLoaded(font))
  }, [uploadedFonts])

  useEffect(() => {
    ensureBuiltinFontsLoaded()
  }, [])

  async function onFilesSelected(fileList: FileList | null) {
    if (!fileList?.length || fontsQuery.isPending || fontsQuery.isError) return
    const knownIds = new Set(uploadedFonts.map((font) => font.id))
    let succeeded = 0
    let duplicated = 0
    const failures: unknown[] = []
    const files = Array.from(fileList)
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!
      setUploadState({
        fileName: file.name,
        progress: 0,
        phase: 'uploading',
      })
      try {
        const result = await uploadFont.mutateAsync({
          file,
          onProgress: (percent) => {
            setUploadState((prev) =>
              prev
                ? {
                    ...prev,
                    progress: percent,
                    phase: percent >= 100 ? 'processing' : 'uploading',
                  }
                : null,
            )
          },
        })
        if (knownIds.has(result.data.id)) duplicated++
        else {
          knownIds.add(result.data.id)
          succeeded++
        }
      } catch (error) {
        failures.push(error)
      }
    }
    setUploadState(null)
    if (failures.length) {
      const showResult = succeeded + duplicated > 0 ? notify.warning : notify.error
      showResult({ key: 'settings.fontUploadPartial', params: { succeeded, duplicated, failed: failures.length } })
    } else if (duplicated > 0) {
      const showResult = succeeded > 0 ? notify.success : notify.info
      showResult({ key: 'settings.fontUploadSummary', params: { succeeded, duplicated } })
    } else notify.success({ key: 'settings.fontUploaded', params: { count: succeeded } })
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function onToggle(font: FontOption) {
    if (font.enabled && enabledCount <= 1) {
      notify.warning({ key: 'settings.fontsKeepOneEnabled' })
      return
    }
    const enabled = !font.enabled
    if (sorting) setDraftFonts((current) => current?.map((item) => item.id === font.id ? { ...item, enabled } : item) ?? current)
    setFontPreference(font.id, { enabled })
  }

  function confirmDelete() {
    const uploaded = pendingDelete?.uploaded
    if (!uploaded) return
    deleteFont.mutate(uploaded.id, {
      onSuccess: () => {
        removeFontPreference(uploaded.id)
        if (sorting) setDraftFonts((current) => current?.filter((font) => font.id !== uploaded.id) ?? current)
        notify.success({ key: 'toast.fontDeleted' })
      },
      onError: showError,
    })
    setPendingDelete(null)
  }

  function toggleSorting() {
    if (deleteFont.isPending || uploadFont.isPending) return
    if (!sorting) {
      setDraftFonts(fonts)
      setSorting(true)
      return
    }
    const next = draftFonts ?? fonts
    setFontOrder(next.map((font) => font.id))
    setDraftFonts(null)
    setSorting(false)
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!sorting || !over || active.id === over.id || deleteFont.isPending || uploadFont.isPending) return
    const currentFonts = draftFonts ?? fonts
    const oldIndex = currentFonts.findIndex((font) => font.id === active.id)
    const newIndex = currentFonts.findIndex((font) => font.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    setDraftFonts(arrayMove(currentFonts, oldIndex, newIndex))
  }

  return (
    <>
      <SettingsCard
        icon={<FontIcon className="h-5 w-5" />}
        iconBgClass="bg-violet-500/10 text-violet-600 dark:bg-violet-500/20 dark:text-violet-400"
        title={
          <span className="flex items-baseline gap-1.5">
            <span>{_('settings.fonts')}</span>
            {fonts.length > 0 && <span className="text-xs font-normal tabular-nums text-stone-400 dark:text-stone-500">· {fonts.length}</span>}
          </span>
        }
        action={
          <div className="flex shrink-0 items-center gap-1">
            <EditModeButton active={sorting} disabled={deleteFont.isPending || uploadFont.isPending} onClick={toggleSorting} />
            {!isGuest && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".ttf,.otf,.woff,.woff2"
                  multiple
                  className="hidden"
                  onChange={(event) => void onFilesSelected(event.target.files)}
                />
                <button
                  type="button"
                  disabled={sorting || uploadFont.isPending || fontsQuery.isPending || fontsQuery.isError}
                  onClick={() => fileInputRef.current?.click()}
                  aria-label={_('settings.fontsUpload')}
                  title={_('settings.fontsUpload')}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-50 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                >
                  <PlusIcon />
                </button>
              </>
            )}
          </div>
        }
        bodyClassName="pt-3"
      >
        {uploadState && (
          <div className="mb-3 flex items-center gap-3 rounded-xl bg-stone-50 px-3 py-2 text-xs dark:bg-stone-800/60">
            <span className="shrink-0 text-stone-500 dark:text-stone-400">
              <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            </span>
            <span className="min-w-0 flex-1 truncate text-stone-700 dark:text-stone-300">
              {uploadState.fileName}
            </span>
            <span className="shrink-0 tabular-nums text-stone-400 dark:text-stone-500">
              {uploadState.phase === 'processing' ? _('library.processing') : `${uploadState.progress}%`}
            </span>
            <span className="w-24 shrink-0">
              <span className="block h-1.5 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700">
                <span
                  className="block h-full rounded-full bg-stone-800 transition-all duration-200 dark:bg-stone-200"
                  style={{ width: `${uploadState.phase === 'processing' ? 100 : uploadState.progress}%` }}
                />
              </span>
            </span>
          </div>
        )}

      {fontsQuery.isError ? (
        <QueryErrorState className="py-4" isRetrying={fontsQuery.isFetching} onRetry={fontsQuery.refetch} />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={displayFonts.map((font) => font.id)} strategy={rectSortingStrategy}>
            <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {displayFonts.map((font) => (
                <FontRow
                  key={`${font.source}:${font.id}`}
                  font={font}
                  isOwner={isOwner}
                  disabled={deleteFont.isPending || uploadFont.isPending}
                  sorting={sorting}
                  onToggle={() => onToggle(font)}
                  onLoad={() => { if (font.builtin) ensureBuiltinFontLoaded(font.builtin.id) }}
                  onEdit={() => setEditingFont(font)}
                  onDelete={() => setPendingDelete(font)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
      </SettingsCard>

      {pendingDelete?.uploaded && (
        <ConfirmDialog
          title={_('settings.confirmDeleteTitle')}
          message={_('settings.fontsDeleteConfirm', { name: pendingDelete.name })}
          confirmLabel={_('settings.confirmDeleteAction')}
          onConfirm={confirmDelete}
          onClose={() => setPendingDelete(null)}
        />
      )}
      {editingFont && <FontEditor font={editingFont} isOwner={isOwner} onClose={() => setEditingFont(null)} />}
    </>
  )
}

function FontIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polyline points="4 7 4 4 20 4 20 7" />
      <line x1="9" x2="15" y1="20" y2="20" />
      <line x1="12" x2="12" y1="4" y2="20" />
    </svg>
  )
}
