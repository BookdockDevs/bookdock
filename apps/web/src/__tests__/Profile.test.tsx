import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import Profile from '@/features/profile/Profile'
import { useAuthStore } from '@/stores/auth.store'
import i18n from '@/i18n/i18n'

const mockNavigate = vi.fn()
let profileSearch: { userId?: string; notesPage: number; reviewsPage: number } = { notesPage: 1, reviewsPage: 1 }

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, className, onClick, ['aria-label']: ariaLabel, title }: { children: React.ReactNode; to: string; className?: string; onClick?: React.MouseEventHandler<HTMLAnchorElement>; 'aria-label'?: string; title?: string }) => (
    <a href={to} className={className} onClick={onClick} aria-label={ariaLabel} title={title}>
      {children}
    </a>
  ),
  useNavigate: () => mockNavigate,
  useSearch: () => profileSearch,
  useLocation: () => ({ state: { __TSR_index: 1 } }),
  useRouter: () => ({
    history: {
      canGoBack: () => false,
      back: vi.fn(),
    },
  }),
}))

vi.mock('@/api/hooks/reading-records', () => ({
  useReadingSummary: vi.fn(() => ({
    data: {
      data: {
        totalSeconds: 7200,
        todaySeconds: 1800,
        totalBooks: 5,
        totalDays: 12,
        currentStreak: 3,
        longestStreak: 7,
        totalWordsRead: 45000,
        weekSeconds: 3600,
        prevWeekSeconds: 2000,
        monthSeconds: 7200,
        prevMonthSeconds: 5000,
      },
    },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  })),
}))

const mockProfileMutate = vi.fn()
let profileSettings: { showStats?: boolean; showShowcase?: boolean; showPublicStats?: boolean; showPublicShowcase?: boolean; isPublic?: boolean } = {}

// The settings dialog reads and writes the public profile preferences.
vi.mock('@/features/library/hooks', () => ({
  useProfileSettings: () => profileSettings,
  useUpdateProfileSettings: () => ({ mutate: mockProfileMutate }),
}))

const mockUpdateUsername = vi.fn().mockResolvedValue({})
const mockUpdateBio = vi.fn().mockResolvedValue({})

vi.mock('@/features/auth/hooks', () => ({
  useUploadAvatar: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteAvatar: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateUsername: vi.fn(() => ({ mutateAsync: mockUpdateUsername, isPending: false })),
  useUpdateBio: vi.fn(() => ({ mutateAsync: mockUpdateBio, isPending: false })),
  useChangePassword: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}))

const { mockMyReviews } = vi.hoisted(() => ({
  mockMyReviews: vi.fn((): unknown => ({ data: undefined, isPending: true, isError: false })),
}))

