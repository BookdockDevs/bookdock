import { useMemo } from 'react'
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  arrayMove,
  useSortable,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  DEFAULT_SELECTION_TOOLBAR_ORDER,
  type SelectionToolbarActionKey,
} from '@bookdock/shared'

import { useUiStore } from '@/stores/ui.store'
import { notify } from '@/lib/notifications'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'
import {
  AiSparkleIcon,
  BulbIcon,
  CopyIcon,
  DictionaryIcon,
  ExcerptShareIcon,
  ReplaceIcon,
  SearchIcon,
  StyleGlyph,
  TranslateIcon,
  TtsIcon,
} from '@/features/reader/components/annotation-icons'

interface SortableActionItemProps {
  actionKey: SelectionToolbarActionKey
  enabled: boolean
  canDisable: boolean
  title: string
  icon: React.ReactNode
  onToggle: (key: SelectionToolbarActionKey) => void
}

function SortableActionItem({
  actionKey,
  enabled,
  canDisable,
  title,
  icon,
  onToggle,
}: SortableActionItemProps) {
  const _ = useTranslation()
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: actionKey })

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  }

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (enabled && !canDisable) {
      notify.warning(_('settings.selectionToolbarAtLeastOne'))
      return
    }
    onToggle(actionKey)
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group relative flex shrink-0 items-center justify-center select-none touch-manipulation',
        isDragging && 'z-30 scale-110 opacity-90',
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        title={title}
        aria-label={title}
        aria-pressed={enabled}
        onClick={handleClick}
        className={cn(
          'relative flex h-7 w-7 items-center justify-center rounded-md transition-all cursor-grab active:cursor-grabbing',
          enabled
            ? 'bg-white text-stone-800 shadow-xs hover:bg-stone-50 hover:text-stone-900 active:scale-95 dark:bg-stone-700 dark:text-stone-100 dark:hover:bg-stone-600'
            : 'text-stone-400 opacity-30 hover:opacity-60 dark:text-stone-500',
        )}
      >
        <span className="flex items-center justify-center scale-[0.82] pointer-events-none">
          {icon}
        </span>
      </button>
    </div>
  )
}

export default function SelectionToolbarPreferenceRow() {
  const _ = useTranslation()
  const order = useUiStore((s) => s.selectionToolbarOrder)
  const hidden = useUiStore((s) => s.selectionToolbarHidden)
  const setOrder = useUiStore((s) => s.setSelectionToolbarOrder)
  const toggleActionVisible = useUiStore((s) => s.toggleSelectionToolbarActionVisible)
  const resetSelectionToolbar = useUiStore((s) => s.resetSelectionToolbar)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const actionMeta = useMemo<Record<SelectionToolbarActionKey, { title: string; icon: React.ReactNode }>>(() => ({
    highlight: {
      title: `${_('annotation.drawHighlight')} / ${_('annotation.deleteHighlight')}`,
      icon: <StyleGlyph style="highlight" />,
    },
    note: {
      title: _('annotation.writeNote'),
      icon: <BulbIcon />,
    },
    copy: {
      title: _('annotation.copy'),
      icon: <CopyIcon />,
    },
    dictionary: {
      title: _('dictionary.title'),
      icon: <DictionaryIcon />,
    },
    translate: {
      title: _('translation.title'),
      icon: <TranslateIcon size={18} />,
    },
    search: {
      title: _('reader.search'),
      icon: <SearchIcon />,
    },
    'ai-chat': {
      title: _('reader.aiChatSelection'),
      icon: <AiSparkleIcon />,
    },
    'ai-commands': {
      title: _('reader.aiQuickCommands'),
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m13 2-8 12h7l-1 8 8-12h-7z" />
        </svg>
      ),
    },
    tts: {
      title: _('reader.ttsFromSelection'),
      icon: <TtsIcon />,
    },
    share: {
      title: _('annotation.shareExcerpt'),
      icon: <ExcerptShareIcon />,
    },
    replace: {
      title: _('annotation.replace'),
      icon: <ReplaceIcon />,
    },
  }), [_])

  const enabledCount = order.length - hidden.length
  const isOrderModified =
    order.length !== DEFAULT_SELECTION_TOOLBAR_ORDER.length ||
    order.some((key, i) => key !== DEFAULT_SELECTION_TOOLBAR_ORDER[i])
  const isModified = hidden.length > 0 || isOrderModified

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = order.indexOf(active.id as SelectionToolbarActionKey)
    const newIndex = order.indexOf(over.id as SelectionToolbarActionKey)
    if (oldIndex !== -1 && newIndex !== -1) {
      setOrder(arrayMove(order, oldIndex, newIndex))
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
      <div className="min-w-0">
        <div className="flex h-5 items-center gap-2">
          <p className="text-sm font-medium leading-5 text-stone-700 dark:text-stone-200">
            {_('settings.prefSelectionToolbar')}
          </p>
          {isModified && (
            <button
              type="button"
              onClick={resetSelectionToolbar}
              className="inline-flex h-5 items-center gap-1 rounded-md bg-stone-100 px-1.5 text-[11px] font-medium leading-none text-stone-500 hover:bg-stone-200/80 hover:text-stone-800 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-200 transition-colors shadow-2xs"
              title={_('settings.resetDefault')}
              aria-label={_('settings.resetDefault')}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
              <span>{_('settings.resetDefault')}</span>
            </button>
          )}
        </div>
        <p className="mt-0.5 text-xs leading-4 text-stone-400 dark:text-stone-500">
          {_('settings.prefSelectionToolbarHint')}
        </p>
      </div>

      <div
        className="inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-stone-100 p-0.5 dark:bg-stone-800"
        role="group"
        aria-label={_('settings.prefSelectionToolbar')}
      >
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={order} strategy={horizontalListSortingStrategy}>
            {order.map((key) => (
              <SortableActionItem
                key={key}
                actionKey={key}
                enabled={!hidden.includes(key)}
                canDisable={enabledCount > 1}
                title={actionMeta[key]?.title ?? key}
                icon={actionMeta[key]?.icon}
                onToggle={toggleActionVisible}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>
    </div>
  )
}
