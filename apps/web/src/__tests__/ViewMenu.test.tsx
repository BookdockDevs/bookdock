import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import i18n from '../i18n/i18n'
import { useUiStore } from '@/stores/ui.store'
import { useAuthStore } from '@/stores/auth.store'
import ViewMenu from '../features/library/components/ViewMenu'

const libraryPrefsMutate = vi.fn()
vi.mock('../features/library/hooks', () => ({
  useUpdateLibraryPrefs: () => ({ mutate: libraryPrefsMutate }),
}))

function renderMenu(props: Partial<Parameters<typeof ViewMenu>[0]> = {}) {
  const navSearch = vi.fn()
  render(
    <ViewMenu
      navSearch={navSearch}
      view="grid"
      sortBy="createdAt"
      sortOrder="desc"
      format={null}
      readStatus={null}
      {...props}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: '视图菜单' }))
  return navSearch
}

beforeEach(async () => {
  localStorage.clear()
  useUiStore.setState({ coverText: true, coverFit: 'crop', recentlyReadStyle: 'cards', sortBy: 'createdAt', sortOrder: 'desc', listInfoItems: ['progress'] })
  await i18n.changeLanguage('zh-CN')
})

describe('ViewMenu sort chips', () => {
  it('renders all six sort fields as chips with the active one showing direction', () => {
    renderMenu()

    for (const label of ['添加时间', '书名', '作者', '大小', '进度', '最近阅读']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    const active = screen.getByRole('button', { name: '添加时间' })
    expect(active).toHaveAttribute('aria-pressed', 'true')
    expect(active.textContent).toContain('↓')
  })

  it('toggles direction when clicking the active chip', () => {
    const navSearch = renderMenu()

    fireEvent.click(screen.getByRole('button', { name: '添加时间' }))
    expect(navSearch).toHaveBeenCalledWith({ sortOrder: 'asc' })
    expect(useUiStore.getState().sortOrder).toBe('asc')
  })

  it('switches field with its default order when clicking an inactive chip', () => {
    const navSearch = renderMenu()

    fireEvent.click(screen.getByRole('button', { name: '书名' }))
    expect(navSearch).toHaveBeenCalledWith({ sortBy: 'title', sortOrder: 'asc' })
    expect(useUiStore.getState().sortBy).toBe('title')
  })

  it('persists the default sort to server settings for signed-in users', () => {
    // Signed-in users write the N-06 bookSort preference server-side instead
    // of the device-local ui.store layer.
    useAuthStore.setState({ user: { id: 'u1', username: 'tester', role: 'member' } })
    try {
      const navSearch = renderMenu()

      fireEvent.click(screen.getByRole('button', { name: '书名' }))
      expect(libraryPrefsMutate).toHaveBeenCalledWith({ bookSort: { field: 'title', dir: 'asc' } })
      expect(navSearch).toHaveBeenCalledWith({ sortBy: 'title', sortOrder: 'asc' })
      expect(useUiStore.getState().sortBy).toBe('createdAt')
    } finally {
      useAuthStore.setState({ user: null })
    }
  })
})

describe('ViewMenu recently read segmented control', () => {
  it('renders the three options with the stored one active', () => {
    renderMenu()

    expect(screen.getByRole('button', { name: '关闭' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: '封面行' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: '卡片行' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('updates the store and persists the choice', () => {
    renderMenu()

    fireEvent.click(screen.getByRole('button', { name: '封面行' }))
    expect(useUiStore.getState().recentlyReadStyle).toBe('covers')
    expect(localStorage.getItem('bd-recently-read-style')).toBe('covers')
    expect(screen.getByRole('button', { name: '封面行' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(useUiStore.getState().recentlyReadStyle).toBe('off')
    expect(localStorage.getItem('bd-recently-read-style')).toBe('off')
  })

  it('stays visible in list view', () => {
    renderMenu({ view: 'list' })
    expect(screen.getByRole('button', { name: '封面行' })).toBeInTheDocument()
  })
})

describe('ViewMenu cover prefs', () => {
  it('renders the card-text toggle and fit options with stored values', () => {
    renderMenu()

    expect(screen.getByRole('switch', { name: '卡片文字' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: '裁切填充' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '完整显示' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('toggles card text in the store and persists it', () => {
    renderMenu()

    fireEvent.click(screen.getByRole('switch', { name: '卡片文字' }))
    expect(useUiStore.getState().coverText).toBe(false)
    expect(localStorage.getItem('bd-cover-text')).toBe('false')
  })

  it('switches cover fit independently of the card-text toggle', () => {
    renderMenu()

    fireEvent.click(screen.getByRole('switch', { name: '卡片文字' }))
    fireEvent.click(screen.getByRole('button', { name: '完整显示' }))
    expect(useUiStore.getState().coverText).toBe(false)
    expect(useUiStore.getState().coverFit).toBe('full')
    expect(localStorage.getItem('bd-cover-fit')).toBe('full')
    expect(screen.getByRole('button', { name: '完整显示' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('hides the cover options in list view', () => {
    renderMenu({ view: 'list' })
    expect(screen.queryByRole('switch', { name: '卡片文字' })).toBeNull()
    expect(screen.queryByRole('button', { name: '裁切填充' })).toBeNull()
  })
})

describe('ViewMenu list info toggles', () => {
  it('shows the six toggles only in list view, progress on by default', () => {
    renderMenu({ view: 'list' })
    expect(screen.getByText('列表信息')).toBeInTheDocument()
    // 书架/标签 only exist in the list-info group; the other four labels
    // collide with the always-visible sort chips
    expect(screen.getByRole('button', { name: '书架' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: '标签' })).toHaveAttribute('aria-pressed', 'false')
    expect(useUiStore.getState().listInfoItems).toEqual(['progress'])
  })

  it('hides the toggle group in grid view', () => {
    renderMenu({ view: 'grid' })
    expect(screen.queryByText('列表信息')).toBeNull()
    expect(screen.queryByRole('button', { name: '书架' })).toBeNull()
  })

  it('toggles an item in the store and persists it', () => {
    renderMenu({ view: 'list' })

    fireEvent.click(screen.getByRole('button', { name: '书架' }))
    expect(useUiStore.getState().listInfoItems).toEqual(['progress', 'shelf'])
    expect(localStorage.getItem('bd-list-info-items')).toBe('["progress","shelf"]')
    expect(screen.getByRole('button', { name: '书架' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: '书架' }))
    expect(useUiStore.getState().listInfoItems).toEqual(['progress'])
  })
})

describe('ViewMenu columns segmented control', () => {
  it('renders auto and 2-8 column options in grid view with current active', () => {
    useUiStore.setState({ gridColumns: '4' })
    renderMenu({ view: 'grid' })

    expect(screen.getByRole('button', { name: '自适应' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: '4' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('switches column count in the store when clicked', () => {
    renderMenu({ view: 'grid' })

    fireEvent.click(screen.getByRole('button', { name: '5' }))
    expect(useUiStore.getState().gridColumns).toBe('5')
    expect(screen.getByRole('button', { name: '5' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: '自适应' }))
    expect(useUiStore.getState().gridColumns).toBe('auto')
    expect(screen.getByRole('button', { name: '自适应' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('hides column options in list view', () => {
    renderMenu({ view: 'list' })
    expect(screen.queryByRole('button', { name: '自适应' })).toBeNull()
  })
})
