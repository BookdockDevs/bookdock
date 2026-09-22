import { useEffect, useMemo, useRef, useState } from 'react'

import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable'

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
  const isGuest = user?.guest === true || user?.role === 'guest'
  const isOwner = user?.role === 'owner' && user.guest !== true
  const fontsQuery = useFonts()
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
    if (!fileList?.length) return
    for (const file of Array.from(fileList)) {
      try {
        await uploadFont.mutateAsync(file)
      } catch (error) {
        showError(error)
      }
    }
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
                  disabled={sorting || uploadFont.isPending}
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

      {fontsQuery.isError ? (
        <QueryErrorState className="py-4" isRetrying={fontsQuery.isFetching} onRetry={fontsQuery.refetch} />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={displayFonts.map((font) => font.id)} strategy={verticalListSortingStrategy}>
            <ul className="divide-y divide-stone-200 dark:divide-stone-800">
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
