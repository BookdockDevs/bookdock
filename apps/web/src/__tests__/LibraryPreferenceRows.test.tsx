import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import i18n from '../i18n/i18n'
import LibraryPreferenceRows from '@/features/settings/components/LibraryPreferenceRows'
import * as libraryHooks from '@/features/library/hooks'

vi.mock('@/features/library/hooks', () => ({
  useLibraryPrefs: vi.fn(),
  useUpdateLibraryPrefs: vi.fn(),
}))

vi.mock('@/lib/notifications', () => ({
  notify: {
    warning: vi.fn(),
  },
}))

describe('LibraryPreferenceRows', () => {
  const mutate = vi.fn()

  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage('zh-CN')
    vi.mocked(libraryHooks.useUpdateLibraryPrefs).mockReturnValue({ mutate } as never)
  })

  it('renders sidebar navigation module pills and sorts correctly', () => {
    vi.mocked(libraryHooks.useLibraryPrefs).mockReturnValue({
      readingStatsEnabled: true,
      recentlyReadStyle: 'off',
      shelfSort: { mode: 'manual' },
      categorySort: { mode: 'name', dir: 'asc' },
      tagSort: { mode: 'bookCount', dir: 'desc' },
      sidebarModules: ['shelves', 'categories', 'tags'],
    } as never)

    render(<LibraryPreferenceRows />)

    expect(screen.getByText('侧栏导航项')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /书架/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('checkbox', { name: /分类/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('checkbox', { name: /标签/ })).toHaveAttribute('aria-checked', 'true')

    expect(screen.getByText('书架排序')).toBeInTheDocument()
    expect(screen.getByText('分类排序')).toBeInTheDocument()
    expect(screen.getByText('标签排序')).toBeInTheDocument()
  })

  it('toggles sidebar module off when clicked', () => {
    vi.mocked(libraryHooks.useLibraryPrefs).mockReturnValue({
      sidebarModules: ['shelves', 'categories', 'tags'],
    } as never)

    render(<LibraryPreferenceRows />)

    fireEvent.click(screen.getByRole('checkbox', { name: /书架/ }))
    expect(mutate).toHaveBeenCalledWith({ sidebarModules: ['categories', 'tags'] })
  })

  it('prevents deselecting the last remaining module and warns user', async () => {
    const { notify } = await import('@/lib/notifications')
    vi.mocked(libraryHooks.useLibraryPrefs).mockReturnValue({
      sidebarModules: ['categories'],
    } as never)

    render(<LibraryPreferenceRows />)

    fireEvent.click(screen.getByRole('checkbox', { name: /分类/ }))
    expect(mutate).not.toHaveBeenCalled()
    expect(notify.warning).toHaveBeenCalled()
  })

  it('hides sorting section for modules that are disabled', () => {
    vi.mocked(libraryHooks.useLibraryPrefs).mockReturnValue({
      sidebarModules: ['categories'],
    } as never)

    render(<LibraryPreferenceRows />)

    expect(screen.queryByText('书架排序')).toBeNull()
    expect(screen.getByText('分类排序')).toBeInTheDocument()
    expect(screen.queryByText('标签排序')).toBeNull()
  })

  it('preserves canonical order (shelves -> categories -> tags) when re-enabling modules', () => {
    vi.mocked(libraryHooks.useLibraryPrefs).mockReturnValue({
      sidebarModules: ['tags'],
    } as never)

    render(<LibraryPreferenceRows />)

    fireEvent.click(screen.getByRole('checkbox', { name: /分类/ }))
    expect(mutate).toHaveBeenCalledWith({ sidebarModules: ['categories', 'tags'] })
  })
})
