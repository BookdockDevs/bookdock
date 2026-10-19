import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useUiStore } from '@/stores/ui.store'
import StatsSettingsButton from '../StatsSettingsButton'

const translations: Record<string, string> = {
  'stats.settings': '统计设置',
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
  'readingData.dataManagement': '阅读数据管理',
  'readingData.dataManagementHint': '备份您的完整阅读数据，或从备份文件还原历史记录',
}

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => translations[key] ?? key,
}))

vi.mock('@/features/archive/components/ReadingTransferControls', () => ({
  default: ({ bookId, onDeleteArchive }: { bookId?: string; onDeleteArchive?: () => void }) => (
    <div data-testid="mock-transfer-controls" data-bookid={bookId}>
      {onDeleteArchive && (
        <button type="button" onClick={onDeleteArchive} data-testid="mock-delete-archive-btn">
          Delete Archive
        </button>
      )}
    </div>
  ),
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
    const btn = screen.getByRole('button', { name: '统计设置' })
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

    // Data management section is present
    expect(screen.getByTestId('mock-transfer-controls')).toBeInTheDocument()
  })

  it('updates the shared grace when automatic capture is enabled', () => {
    useUiStore.setState({
      readingTimerMode: 'auto',
      manualTimerGraceMinutes: 5,
    })

    render(<StatsSettingsButton />)
    fireEvent.click(screen.getByRole('button', { name: '统计设置' }))

    const tenMinBtn = screen.getByRole('button', { name: '10 分钟' })
    fireEvent.click(tenMinBtn)

    expect(useUiStore.getState().manualTimerGraceMinutes).toBe(10)
  })

  it('renders book-specific section and forwards onBookDeleted when bookId is provided', () => {
    const onBookDeleted = vi.fn()
    render(<StatsSettingsButton bookId="book-123" onBookDeleted={onBookDeleted} />)
    fireEvent.click(screen.getByRole('button', { name: '统计设置' }))

    expect(screen.getByText('readingData.bookDataManagement')).toBeInTheDocument()
    expect(screen.getByText('readingData.bookDataManagementHint')).toBeInTheDocument()

    const controls = screen.getByTestId('mock-transfer-controls')
    expect(controls).toHaveAttribute('data-bookid', 'book-123')

    // Trigger delete archive callback
    fireEvent.click(screen.getByTestId('mock-delete-archive-btn'))
    expect(onBookDeleted).toHaveBeenCalled()
    // Modal should close
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
