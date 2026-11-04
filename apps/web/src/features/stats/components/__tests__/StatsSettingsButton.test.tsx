import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useUiStore } from '@/stores/ui.store'
import StatsSettingsButton from '../StatsSettingsButton'

const translations: Record<string, string> = {
  'stats.settings': '阅读数据设置',
  'stats.bookSettings': '阅读计时设置',
  'stats.restoreDefaults': '恢复默认',
  'settings.restoreDefaults': '恢复默认',
  'settings.readingTimerAuto': '自动记录阅读时长',
  'settings.readingTimerAutoHint': '根据阅读与翻页行为无感自动统计有效时长',
  'settings.readingTimerManual': '显示手动计时按钮',
  'settings.readingTimerManualHint': '在阅读界面提供悬浮计时药丸，支持随时手动起止与暂停',
  'settings.readingTimerGrace': '暂存宽限',
  'settings.readingTimerGraceHint': '离开阅读页后会话挂起的保留时间，超时自动终止',
  'settings.readingTimerGrace1': '1 分钟',
  'settings.readingTimerGrace5': '5 分钟',
  'settings.readingTimerGrace10': '10 分钟',
  'settings.readingTimerGrace30': '30 分钟',
  'stats.moduleSettings': '数据模块',
  'stats.moduleSettingsHint': '调整总览页模块显示与顺序',
  'stats.hideModule': '隐藏',
  'stats.showModule': '显示',
  'stats.dragModule': '拖拽排序',
  'stats.modules.summary': '数据总览',
  'stats.modules.trend': '阅读趋势',
  'stats.modules.hours': '时间分布图',
  'stats.modules.categories': '书籍分类',
  'stats.modules.tags': '书籍标签',
  'stats.modules.books': '阅读的书籍',
}

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => translations[key] ?? key,
}))

describe('StatsSettingsButton', () => {
  beforeEach(() => {
    useUiStore.setState({
      readingTimerMode: 'auto',
      manualTimerGraceMinutes: 5,
    })
  })

  it('opens modal on click and renders timer toggles', () => {
    render(<StatsSettingsButton />)
    const btn = screen.getByRole('button', { name: '阅读数据设置' })
    fireEvent.click(btn)

    // Modal is open
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // Auto is checked (true), Manual is unchecked (false)
    const autoSwitch = screen.getByRole('switch', { name: '自动记录阅读时长' })
    const manualSwitch = screen.getByRole('switch', { name: '显示手动计时按钮' })

    expect(autoSwitch).toHaveAttribute('aria-checked', 'true')
    expect(manualSwitch).toHaveAttribute('aria-checked', 'false')

    // Automatic capture uses the same grace setting.
    expect(screen.getByRole('group', { name: '暂存宽限' })).toBeInTheDocument()

    // Turn manual on -> mode should become 'both'
    fireEvent.click(manualSwitch)
    expect(useUiStore.getState().readingTimerMode).toBe('both')

    // Now grace minutes should be visible
    expect(screen.getByRole('group', { name: '暂存宽限' })).toBeInTheDocument()

    // Turn auto off -> mode should become 'manual'
    fireEvent.click(autoSwitch)
    expect(useUiStore.getState().readingTimerMode).toBe('manual')

    // Turn manual off -> mode should become 'off'
    fireEvent.click(manualSwitch)
    expect(useUiStore.getState().readingTimerMode).toBe('off')
    expect(screen.queryByRole('group', { name: '暂存宽限' })).not.toBeInTheDocument()
  })

  it('updates the shared grace when automatic capture is enabled', () => {
    useUiStore.setState({
      readingTimerMode: 'auto',
      manualTimerGraceMinutes: 5,
    })

    render(<StatsSettingsButton />)
    fireEvent.click(screen.getByRole('button', { name: '阅读数据设置' }))

    const tenMinBtn = screen.getByRole('button', { name: '10 分钟' })
    fireEvent.click(tenMinBtn)

    expect(useUiStore.getState().manualTimerGraceMinutes).toBe(10)
  })

  it('renders module sortable list and toggles module visibility when bookId is not provided', () => {
    useUiStore.setState({
      statsModuleOrder: ['summary', 'trend', 'heatmap', 'hours', 'categories', 'tags', 'books'],
      statsHiddenModules: [],
    })

    render(<StatsSettingsButton />)
    fireEvent.click(screen.getByRole('button', { name: '阅读数据设置' }))

    // In default state, "恢复默认" button is hidden
    expect(screen.queryByRole('button', { name: '恢复默认' })).not.toBeInTheDocument()

    // All modules should be displayed
    expect(screen.getByText('数据总览')).toBeInTheDocument()
    expect(screen.getByText('阅读趋势')).toBeInTheDocument()
    expect(screen.getByText('时间分布图')).toBeInTheDocument()
    expect(screen.getByText('书籍分类')).toBeInTheDocument()
    expect(screen.getByText('书籍标签')).toBeInTheDocument()
    expect(screen.getByText('阅读的书籍')).toBeInTheDocument()

    // Toggle hours module visibility
    const hideHoursBtn = screen.getByRole('button', { name: '隐藏 时间分布图' })
    fireEvent.click(hideHoursBtn)

    expect(useUiStore.getState().statsHiddenModules).toContain('hours')

    // Now modified -> "恢复默认" should appear
    const resetBtn = screen.getByRole('button', { name: '恢复默认' })
    expect(resetBtn).toBeInTheDocument()

    // Click reset -> hidden modules cleared, button hides
    fireEvent.click(resetBtn)
    expect(useUiStore.getState().statsHiddenModules).toEqual([])
    expect(screen.queryByRole('button', { name: '恢复默认' })).not.toBeInTheDocument()
  })

  it('does not render module list when bookId is provided (single book detail view)', () => {
    render(<StatsSettingsButton bookId="book-123" />)
    fireEvent.click(screen.getByRole('button', { name: '阅读计时设置' }))

    expect(screen.queryByText('数据总览')).not.toBeInTheDocument()
    expect(screen.queryByText('书籍分类')).not.toBeInTheDocument()
  })
})
