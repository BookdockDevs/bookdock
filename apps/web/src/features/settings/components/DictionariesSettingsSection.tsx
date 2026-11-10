import { useEffect, useRef, useState } from 'react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'

import { DICTIONARY_MAX_FILES, DICTIONARY_MAX_UPLOAD_BYTES, type DictionaryItem } from '@bookdock/shared'

import { useDictionaries, useDictionaryMutation } from '@/api/hooks/useDictionaries'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import QueryErrorState from '@/components/ui/QueryErrorState'
import SettingsEmptyState from '@/components/ui/SettingsEmptyState'
import { DictionaryIcon } from '@/features/reader/components/annotation-icons'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { useAuthStore } from '@/stores/auth.store'

import DictionaryEditor from './DictionaryEditor'
import DictionaryRow from './DictionaryRow'
import EditModeButton from './EditModeButton'
import SettingsCard from './SettingsCard'

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function SpinnerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="animate-spin">
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  )
}

export default function DictionariesSettingsSection() {
  const _ = useTranslation()
  const user = useAuthStore((state) => state.user)
  const isOwner = user?.role === 'owner'
  const query = useDictionaries()
  const mutation = useDictionaryMutation()
  const input = useRef<HTMLInputElement>(null)
  const [deleting, setDeleting] = useState<DictionaryItem | null>(null)
  const [editingItem, setEditingItem] = useState<DictionaryItem | null>(null)
  const [editing, setEditing] = useState(false)
  const [uploadState, setUploadState] = useState<{
    fileName: string
    progress: number
    phase: 'uploading' | 'processing'
  } | null>(null)
  const [stateAccountId, setStateAccountId] = useState(user?.id ?? null)
  const ownsState = stateAccountId === (user?.id ?? null)
  useEffect(() => {
    if (stateAccountId === (user?.id ?? null)) return
    setDeleting(null)
    setEditingItem(null)
    setEditing(false)
    setUploadState(null)
    setStateAccountId(user?.id ?? null)
  }, [stateAccountId, user?.id])
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const items = user && ownsState ? query.data?.data.items ?? [] : []
  const failed = (error: unknown) => { if (useAuthStore.getState().user?.id === user?.id) notify.error(getUserErrorNotification(error, 'library.operationFailed')) }
  const isImporting = (mutation.isPending && mutation.variables?.kind === 'import') || Boolean(uploadState)
  const actionTitle = _(isImporting ? 'dictionary.importing' : 'dictionary.import')

  return (
    <>
      <SettingsCard
        id="dictionary-settings"
        icon={<DictionaryIcon className="h-5 w-5" />}
        iconBgClass="bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400"
        title={
          <span className="flex items-baseline gap-1.5">
            <span>{_('dictionary.title')}</span>
            {items.length > 0 && (
              <span className="text-xs font-normal tabular-nums text-stone-400 dark:text-stone-500">
                · {items.length}
              </span>
            )}
          </span>
        }
        action={
          <div className="flex shrink-0 items-center gap-1">
            {items.length > 0 && (
              <EditModeButton
                active={editing}
                disabled={mutation.isPending}
                onClick={() => setEditing((value) => !value)}
              />
            )}
            <input
              ref={input}
              type="file"
              multiple
              accept=".mdx,.mdd,.css"
              className="hidden"
              disabled={mutation.isPending}
              onChange={(event) => {
                const files = Array.from(event.target.files ?? [])
                event.target.value = ''
                if (!user || !ownsState) return
                if (!files.length || mutation.isPending) return
                const size = files.reduce((sum, file) => sum + file.size, 0)
                if (
                  files.filter((file) => /\.mdx$/i.test(file.name)).length !== 1 ||
                  files.length > DICTIONARY_MAX_FILES ||
                  files.some((file) => !/\.(mdx|mdd|css)$/i.test(file.name)) ||
                  size > DICTIONARY_MAX_UPLOAD_BYTES
                ) {
                  notify.error({ key: 'dictionary.invalidFiles' })
                  return
                }
                const mainMdx = files.find((file) => /\.mdx$/i.test(file.name))
                setUploadState({ fileName: mainMdx?.name ?? files[0]!.name, progress: 0, phase: 'uploading' })
                mutation.mutate(
                  {
                    kind: 'import',
                    files,
                    onProgress: (percent) => {
                      if (useAuthStore.getState().user?.id !== user?.id) return
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
                  },
                  {
                    onSuccess: () => {
                      if (useAuthStore.getState().user?.id !== user?.id) return
                      setUploadState(null)
                      notify.success({ key: 'dictionary.imported' })
                    },
                    onError: (error) => {
                      if (useAuthStore.getState().user?.id !== user?.id) return
                      setUploadState(null)
                      failed(error)
                    },
                  },
                )
              }}
            />
            <button
              type="button"
              disabled={!user || !ownsState || mutation.isPending || query.isPending || query.isError}
              onClick={() => input.current?.click()}
              aria-label={actionTitle}
              title={actionTitle}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-50 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            >
              {isImporting ? <SpinnerIcon /> : <PlusIcon />}
            </button>
          </div>
        }
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
        {!user ? <SettingsEmptyState>{_('dictionary.accountRequired')}</SettingsEmptyState> : query.isError ? (
          <QueryErrorState isRetrying={query.isFetching} onRetry={query.refetch} />
        ) : query.isPending && !query.data ? (
          <div className="space-y-3 py-1">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex animate-pulse items-center justify-between py-2.5">
                <div className="space-y-1.5">
                  <div className="h-4 w-32 rounded bg-stone-200/80 dark:bg-stone-800" />
                  <div className="h-3 w-48 rounded bg-stone-100 dark:bg-stone-800/60" />
                </div>
                <div className="h-5 w-9 rounded-full bg-stone-200/80 dark:bg-stone-800" />
              </div>
            ))}
          </div>
        ) : !items.length ? (
          <SettingsEmptyState>{_('dictionary.empty')}</SettingsEmptyState>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={({ active, over }) => {
              if (!over || active.id === over.id || mutation.isPending) return
              const from = items.findIndex((item) => item.id === active.id)
              const to = items.findIndex((item) => item.id === over.id)
              if (from >= 0 && to >= 0) {
                mutation.mutate(
                  { kind: 'order', ids: arrayMove(items, from, to).map((item) => item.id) },
                  { onError: failed },
                )
              }
            }}
          >
            <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
              <ul className="space-y-2">
                {items.map((item) => (
                  <DictionaryRow
                    key={item.id}
                    item={item}
                    isOwner={isOwner}
                    editing={editing}
                    disabled={mutation.isPending}
                    onToggle={(enabled) =>
                      mutation.mutate({ kind: 'toggle', id: item.id, enabled }, { onError: failed })
                    }
                    onEdit={() => setEditingItem(item)}
                    onDelete={() => setDeleting(item)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </SettingsCard>
      {user && ownsState && editingItem && (
        <DictionaryEditor
          item={editingItem}
          isOwner={isOwner}
          saving={mutation.isPending}
          onClose={() => setEditingItem(null)}
          onSave={async ({ name, scope }) => {
            try {
              await mutation.mutateAsync({ kind: 'update', id: editingItem.id, name, scope })
              if (useAuthStore.getState().user?.id !== user.id) return
              setEditingItem(null)
              notify.success({ key: 'dictionary.saved' })
            } catch (error) {
              failed(error)
            }
          }}
        />
      )}
      {user && ownsState && deleting && (
        <ConfirmDialog
          title={_('settings.confirmDeleteTitle')}
          message={_('dictionary.deleteConfirm', { name: deleting.name })}
          confirmLabel={_('settings.confirmDeleteAction')}
          confirmVariant="danger"
          confirmDisabled={mutation.isPending}
          onClose={() => {
            if (!mutation.isPending) setDeleting(null)
          }}
          onConfirm={async () => {
            try {
              await mutation.mutateAsync({ kind: 'delete', id: deleting.id })
              if (useAuthStore.getState().user?.id !== user.id) return
              setDeleting(null)
              notify.success({ key: 'dictionary.deleted' })
            } catch (error) {
              failed(error)
            }
          }}
        />
      )}
    </>
  )
}