vi.mock('@/features/reviews/hooks/useReviews', () => ({
  useMyReviews: (...args: Array<unknown>) => mockMyReviews(...args),
  useReaderProfile: (userId?: string) => ({
    data: {
      data: {
        author: {
          id: userId ?? 'u1',
          name: userId === 'reader' ? 'Other reader' : 'ReaderMaster',
          avatarKey: null,
          bio: userId === 'reader' ? 'A public bio' : '',
          createdAt: Date.now() - 15 * 24 * 3600 * 1000,
        },
        isOwner: userId !== 'reader',
        visibility: 'public',
        showStats: true,
        showShowcase: true,
        summary: {
          totalSeconds: 7200,
          totalWordsRead: 45000,
          totalBooks: 5,
          finishedBooks: 2,
          totalDays: 12,
          currentStreak: 3,
          longestStreak: 7,
        },
        currentlyReading: [{ id: 'b1', title: '三体', author: '刘慈欣', format: 'epub', coverKey: null, progress: 42 }],
        reviews: { entries: [], page: 1, hasMore: false },
      },
    },
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
}))

vi.mock('@/features/profile/hooks', () => ({
  useNoteArchive: () => ({ data: { data: { entries: [], hasMore: false } }, isPending: false }),
}))

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('Profile Page', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    mockNavigate.mockReset()
    mockUpdateUsername.mockClear()
    mockUpdateBio.mockClear()
    useAuthStore.setState({
      user: {
        id: 'u1',
        username: 'ReaderMaster',
        role: 'owner',
        avatarKey: null,
        createdAt: Date.now() - 15 * 24 * 3600 * 1000, // 15 days ago
      },
    })
    profileSettings = { showStats: true, showShowcase: true, isPublic: true }
    mockProfileMutate.mockClear()
    profileSearch = { notesPage: 1, reviewsPage: 1 }
    mockMyReviews.mockReset()
    mockMyReviews.mockReturnValue({ data: undefined, isPending: true, isError: false })
  })

  it('renders profile hero card with username and member days', () => {
    renderWithQuery(<Profile />)

    expect(screen.getByText('ReaderMaster')).toBeInTheDocument()
    expect(screen.queryByText('所有者')).not.toBeInTheDocument()
    expect(screen.getByText('加入书坞')).toBeInTheDocument()
    expect(screen.getByText(/15/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '个人设置' })).toBeInTheDocument()
    expect(screen.queryByText('修改密码')).not.toBeInTheDocument()
    expect(screen.queryByText('修改')).not.toBeInTheDocument()
  })

  it('renders a visitor profile with the shared homepage sections and no account controls', () => {
    profileSearch = { userId: 'reader', notesPage: 1, reviewsPage: 1 }
    renderWithQuery(<Profile />)
    expect(screen.getByText('Other reader')).toBeInTheDocument()
    expect(screen.getByText('A public bio')).toBeInTheDocument()
    expect(screen.getByText('阅读概览')).toBeInTheDocument()
    expect(screen.getByText('正在阅读')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '个人设置' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /我的书评/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '书库可见书评' })).not.toBeInTheDocument()
    expect(screen.queryByText('全局笔记档案')).not.toBeInTheDocument()
    expect(screen.queryByText('修改密码')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '个人主页' })).toBeInTheDocument()
    expect(screen.queryByText('返回书库')).not.toBeInTheDocument()
    expect(screen.queryByText('前往书库')).not.toBeInTheDocument()
  })

  it('uses history back for a visitor profile and falls back to the library home', () => {
    profileSearch = { userId: 'reader', notesPage: 1, reviewsPage: 1 }
    renderWithQuery(<Profile />)

    fireEvent.click(screen.getByRole('link', { name: '返回书库' }))
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/', replace: true })
  })

  it('renders reading achievements section with summary stats', () => {
    renderWithQuery(<Profile />)

    expect(screen.getByText('阅读概览')).toBeInTheDocument()
    expect(screen.getByText('阅读档案')).toBeInTheDocument()
    // Streak
    expect(screen.getByText('3')).toBeInTheDocument()
    // Books
    expect(screen.getByText('5')).toBeInTheDocument()
    // Words
    expect(screen.getByText('4.5')).toBeInTheDocument()
  })

  it('renders currently reading books showcase', () => {
    renderWithQuery(<Profile />)

    expect(screen.getByText('正在阅读')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '三体' })).toBeInTheDocument()
    expect(screen.getByText(/刘慈欣/)).toBeInTheDocument()
    expect(screen.getByText('42%')).toBeInTheDocument()
    expect(screen.getByText('前往书库')).toBeInTheDocument()
  })

  it('opens a profile book with an explicit reader return target', () => {
    renderWithQuery(<Profile />)

    fireEvent.click(screen.getByRole('heading', { name: '三体' }))

    expect(mockNavigate).toHaveBeenCalledWith(expect.objectContaining({
      to: '/books/$id',
      params: { id: 'b1' },
    }))
    const navigation = mockNavigate.mock.calls.at(-1)?.[0] as { state: (previous: object) => object }
    expect(navigation.state({})).toEqual({ readerReturn: { to: '/profile', sourceHistoryIndex: 1 } })
  })

  it('redirects guest users away from profile', () => {
    useAuthStore.setState({
      user: null,
    })

    renderWithQuery(<Profile />)
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/' })
  })

  it('opens profile settings dialog and toggles module visibility', async () => {
    renderWithQuery(<Profile />)

    // Single settings button on the profile card
    const settingsBtn = screen.getByRole('button', { name: '个人设置' })
    expect(settingsBtn).toBeInTheDocument()

    // Initially modal is not visible
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // Click settings button
    fireEvent.click(settingsBtn)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '个人设置' })).toBeInTheDocument()
    expect(screen.getByText('基本资料')).toBeInTheDocument()
    expect(screen.queryByText('公开展示模块')).not.toBeInTheDocument()
    expect(screen.getByText('主页可见性')).toBeInTheDocument()
    expect(screen.getByText('账号安全')).toBeInTheDocument()
    expect(screen.getByText('0/500')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '保存资料' })).toHaveLength(1)

    // Edit username inside settings dialog
    const usernameInput = screen.getByDisplayValue('ReaderMaster')
    fireEvent.change(usernameInput, { target: { value: 'NewMaster' } })
    fireEvent.change(screen.getByLabelText('个人简介'), { target: { value: '喜欢阅读' } })
    expect(screen.getByText('4/500')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: '保存资料' })[0])
    expect(mockUpdateUsername).toHaveBeenCalledWith({ username: 'NewMaster' })
    await waitFor(() => expect(mockUpdateBio).toHaveBeenCalledWith({ bio: '喜欢阅读' }))

    // Toggles now write the per-user profile blob, so the assertion is that the
    // mutation carries the value rather than that local state changed.
    const showStatsSwitch = screen.getByRole('switch', { name: '展示阅读概览' })
    fireEvent.click(showStatsSwitch)
    expect(mockProfileMutate).toHaveBeenCalledWith({ showPublicStats: false })

    const showShowcaseSwitch = screen.getByRole('switch', { name: '展示正在阅读' })
    fireEvent.click(showShowcaseSwitch)
    expect(mockProfileMutate).toHaveBeenCalledWith({ showPublicShowcase: false })

    const publicSwitch = screen.getByRole('switch', { name: '允许他人访问主页' })
    expect(publicSwitch).toBeInTheDocument()
    fireEvent.click(publicSwitch)
    expect(mockProfileMutate).toHaveBeenCalledWith({ isPublic: false })

    // Trigger change password from settings dialog
    const changePasswordBtn = screen.getByRole('button', { name: '修改密码' })
    fireEvent.click(changePasswordBtn)
    expect(screen.getByText('旧密码')).toBeInTheDocument()
  })

  it('keeps the owner reading data visible when public modules are disabled', () => {
    profileSettings = { showPublicStats: false, showPublicShowcase: false }
    renderWithQuery(<Profile />)
    expect(screen.getByText('阅读概览')).toBeInTheDocument()
    expect(screen.getByText('正在阅读')).toBeInTheDocument()
  })

  it('disables public module settings when the profile is private', () => {
    profileSettings = { isPublic: false, showPublicStats: true, showPublicShowcase: true }
    renderWithQuery(<Profile />)
    fireEvent.click(screen.getByRole('button', { name: '个人设置' }))

    expect(screen.getByRole('switch', { name: '展示阅读概览' })).toBeDisabled()
    expect(screen.getByRole('switch', { name: '展示正在阅读' })).toBeDisabled()
    expect(screen.getByText('展示阅读概览')).toHaveClass('text-stone-400')
    expect(screen.getByText('展示正在阅读')).toHaveClass('text-stone-400')
  })
})
