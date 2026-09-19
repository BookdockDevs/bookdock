import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import Profile from '@/features/profile/Profile'
import { useProfilePrefs } from '@/features/profile/profile-prefs'
import { useAuthStore } from '@/stores/auth.store'
import i18n from '@/i18n/i18n'

const mockNavigate = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, className }: { children: React.ReactNode; to: string; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  useNavigate: () => mockNavigate,
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
}))

const mockUpdateUsername = vi.fn().mockResolvedValue({})

vi.mock('@/features/auth/hooks', () => ({
  useUploadAvatar: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteAvatar: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateUsername: vi.fn(() => ({ mutateAsync: mockUpdateUsername, isPending: false })),
  useChangePassword: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
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
    useProfilePrefs.setState({
      showStats: true,
      showShowcase: true,
      isPublic: true,
    })
  })

  it('renders profile hero card with username and member days', () => {
    renderWithQuery(<Profile />)

    expect(screen.getByText('ReaderMaster')).toBeInTheDocument()
    expect(screen.getByText('所有者')).toBeInTheDocument()
    expect(screen.getByText(/在书栈驻留第 15 天/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '主页设置' })).toBeInTheDocument()
    expect(screen.queryByText('修改密码')).not.toBeInTheDocument()
    expect(screen.queryByText('修改')).not.toBeInTheDocument()
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
      user: {
        id: 'g1',
        username: 'Guest',
        role: 'guest',
        guest: true,
        avatarKey: null,
        createdAt: Date.now(),
      },
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
    expect(screen.queryByText('主页与偏好设置')).not.toBeInTheDocument()

    // Click settings button
    fireEvent.click(settingsBtn)
    expect(screen.getByText('主页与偏好设置')).toBeInTheDocument()
    expect(screen.getByText('个人资料')).toBeInTheDocument()
    expect(screen.getByText('模块展示')).toBeInTheDocument()
    expect(screen.getByText('隐私与公开')).toBeInTheDocument()
    expect(screen.getByText('账号安全')).toBeInTheDocument()

    // Edit username inside settings dialog
    const usernameInput = screen.getByDisplayValue('ReaderMaster')
    fireEvent.change(usernameInput, { target: { value: 'NewMaster' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(mockUpdateUsername).toHaveBeenCalledWith({ username: 'NewMaster' })

    // Toggle off reading achievements
    const showStatsSwitch = screen.getByRole('switch', { name: '展示阅读成就' })
    fireEvent.click(showStatsSwitch)
    expect(screen.queryByText('阅读成就')).not.toBeInTheDocument()

    // Toggle off currently reading
    const showShowcaseSwitch = screen.getByRole('switch', { name: '展示在读书目' })
    fireEvent.click(showShowcaseSwitch)
    expect(screen.queryByText('正在阅读')).not.toBeInTheDocument()

    // Toggle public profile
    const publicSwitch = screen.getByRole('switch', { name: '公开个人主页' })
    expect(publicSwitch).toBeInTheDocument()
    fireEvent.click(publicSwitch)
    expect(useProfilePrefs.getState().isPublic).toBe(false)

    // Fallback message is shown when all modules are hidden
    expect(screen.getByText('已在主页设置中隐藏了所有公开展示模块')).toBeInTheDocument()

    // Trigger change password from settings dialog
    const changePasswordBtn = screen.getByRole('button', { name: '修改密码' })
    fireEvent.click(changePasswordBtn)
    expect(screen.getByText('旧密码')).toBeInTheDocument()
  })
})
