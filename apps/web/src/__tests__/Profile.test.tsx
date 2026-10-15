import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import Profile from '@/features/profile/Profile'
import { useAuthStore } from '@/stores/auth.store'
import i18n from '@/i18n/i18n'

const mockNavigate = vi.fn()
let profileSearch: { userId?: string; notesPage: number; reviewsPage: number } = { notesPage: 1, reviewsPage: 1 }

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, className }: { children: React.ReactNode; to: string; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  useNavigate: () => mockNavigate,
  useSearch: () => profileSearch,
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
let profileSettings: { showStats?: boolean; showShowcase?: boolean; isPublic?: boolean } = {}
let mockProfileSettingsState: {
  profile?: typeof profileSettings
  isReady: boolean
  isLoading: boolean
  isError: boolean
  isFetching: boolean
  refetch: () => Promise<unknown>
} | null = null

// The showcase reads books here, and the page plus its settings dialog read and
// write the per-user profile preferences from the same module.
vi.mock('@/features/library/hooks', () => ({
  useBooks: vi.fn(() => ({
    data: {
      data: [
        {
          id: 'b1',
          title: '三体',
          author: '刘慈欣',
          format: 'epub',
          progress: 42,
          coverKey: null,
          coverPaletteId: null,
          readStatus: 'reading',
          size: 1024,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    },
    isLoading: false,
  })),
  useProfileSettings: () => profileSettings,
  useProfileSettingsState: () =>
    mockProfileSettingsState ?? {
      profile: profileSettings,
      isReady: true,
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    },
  useUpdateProfileSettings: () => ({ mutate: mockProfileMutate }),
}))

const mockUpdateUsername = vi.fn().mockResolvedValue({})

vi.mock('@/features/auth/hooks', () => ({
  useUploadAvatar: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteAvatar: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateUsername: vi.fn(() => ({ mutateAsync: mockUpdateUsername, isPending: false })),
  useChangePassword: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}))

const { mockMyReviews } = vi.hoisted(() => ({
  mockMyReviews: vi.fn((): unknown => ({ data: undefined, isPending: true, isError: false })),
}))

vi.mock('@/features/reviews/hooks/useReviews', () => ({
  useMyReviews: (...args: Array<unknown>) => mockMyReviews(...args),
  useReaderProfile: () => ({ data: { data: { author: { id: 'reader', name: 'Other reader' }, reviews: { entries: [], page: 1, hasMore: false } } }, isPending: false }),
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
    mockProfileSettingsState = null
    mockProfileMutate.mockClear()
    profileSearch = { notesPage: 1, reviewsPage: 1 }
    mockMyReviews.mockReset()
    mockMyReviews.mockReturnValue({ data: undefined, isPending: true, isError: false })
  })

  it('renders profile hero card with username and member days', () => {
    renderWithQuery(<Profile />)

    expect(screen.getByText('ReaderMaster')).toBeInTheDocument()
    expect(screen.getByText('所有者')).toBeInTheDocument()
    expect(screen.getByText(/在书坞驻留第 15 天/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '主页设置' })).toBeInTheDocument()
    expect(screen.queryByText('修改密码')).not.toBeInTheDocument()
    expect(screen.queryByText('修改')).not.toBeInTheDocument()
  })

  it('renders a visitor profile with only the plain homepage, no reading sections', () => {
    profileSearch = { userId: 'reader', notesPage: 1, reviewsPage: 1 }
    renderWithQuery(<Profile />)
    expect(screen.getByRole('heading', { name: 'Other reader' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /我的书评/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '书库可见书评' })).not.toBeInTheDocument()
    expect(screen.queryByText('全局笔记档案')).not.toBeInTheDocument()
    expect(screen.queryByText('修改密码')).not.toBeInTheDocument()
    // Explicitly labelled "返回书库": fixed destination, never history back.
    expect(screen.getByText('返回书库').closest('a')).toHaveAttribute('href', '/')
  })

  it('renders reading achievements section with summary stats', () => {
    renderWithQuery(<Profile />)

    expect(screen.getByText('阅读成就')).toBeInTheDocument()
    expect(screen.getByText('完整统计')).toBeInTheDocument()
    // Streak
    expect(screen.getByText('3 天')).toBeInTheDocument()
    // Books
    expect(screen.getByText('5 本')).toBeInTheDocument()
    // Words
    expect(screen.getByText('4.5万字')).toBeInTheDocument()
  })

  it('renders currently reading books showcase', () => {
    renderWithQuery(<Profile />)

    expect(screen.getByText('正在阅读')).toBeInTheDocument()
    expect(screen.getByText('三体')).toBeInTheDocument()
    expect(screen.getByText(/刘慈欣/)).toBeInTheDocument()
    expect(screen.getByText('42%')).toBeInTheDocument()
  })

  it('redirects guest users away from profile', () => {
    useAuthStore.setState({
      user: null,
    })

    renderWithQuery(<Profile />)
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/' })
  })

  it('opens profile settings dialog and toggles module visibility', () => {
    renderWithQuery(<Profile />)

    // Single settings button on the profile card
    const settingsBtn = screen.getByRole('button', { name: '主页设置' })
    expect(settingsBtn).toBeInTheDocument()

    // Initially modal is not visible
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // Click settings button
    fireEvent.click(settingsBtn)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '主页设置' })).toBeInTheDocument()
    expect(screen.getByText('个人资料')).toBeInTheDocument()
    expect(screen.getByText('模块展示')).toBeInTheDocument()
    expect(screen.getByText('隐私设置')).toBeInTheDocument()
    expect(screen.getByText('账号安全')).toBeInTheDocument()

    // Edit username inside settings dialog
    const usernameInput = screen.getByDisplayValue('ReaderMaster')
    fireEvent.change(usernameInput, { target: { value: 'NewMaster' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(mockUpdateUsername).toHaveBeenCalledWith({ username: 'NewMaster' })

    // Toggles now write the per-user profile blob, so the assertion is that the
    // mutation carries the value rather than that local state changed.
    const showStatsSwitch = screen.getByRole('switch', { name: '展示阅读成就' })
    fireEvent.click(showStatsSwitch)
    expect(mockProfileMutate).toHaveBeenCalledWith({ showStats: false })

    const showShowcaseSwitch = screen.getByRole('switch', { name: '展示在读书目' })
    fireEvent.click(showShowcaseSwitch)
    expect(mockProfileMutate).toHaveBeenCalledWith({ showShowcase: false })

    const publicSwitch = screen.getByRole('switch', { name: '公开个人主页' })
    expect(publicSwitch).toBeInTheDocument()
    fireEvent.click(publicSwitch)
    expect(mockProfileMutate).toHaveBeenCalledWith({ isPublic: false })

    // Trigger change password from settings dialog
    const changePasswordBtn = screen.getByRole('button', { name: '修改密码' })
    fireEvent.click(changePasswordBtn)
    expect(screen.getByText('旧密码')).toBeInTheDocument()
  })

  it('shows the all-hidden guidance when both showcase modules are hidden', () => {
    profileSettings = { showStats: false, showShowcase: false }
    renderWithQuery(<Profile />)
    expect(screen.getByText('已在主页设置中隐藏了所有公开展示模块')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /我的书评/ })).not.toBeInTheDocument()
  })

  it('hides the all-hidden guidance when a showcase module is visible', () => {
    profileSettings = { showStats: false, showShowcase: true }
    renderWithQuery(<Profile />)
    expect(screen.queryByText('已在主页设置中隐藏了所有公开展示模块')).not.toBeInTheDocument()
  })

  it('renders retry button when profile settings fail without cache', () => {
    mockProfileSettingsState = {
      profile: undefined,
      isReady: false,
      isLoading: false,
      isError: true,
      isFetching: false,
      refetch: vi.fn(),
    }
    renderWithQuery(<Profile />)
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /我的书评/ })).not.toBeInTheDocument()
  })
})
