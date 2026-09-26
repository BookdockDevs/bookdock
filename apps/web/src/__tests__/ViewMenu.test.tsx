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
  useUiStore.setState({ coverText: true, gridCardFields: ['title', 'author', 'progress'], libraryPageSize: 24, coverFit: 'crop', recentlyReadStyle: 'cards', sortBy: 'createdAt', sortOrder: 'desc', listInfoItems: ['progress'] })
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

describe('ViewMenu cover and card field prefs', () => {
  it('renders card field buttons and fit options with stored values', () => {
    renderMenu({ defaultTab: 'viewLayout' })

    expect(screen.getByRole('button', { name: '书名' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '作者' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '进度' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '裁剪' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '完整' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('toggles card fields in the store and persists it', () => {
    renderMenu({ defaultTab: 'viewLayout' })

    fireEvent.click(screen.getByRole('button', { name: '进度' }))
    expect(useUiStore.getState().gridCardFields).toEqual(['title', 'author'])
    expect(localStorage.getItem('bd-grid-card-fields')).toBe(JSON.stringify(['title', 'author']))
  })

  it('switches cover fit independently of card fields', () => {
    renderMenu({ defaultTab: 'viewLayout' })

    fireEvent.click(screen.getByRole('button', { name: '书名' }))
    fireEvent.click(screen.getByRole('button', { name: '完整' }))
    expect(useUiStore.getState().gridCardFields).toEqual(['author', 'progress'])
    expect(useUiStore.getState().coverFit).toBe('full')
    expect(localStorage.getItem('bd-cover-fit')).toBe('full')
    expect(screen.getByRole('button', { name: '完整' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('hides the grid card options in list view', () => {
    renderMenu({ defaultTab: 'viewLayout', view: 'list' })
    expect(screen.queryByRole('button', { name: '书名' })).toBeNull()
    expect(screen.queryByRole('button', { name: '裁剪' })).toBeNull()
  })

  it('renders page size selector and allows changing page size', () => {
    renderMenu({ defaultTab: 'viewLayout' })
    expect(screen.getByRole('button', { name: '24' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '48' }))
    expect(useUiStore.getState().libraryPageSize).toBe(48)
    expect(localStorage.getItem('bd-library-page-size')).toBe('48')
  })
})

describe('ViewMenu list info toggles', () => {
  it('shows the six toggles only in list view, progress on by default', () => {
    renderMenu({ defaultTab: 'viewLayout', view: 'list' })
    expect(screen.getByText('列表信息')).toBeInTheDocument()
    // 书架/标签 only exist in the list-info group; the other four labels
    // collide with the always-visible sort chips
    expect(screen.getByRole('button', { name: '书架' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: '标签' })).toHaveAttribute('aria-pressed', 'false')
    expect(useUiStore.getState().listInfoItems).toEqual(['progress'])
  })

  it('hides the toggle group in grid view', () => {
    renderMenu({ defaultTab: 'viewLayout', view: 'grid' })
    expect(screen.queryByText('列表信息')).toBeNull()
    expect(screen.queryByRole('button', { name: '书架' })).toBeNull()
  })

  it('toggles an item in the store and persists it', () => {
    renderMenu({ defaultTab: 'viewLayout', view: 'list' })

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
    renderMenu({ defaultTab: 'viewLayout', view: 'grid' })

    expect(screen.getByRole('button', { name: '自适应' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: '4' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('switches column count in the store when clicked', () => {
    renderMenu({ defaultTab: 'viewLayout', view: 'grid' })

    fireEvent.click(screen.getByRole('button', { name: '6' }))
    expect(useUiStore.getState().gridColumns).toBe('6')
    expect(screen.getByRole('button', { name: '6' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: '自适应' }))
    expect(useUiStore.getState().gridColumns).toBe('auto')
    expect(screen.getByRole('button', { name: '自适应' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('hides column options in list view', () => {
    renderMenu({ defaultTab: 'viewLayout', view: 'list' })
    expect(screen.queryByRole('button', { name: '自适应' })).toBeNull()
  })
})
