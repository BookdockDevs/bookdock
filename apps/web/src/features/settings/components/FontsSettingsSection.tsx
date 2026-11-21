import { useEffect, useMemo, useRef, useState } from 'react'

import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable'

import JSZip from 'jszip'

import { exportFontsZip, triggerFontDownload, useDeleteFont, useFonts, useUploadFont } from '@/api/hooks/useFonts'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import QueryErrorState from '@/components/ui/QueryErrorState'
import SmartMenu, { menuItemClass } from '@/components/ui/SmartMenu'
import { DeviceFontError, DeviceFontStore } from '@/features/device-fonts/db'
import { useDeviceFontStore } from '@/features/device-fonts/store'
import { buildFontOptions, ensureBuiltinFontLoaded, ensureDeviceFontFace, ensureUploadedFontLoaded, releaseDeviceFontFace, useFontLoaderStore, type FontOption } from '@/features/reader/fonts'
import { useTranslation } from '@/hooks/useTranslation'
import { useMenuAnchor } from '@/hooks/useMenuAnchor'
import { downloadBlob, timestampSuffix } from '@/lib/download'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import i18n from '@/i18n/i18n'
import { useAuthStore } from '@/stores/auth.store'
import { useUiStore } from '@/stores/ui.store'

import EditModeButton from './EditModeButton'
import ExportConfirmDialog from './ExportConfirmDialog'
import FontEditor from './FontEditor'
import FontRow from './FontRow'
import ResourceUploadProgress from './ResourceUploadProgress'
import RuleSelectAllBar from './RuleSelectAllBar'
import RuleSelectionActions from './RuleSelectionActions'
import SettingsCard from './SettingsCard'
import { ExportIcon } from './row-icons'
import Spinner from '@/components/ui/Spinner'

interface FontsSettingsSectionProps {
  /** False hides the upload entry while the instance keeps member resource uploads off. */
  canUploadResources?: boolean
}

function PlusIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
}

