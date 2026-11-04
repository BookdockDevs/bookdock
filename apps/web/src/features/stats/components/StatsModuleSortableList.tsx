import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui.store'

import {
  STATS_MODULE_DEFAULTS,
  STATS_MODULE_LABELS,
  type StatsModuleKey,
} from '../stats-modules'

interface SortableModuleRowProps {
  moduleKey: StatsModuleKey
  isVisible: boolean
  onToggle: (key: StatsModuleKey) => void
}

function SortableModuleRow({
  moduleKey,
  isVisible,
  onToggle,
}: SortableModuleRowProps) {
  const _ = useTranslation()
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: moduleKey,
    animateLayoutChanges: () => false,
  })

  const transKey = `stats.modules.${moduleKey}`
  const translated = _(transKey)
  const label = translated && translated !== transKey ? translated : STATS_MODULE_LABELS[moduleKey]

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        'group flex items-center justify-between gap-3 px-3.5 py-2 transition-colors',
        isVisible ? 'bg-white/90 dark:bg-stone-900/60' : 'bg-stone-50/60 dark:bg-stone-900/20',
        'hover:bg-stone-50 dark:hover:bg-stone-800/60',
        isDragging && 'relative z-20 rounded-xl shadow-lg ring-2 ring-stone-400/40 bg-white dark:bg-stone-800 opacity-95',
      )}
    >
      {/* 左侧：纯净模块名称，整齐左对齐 */}
      <span
        className={cn(
          'text-sm transition-colors select-none truncate min-w-0',
          isVisible
            ? 'font-medium text-stone-800 dark:text-stone-100'
            : 'text-stone-400 dark:text-stone-500 line-through decoration-stone-300 dark:decoration-stone-600',
        )}
      >
        {label}
      </span>

      {/* 右侧操作区：显隐切换 + 拖拽把手紧凑组合 */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => onToggle(moduleKey)}
          aria-label={`${isVisible ? _('stats.hideModule') : _('stats.showModule')} ${label}`}
          title={isVisible ? _('stats.hideModule') || '隐藏模块' : _('stats.showModule') || '显示模块'}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-lg transition-colors cursor-pointer',
            isVisible
              ? 'text-stone-500 hover:bg-stone-100 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200'
              : 'text-stone-300 hover:bg-stone-100 hover:text-stone-500 dark:text-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-400',
          )}
        >
          {isVisible ? (
            /* Eye (可见) */
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          ) : (
            /* Eye-Off (隐藏) */
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
              <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
              <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
              <line x1="2" x2="22" y1="2" y2="22" />
            </svg>
          )}
        </button>

        {/* 拖拽排序把手 */}
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`${_('stats.dragModule')} ${label}`}
          title={_('stats.dragModule') || '拖拽排序'}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-700/60 dark:hover:text-stone-200 cursor-grab active:cursor-grabbing"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="4" x2="20" y1="8" y2="8" />
            <line x1="4" x2="20" y1="12" y2="12" />
            <line x1="4" x2="20" y1="16" y2="16" />
          </svg>
        </button>
      </div>
    </div>
  )
}

export default function StatsModuleSortableList() {
  const _ = useTranslation()
  const order = useUiStore((s) => s.statsModuleOrder)
  const hidden = useUiStore((s) => s.statsHiddenModules)
  const setOrder = useUiStore((s) => s.setStatsModuleOrder)
  const toggleVisible = useUiStore((s) => s.toggleStatsModuleVisible)
  const reset = useUiStore((s) => s.resetStatsModules)

  const isOrderModified =
    order.length !== STATS_MODULE_DEFAULTS.length ||
    order.some((key, i) => key !== STATS_MODULE_DEFAULTS[i])
  const isModified = hidden.length > 0 || isOrderModified

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

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = order.indexOf(active.id as StatsModuleKey)
    const newIndex = order.indexOf(over.id as StatsModuleKey)
    if (oldIndex !== -1 && newIndex !== -1) {
      setOrder(arrayMove(order, oldIndex, newIndex))
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between pb-1">
        <div>
          <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
            {_('stats.moduleSettings')}
          </h3>
          <p className="mt-0.5 text-xs text-stone-400 dark:text-stone-500">
            {_('stats.moduleSettingsHint')}
          </p>
        </div>
        {isModified && (
          <button
            type="button"
            onClick={reset}
            className="text-xs font-medium text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200 cursor-pointer transition-colors"
          >
            {_('stats.restoreDefaults') || _('settings.restoreDefaults') || '恢复默认'}
          </button>
        )}
      </div>

      {/* 一体化分组圆角列表 (Inset Grouped Card) */}
      <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-2xs dark:border-stone-800 dark:bg-stone-900/60 divide-y divide-stone-100 dark:divide-stone-800/80">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            <div>
              {order.map((key) => (
                <SortableModuleRow
                  key={key}
                  moduleKey={key}
                  isVisible={!hidden.includes(key)}
                  onToggle={toggleVisible}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  )
}
