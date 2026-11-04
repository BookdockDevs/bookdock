import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

import type { ChartDisplayMode } from './TaxonomyCharts'

export interface ModeOption {
  key: ChartDisplayMode
  label: string
  icon: ReactNode
}

// 严格参考图一绘制的 5 个图标
const CHART_MODE_OPTIONS: ModeOption[] = [
  {
    key: 'bar',
    label: '柱状图',
    icon: (
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <line x1="3" y1="20" x2="21" y2="20" />
        <path d="M7 20V12" />
        <path d="M12 20V6" />
        <path d="M17 20V15" />
      </svg>
    ),
  },
  {
    key: 'donut',
    label: '环形图',
    icon: (
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
        <path d="M22 12A10 10 0 0 0 12 2v10z" />
      </svg>
    ),
  },
  {
    key: 'wordcloud',
    label: '词云',
    icon: (
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
      </svg>
    ),
  },
  {
    key: 'treemap',
    label: '矩形树图',
    icon: (
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect width="6.5" height="6.5" x="3.5" y="3.5" rx="1.5" />
        <rect width="6.5" height="6.5" x="14" y="3.5" rx="1.5" />
        <rect width="6.5" height="6.5" x="14" y="14" rx="1.5" />
        <rect width="6.5" height="6.5" x="3.5" y="14" rx="1.5" />
      </svg>
    ),
  },
  {
    key: 'radar',
    label: '雷达图',
    icon: (
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4.93 19.07a10 10 0 0 1 0-14.14" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        <path d="M7.76 16.24a6 6 0 0 1 0-8.48" />
        <path d="M16.24 7.76a6 6 0 0 1 0 8.48" />
        <circle cx="12" cy="12" r="2" />
      </svg>
    ),
  },
]

interface ChartModeMenuListProps {
  currentMode: ChartDisplayMode
  onSelect: (mode: ChartDisplayMode) => void
}

export default function ChartModeMenuList({
  currentMode,
  onSelect,
}: ChartModeMenuListProps) {
  return (
    <div className="flex flex-col divide-y divide-stone-100 dark:divide-stone-800">
      {CHART_MODE_OPTIONS.map((opt) => {
        const isSelected = currentMode === opt.key
        return (
          <button
            key={opt.key}
            type="button"
            role="menuitem"
            onClick={() => onSelect(opt.key)}
            className={cn(
              'flex w-full items-center justify-between px-3.5 py-2.5 text-xs font-medium transition-colors cursor-pointer text-left',
              isSelected
                ? 'bg-stone-50/80 text-stone-900 font-semibold dark:bg-stone-800/80 dark:text-stone-100'
                : 'text-stone-600 hover:bg-stone-50 dark:text-stone-400 dark:hover:bg-stone-800/50',
            )}
          >
            {/* 图标在文字左侧 */}
            <span className="flex items-center gap-2.5">
              <span
                className={cn(
                  'shrink-0',
                  isSelected
                    ? 'text-stone-900 dark:text-stone-100'
                    : 'text-stone-400 dark:text-stone-500',
                )}
              >
                {opt.icon}
              </span>
              <span>{opt.label}</span>
            </span>

            {/* 表示选中的勾放在右侧 */}
            {isSelected ? (
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-stone-900 dark:text-stone-100 shrink-0"
                aria-hidden="true"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <span className="w-4 shrink-0" />
            )}
          </button>
        )
      })}
    </div>
  )
}
