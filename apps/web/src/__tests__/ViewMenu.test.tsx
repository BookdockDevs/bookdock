import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import i18n from '../i18n/i18n'
import { useUiStore } from '@/stores/ui.store'
import { useAuthStore } from '@/stores/auth.store'
import ViewMenu from '../features/library/components/ViewMenu'

const libraryPrefsMutate = vi.fn()
let libraryPrefs: { gridCardFields?: Array<'title' | 'author' | 'progress'> } = {}
vi.mock('../features/library/hooks', () => ({
  useUpdateLibraryPrefs: () => ({ mutate: libraryPrefsMutate }),
  useLibraryPrefs: () => libraryPrefs,
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
  libraryPrefs = { gridCardFields: ['title', 'author', 'progress'] }
  useUiStore.setState({ libraryPageSize: 24, coverFit: 'crop', sortBy: 'createdAt', sortOrder: 'desc', listInfoItems: ['progress'] })
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

  it('sends the card field set to the server so it follows the user', () => {
    renderMenu({ defaultTab: 'viewLayout' })

    fireEvent.click(screen.getByRole('button', { name: '进度' }))
    expect(libraryPrefsMutate).toHaveBeenCalledWith({ gridCardFields: ['title', 'author'] })
    expect(localStorage.getItem('bd-grid-card-fields')).toBeNull()
  })

  it('switches cover fit independently of card fields', () => {
    renderMenu({ defaultTab: 'viewLayout' })

    fireEvent.click(screen.getByRole('button', { name: '书名' }))
    fireEvent.click(screen.getByRole('button', { name: '完整' }))
    expect(libraryPrefsMutate).toHaveBeenCalledWith({ gridCardFields: ['author', 'progress'] })
    expect(useUiStore.getState().coverFit).toBe('full')
    expect(localStorage.getItem('bd-cover-fit')).toBe('full')
    expect(screen.getByRole('button', { name: '完整' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('hides the grid card options in list view', () => {
    renderMenu({ defaultTab: 'viewLayout', view: 'list' })
    expect(screen.queryByRole('button', { name: '书名' })).toBeNull()
    expect(screen.queryByRole('button', { name: '裁剪' })).toBeNull()
  })

  it('offers title and author card fields, but not progress, in catalog grid view', () => {
    renderMenu({ defaultTab: 'viewLayout', view: 'grid', catalogMode: true })

    expect(screen.getByText('卡片信息')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '书名' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '作者' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '进度' })).toBeNull()
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

  it('offers only fillable columns in catalog mode, with shelf relabeled as category', () => {
    renderMenu({ defaultTab: 'viewLayout', view: 'list', catalogMode: true })

    expect(screen.getByText('列表信息')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '分类' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '标签' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '大小' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加时间' })).toBeInTheDocument()
    // Reading state has no row to read from in a shared library.
    expect(screen.queryByRole('button', { name: '进度' })).toBeNull()
    expect(screen.queryByRole('button', { name: '最近阅读' })).toBeNull()
    expect(screen.queryByRole('button', { name: '书架' })).toBeNull()
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

describe('ViewMenu hidden-content reveal', () => {
  function signIn() {
    useAuthStore.getState().setAuth({ id: 'u1', username: 'tester', role: 'member' })
  }

  it('toggles the reveal flag for signed-in private libraries', () => {
    signIn()
    try {
      useUiStore.setState({ revealHidden: false })
      renderMenu()

      const toggle = screen.getByRole('switch', { name: '显示隐藏内容' })
      expect(toggle).toHaveAttribute('aria-checked', 'false')
      fireEvent.click(toggle)
      expect(useUiStore.getState().revealHidden).toBe(true)
      expect(toggle).toHaveAttribute('aria-checked', 'true')
    } finally {
      useAuthStore.setState({ user: null })
      useUiStore.setState({ revealHidden: false })
    }
  })

  it('stays out of the filter indicator and reset, like sort order', () => {
    signIn()
    try {
      useUiStore.setState({ revealHidden: true })
      renderMenu()

      // No blue dot on the menu button: a standing preference, not a filter.
      expect(screen.getByRole('button', { name: '视图菜单' }).querySelector('.bg-blue-500')).toBeNull()
    } finally {
      useAuthStore.setState({ user: null })
      useUiStore.setState({ revealHidden: false })
    }
  })

  it('hides the switch for guests, shared libraries and trash', () => {
    renderMenu()
    expect(screen.queryByRole('switch', { name: '显示隐藏内容' })).toBeNull()
  })

  it('hides the switch in catalog mode even when signed in', () => {
    signIn()
    try {
      renderMenu({ catalogMode: true })
      expect(screen.queryByRole('switch', { name: '显示隐藏内容' })).toBeNull()
    } finally {
      useAuthStore.setState({ user: null })
    }
  })

  it('hides the switch in trash even when signed in', () => {
    signIn()
    try {
      renderMenu({ trash: true })
      expect(screen.queryByRole('switch', { name: '显示隐藏内容' })).toBeNull()
    } finally {
      useAuthStore.setState({ user: null })
    }
  })
})


describe('ViewMenu category scope', () => {
  it('defaults to including children and changes only the category scope', () => {
    const navigate = renderMenu({ catalogMode: true, canSwitchCategoryScope: true })
    const toggle = screen.getByRole('switch', { name: '包含子分类' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(toggle)
    expect(navigate).toHaveBeenLastCalledWith({ categoryScope: 'direct' })
  })

  it('enables subtree scope and keeps scope out of filter reset', () => {
    const navigate = renderMenu({ catalogMode: true, canSwitchCategoryScope: true, categoryScope: 'direct', format: 'epub' })
    const toggle = screen.getByRole('switch', { name: '包含子分类' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(toggle)
    expect(navigate).toHaveBeenLastCalledWith({ categoryScope: 'subtree' })
    fireEvent.click(screen.getByText(i18n.t('library.resetFilter')))
    expect(navigate).toHaveBeenLastCalledWith({ format: undefined, status: undefined })
  })

  it('shows no scope switch without eligible children or in private and trash views', () => {
    const props = { navSearch: vi.fn(), view: 'grid', sortBy: 'createdAt', sortOrder: 'desc', format: null, readStatus: null }
    const { rerender } = render(<ViewMenu {...props} catalogMode />)
    fireEvent.click(screen.getByRole('button', { name: '视图菜单' }))
    expect(screen.queryByRole('switch', { name: '包含子分类' })).toBeNull()
    rerender(<ViewMenu {...props} canSwitchCategoryScope />)
    expect(screen.queryByRole('switch', { name: '包含子分类' })).toBeNull()
    rerender(<ViewMenu {...props} catalogMode canSwitchCategoryScope trash />)
    expect(screen.queryByRole('switch', { name: '包含子分类' })).toBeNull()
  })
})