export default function FontsSettingsSection({ canUploadResources = true }: FontsSettingsSectionProps) {
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
  const deviceFontStatus = useDeviceFontStore((state) => state.status)
  const deviceFonts = useDeviceFontStore((state) => state.fonts)
  const devicePreferences = useDeviceFontStore((state) => state.preferences)
  const deviceOrder = useDeviceFontStore((state) => state.order)
  useEffect(() => {
    void useDeviceFontStore.getState().ensureLoaded()
  }, [])
  const uploadFont = useUploadFont()
  const deleteFont = useDeleteFont()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const deviceInputRef = useRef<HTMLInputElement>(null)
  const importMenu = useMenuAnchor()
  const [pendingDelete, setPendingDelete] = useState<FontOption | null>(null)
  const [pendingBulkDelete, setPendingBulkDelete] = useState<FontOption[] | null>(null)
  const [pendingExport, setPendingExport] = useState<FontOption[] | null>(null)
  const [editingFont, setEditingFont] = useState<FontOption | null>(null)
  const [uploadState, setUploadState] = useState<{
    fileName: string
    progress: number
    phase: 'uploading' | 'processing'
  } | null>(null)
  const fontLoadedIds = useFontLoaderStore((state) => state.loadedIds)
  const fontLoadingIds = useFontLoaderStore((state) => state.loadingIds)
  const deviceCatalog = useMemo(
    () => ({ fonts: deviceFonts, preferences: devicePreferences, order: deviceOrder }),
    [deviceFonts, devicePreferences, deviceOrder],
  )
  // canUploadResources already folds in owner/instance-policy; members of
  // instances that keep resource uploads off must not see (or trigger) the
  // upstream download of never-fetched builtin fonts
  // Rebuild the catalog when the UI language changes: localized font names
  const uiLanguage = i18n.language
  const fonts = useMemo(
    () => buildFontOptions(uploadedFonts, { loadedIds: fontLoadedIds, loadingIds: fontLoadingIds }, fontPreferences, fontOrder, deviceCatalog, canUploadResources),
    // uiLanguage: buildFontOptions resolves localized names per UI language
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uploadedFonts, fontLoadedIds, fontLoadingIds, fontPreferences, fontOrder, deviceCatalog, canUploadResources, uiLanguage],
  )
  const [sorting, setSorting] = useState(false)
  const [draftFonts, setDraftFonts] = useState<FontOption[] | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [exporting, setExporting] = useState(false)
  const displayFonts = sorting ? draftFonts ?? fonts : fonts
  const exportableFonts = useMemo(
    () => displayFonts.filter((font) => (font.source === 'uploaded' && !isGuest && font.uploaded) || (font.source === 'device' && font.device)),
    [displayFonts, isGuest],
  )
  const exportableIds = useMemo(() => exportableFonts.map((font) => font.id), [exportableFonts])
  const selectedExportIds = useMemo(
    () => selectedIds.filter((id) => exportableIds.includes(id)),
    [exportableIds, selectedIds],
  )
  const selectedDeletableFonts = useMemo(
    () => selectedExportIds
      .map((id) => displayFonts.find((font) => font.id === id))
      .filter((font): font is FontOption =>
        font !== undefined && (font.source === 'device' || (font.source === 'uploaded' && Boolean(font.uploaded) && (font.uploaded!.mine || isOwner))),
      ),
    [displayFonts, isOwner, selectedExportIds],
  )
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const enabledCount = displayFonts.filter((font) => font.enabled).length
  const serverImportAllowed = !isGuest && (isOwner || canUploadResources)
  const serverImportReady = serverImportAllowed && !fontsQuery.isPending && !fontsQuery.isError
  const deviceImportReady = deviceFontStatus !== 'loading'

  useEffect(() => {
    uploadedFonts.forEach((font) => void ensureUploadedFontLoaded(font))
  }, [uploadedFonts])

  // Preload only the builtin faces the viewer is allowed to see: gated
  // members must not trigger downloads of never-fetched entries
  useEffect(() => {
    fonts.filter((font) => font.builtin).forEach((font) => ensureBuiltinFontLoaded(font.builtin!.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUploadResources])

  // Device faces are pooled references held only while this list is mounted
  const deviceFontKey = deviceFonts.map((font) => font.id).join('\u0000')
  useEffect(() => {
    const listed = deviceFontKey ? deviceFontKey.split('\u0000').map((id) => deviceFonts.find((font) => font.id === id)).filter((font) => font !== undefined) : []
    listed.forEach((font) => { void ensureDeviceFontFace(font) })
    return () => {
      listed.forEach((font) => releaseDeviceFontFace(font.id))
    }
  }, [deviceFontKey, deviceFonts])

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

  async function onDeviceFilesSelected(fileList: FileList | null) {
    if (!fileList?.length || !deviceImportReady) return
    let succeeded = 0
    let duplicated = 0
    const failures: string[] = []
    const files = Array.from(fileList)
    for (const file of files) {
      setUploadState({ fileName: file.name, progress: 100, phase: 'processing' })
      try {
        const { duplicate } = await useDeviceFontStore.getState().importFont(file)
        if (duplicate) duplicated++
        else succeeded++
      } catch (error) {
        const category = error instanceof DeviceFontError ? error.category : 'storage-unavailable'
        failures.push(_(`settings.fontImportError_${category}`))
      }
    }
    setUploadState(null)
    if (deviceInputRef.current) deviceInputRef.current.value = ''
    if (failures.length > 0) {
      const showResult = succeeded + duplicated > 0 ? notify.warning : notify.error
      showResult({ key: 'settings.fontImportPartial', params: { succeeded, duplicated, failed: failures.length, reason: failures[0] } })
    } else if (duplicated > 0) {
      const showResult = succeeded > 0 ? notify.success : notify.info
      showResult({ key: 'settings.fontImportSummary', params: { succeeded, duplicated } })
    } else {
      notify.success({ key: 'settings.fontImported', params: { count: succeeded } })
    }
  }

  function onToggle(font: FontOption) {
    if (font.enabled && enabledCount <= 1) {
      notify.warning({ key: 'settings.fontsKeepOneEnabled' })
      return
    }
    const enabled = !font.enabled
    if (sorting) setDraftFonts((current) => current?.map((item) => item.id === font.id ? { ...item, enabled } : item) ?? current)
    if (font.source === 'device') useDeviceFontStore.getState().setPreference(font.id, { enabled })
    else setFontPreference(font.id, { enabled })
  }

  async function removeSingleFont(target: FontOption) {
    if (target.source === 'device' && target.device) {
      const deviceId = target.device.id
      await useDeviceFontStore.getState().removeFont(deviceId)
      if (sorting) setDraftFonts((current) => current?.filter((font) => font.id !== deviceId) ?? current)
    } else if (target.uploaded) {
      const uploadedId = target.uploaded.id
      await deleteFont.mutateAsync(uploadedId)
      removeFontPreference(uploadedId)
      if (sorting) setDraftFonts((current) => current?.filter((font) => font.id !== uploadedId) ?? current)
    }
  }

  // ConfirmDialog awaits this, so failures surface inline there and the
  // dialog closes only after the font is actually removed.
  async function confirmDelete() {
    const target = pendingDelete
    if (!target) return
    await removeSingleFont(target)
    notify.success({ key: 'toast.fontDeleted' })
    setPendingDelete(null)
  }

  async function confirmBulkDelete() {
    const targets = pendingBulkDelete
    if (!targets?.length) return
    for (const target of targets) {
      await removeSingleFont(target)
    }
    setSelectedIds((prev) => prev.filter((id) => !targets.some((target) => target.id === id)))
    notify.success({ key: 'toast.fontDeleted' })
    setPendingBulkDelete(null)
  }

  function toggleSorting() {
    if (deleteFont.isPending || uploadFont.isPending) return
    if (!sorting) {
      setDraftFonts(fonts)
      setSorting(true)
      return
    }
    const next = draftFonts ?? fonts
    // One unified local order (device fonts interleave freely, like the
    // unified shelf). The synced fontOrder carries only the non-device ids so
    // another device's list never receives dangling device references.
    useDeviceFontStore.getState().setOrder(next.map((font) => font.id))
    setFontOrder(next.filter((font) => font.source !== 'device').map((font) => font.id))
    setDraftFonts(null)
    setSelectedIds([])
    setSorting(false)
  }

  function requestExportFontIds(ids: string[]) {
    const targets = ids
      .map((id) => exportableFonts.find((font) => font.id === id))
      .filter((font): font is FontOption => font !== undefined)
    if (!targets.length || exporting) return
    setPendingExport(targets)
  }

  async function executeExportFonts(targets: FontOption[]) {
    setExporting(true)
    try {
      const hasDevice = targets.some((font) => font.source === 'device')
      if (!hasDevice) {
        if (targets.length === 1 && targets[0]!.uploaded) {
          triggerFontDownload(targets[0]!.uploaded.id, targets[0]!.uploaded.fileName)
        } else {
          await exportFontsZip(targets.map((font) => font.uploaded!.id))
        }
        return
      }
      const deviceStore = new DeviceFontStore()
      if (targets.length === 1 && targets[0]!.device) {
        const blob = await deviceStore.getBlob(targets[0]!.device.id)
        if (!blob) throw new Error('Device font file missing')
        downloadBlob(targets[0]!.device.fileName, blob)
        return
      }
      const zip = new JSZip()
      const usedNames = new Set<string>()
      const uniqueName = (raw: string) => {
        const clean = raw.replace(/[\r\n/\\]/g, '_') || 'font'
        if (!usedNames.has(clean)) { usedNames.add(clean); return clean }
        const dot = clean.lastIndexOf('.')
        const stem = dot > 0 ? clean.slice(0, dot) : clean
        const ext = dot > 0 ? clean.slice(dot) : ''
        let n = 2
        while (usedNames.has(`${stem} (${n})${ext}`)) n += 1
        const candidate = `${stem} (${n})${ext}`
        usedNames.add(candidate)
        return candidate
      }
      for (const font of targets) {
        if (font.source === 'device' && font.device) {
          const blob = await deviceStore.getBlob(font.device.id)
          if (!blob) throw new Error('Device font file missing')
          zip.file(uniqueName(font.device.fileName), blob)
        } else if (font.source === 'uploaded' && font.uploaded) {
          const res = await fetch(`/api/v1/fonts/${encodeURIComponent(font.uploaded.id)}/file`)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          zip.file(uniqueName(font.uploaded.fileName), await res.blob())
        }
      }
      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
      downloadBlob(`bookdock-fonts-${timestampSuffix()}.zip`, zipBlob)
    } catch (error) {
      notify.error(getUserErrorNotification(error, 'settings.fontOperationFailed'))
    } finally {
      setExporting(false)
    }
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
            {sorting && exportableIds.length > 0 && (
              <RuleSelectionActions
                disabled={deleteFont.isPending || uploadFont.isPending || exporting}
                exporting={exporting}
                deleteDisabled={selectedDeletableFonts.length === 0}
                selectedCount={selectedExportIds.length}
                onExport={() => requestExportFontIds(selectedExportIds)}
                onDelete={() => setPendingBulkDelete(selectedDeletableFonts)}
              />
            )}
            {!sorting && exportableIds.length > 0 && (
              <button
                type="button"
                disabled={deleteFont.isPending || uploadFont.isPending || exporting}
                aria-busy={exporting}
                onClick={() => requestExportFontIds(exportableIds)}
                aria-label={_('settings.fontsExport')}
                title={_('settings.fontsExport')}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"
              >
                {exporting ? <Spinner size="xs" /> : <ExportIcon />}
              </button>
            )}
            <EditModeButton active={sorting} disabled={deleteFont.isPending || uploadFont.isPending || exporting} onClick={toggleSorting} />
            {!sorting && (
              <button
                ref={importMenu.btnRef}
                type="button"
                onClick={(event) => importMenu.toggleFromButton(event, 'below')}
                aria-expanded={importMenu.open}
                aria-label={_('settings.fontsAdd')}
                title={_('settings.fontsAdd')}
                className={`flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200 ${importMenu.open ? 'bg-stone-100 text-stone-800 dark:bg-stone-800 dark:text-stone-200' : ''}`}
              >
                <PlusIcon />
              </button>
            )}
            {importMenu.open && (
              <SmartMenu
                triggerRef={importMenu.btnRef}
                innerRef={importMenu.menuRef}
                anchor={importMenu.anchor}
                size={{ width: 240, height: serverImportAllowed ? 104 : 68 }}
                onClose={importMenu.close}
              >
                <div className="flex flex-col gap-0.5">
                  {serverImportAllowed && (
                    <button
                      type="button"
                      className={`${menuItemClass} disabled:cursor-not-allowed disabled:opacity-50`}
                      disabled={!serverImportReady}
                      title={serverImportReady ? undefined : fontsQuery.isError ? _('settings.fontsUploadUnavailable') : undefined}
                      onClick={() => {
                        importMenu.close()
                        fileInputRef.current?.click()
                      }}
                    >
                      {_('library.sourceRemote')}
                    </button>
                  )}
                  <button
                    type="button"
                    className={`${menuItemClass} disabled:cursor-not-allowed disabled:opacity-50`}
                    disabled={!deviceImportReady}
                    onClick={() => {
                      importMenu.close()
                      deviceInputRef.current?.click()
                    }}
                  >
                    <span className="flex min-w-0 flex-col items-start gap-0.5 whitespace-normal text-left">
                      <span>{_('library.sourceLocal')}</span>
                      <span className="text-xs font-normal text-stone-500 dark:text-stone-400">{_('settings.fontsImportDeviceHint')}</span>
                    </span>
                  </button>
                </div>
              </SmartMenu>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".ttf,.otf,.woff,.woff2"
              multiple
              className="hidden"
              onChange={(event) => void onFilesSelected(event.target.files)}
            />
            <input
              ref={deviceInputRef}
              type="file"
              accept=".ttf,.otf,.woff,.woff2"
              multiple
              className="hidden"
              onChange={(event) => void onDeviceFilesSelected(event.target.files)}
            />
          </div>
        }
        bodyClassName={sorting && exportableIds.length > 0 ? undefined : 'pt-3'}
      >
        {uploadState && (
          <ResourceUploadProgress fileName={uploadState.fileName} progress={uploadState.progress} phase={uploadState.phase} />
        )}

      {fontsQuery.isError && (
        <QueryErrorState className="mb-3 py-3" isRetrying={fontsQuery.isFetching} onRetry={fontsQuery.refetch} />
      )}
      {sorting && exportableIds.length > 0 && (
        <div className="mb-2">
          <RuleSelectAllBar
            disabled={exporting || deleteFont.isPending || uploadFont.isPending}
            allSelected={selectedExportIds.length === exportableIds.length}
            indeterminate={selectedExportIds.length > 0 && selectedExportIds.length < exportableIds.length}
            selectedCount={selectedExportIds.length}
            onToggleAll={(checked) => setSelectedIds(checked ? exportableIds : [])}
          />
        </div>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={displayFonts.map((font) => font.id)} strategy={rectSortingStrategy}>
          <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {displayFonts.map((font) => {
              const canExport = (font.source === 'uploaded' && !isGuest && Boolean(font.uploaded)) || (font.source === 'device' && Boolean(font.device))
              return (
                <FontRow
                  key={`${font.source}:${font.id}`}
                  font={font}
                  isOwner={isOwner}
                  disabled={deleteFont.isPending || uploadFont.isPending || exporting}
                  sorting={sorting}
                  selectable={canExport}
                  selected={canExport && selectedExportIds.includes(font.id)}
                  onSelectChange={(checked) => {
                    if (!canExport) return
                    setSelectedIds((prev) => checked ? (prev.includes(font.id) ? prev : [...prev, font.id]) : prev.filter((id) => id !== font.id))
                  }}
                  onToggle={() => onToggle(font)}
                  onLoad={() => { if (font.builtin) ensureBuiltinFontLoaded(font.builtin.id) }}
                  onEdit={() => setEditingFont(font)}
                  onDelete={() => setPendingDelete(font)}
                />
              )
            })}
          </ul>
        </SortableContext>
      </DndContext>
      </SettingsCard>

      {pendingDelete && (
        <ConfirmDialog
          title={_('settings.confirmDeleteTitle')}
          message={_('settings.fontsDeleteConfirm', { name: pendingDelete.name })}
          confirmLabel={_('settings.confirmDeleteAction')}
          errorFallback="settings.fontOperationFailed"
          onConfirm={confirmDelete}
          onClose={() => setPendingDelete(null)}
        />
      )}
      {pendingBulkDelete && (
        <ConfirmDialog
          title={_('settings.confirmDeleteTitle')}
          message={<>
            <p>{_('settings.fontsBulkDeleteConfirm', { count: pendingBulkDelete.length })}</p>
            <ul className="mt-2 max-h-40 list-disc overflow-y-auto break-words pl-4">
              {pendingBulkDelete.map((font) => <li key={`${font.source}:${font.id}`}>{font.name}</li>)}
            </ul>
          </>}
          confirmLabel={_('settings.confirmDeleteAction')}
          confirmVariant="danger"
          errorFallback="settings.fontOperationFailed"
          onConfirm={confirmBulkDelete}
          onClose={() => setPendingBulkDelete(null)}
        />
      )}
      {pendingExport && (
        <ExportConfirmDialog
          items={pendingExport.map((font) => font.name)}
          estimatedBytes={pendingExport.reduce((sum, font) => sum + (font.uploaded?.size ?? font.device?.size ?? 0), 0)}
          zipHint={pendingExport.length > 1}
          confirmDisabled={exporting}
          onConfirm={async () => {
            await executeExportFonts(pendingExport)
            setPendingExport(null)
          }}
          onClose={() => { if (!exporting) setPendingExport(null) }}
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
