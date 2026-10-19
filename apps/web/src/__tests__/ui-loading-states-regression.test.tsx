import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ShelfChip from '@/features/library/components/book-detail/ShelfChip'
import { NotesPanel } from '@/features/reader/components/NotesPanel'
import type { AnnotationRes } from '@bookdock/shared'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, opts?: Record<string, unknown>) => {
    const translations: Record<string, string> = {
      'library.uncategorized': '未分类',
      'library.shelfUnavailable': '书架信息暂不可用',
      'library.selectShelf': '选择书架',
      'reader.noNotes': '暂无笔记与批注',
      'reader.noNotesHint': '阅读时划选文本即可添加高亮、想法或书签',
      'reader.noMatchingNotes': '未找到匹配的笔记',
      'reader.noMatchingNotesHint': '请尝试调整筛选条件或搜索关键词',
      'reader.loading': '加载中…',
      'stats.revalidateFailed': '数据刷新失败，正在显示缓存数据',
      'common.retry': '重试',
      'errors.retry': '重试',
      'errors.loadFailed': '加载失败',
    }
    return translations[key] || opts?.defaultValue?.toString() || key
  },
}))

vi.mock('@/features/reader/hooks/useReaderApi', () => ({
  useReaderApi: () => ({ renderer: null }),
}))

vi.mock('@/features/reader/hooks/useAnnotations', () => ({
  useDeleteAnnotation: () => ({ mutate: vi.fn() }),
  useUpdateAnnotation: () => ({ mutate: vi.fn() }),
}))

vi.mock('@/features/reader/hooks/useIdeas', () => ({
  useIdeaComposer: () => ({ isComposing: false }),
}))

vi.mock('@/features/reader/state/reader-state', () => ({
  useReaderState: () => vi.fn(),
}))

vi.mock('@/api/hooks/reading-records', () => ({
  useReadingSummary: vi.fn(),
  usePreviousReadingSummary: vi.fn().mockReturnValue({ data: undefined, isLoading: false, isError: false }),
}))

vi.mock('@/stores/auth.store', () => {
  const store = Object.assign(
    (selector?: (state: { user: { id: string } }) => unknown) => {
      const state = { user: { id: 'u1' } }
      return selector ? selector(state) : state
    },
    {
      getState: () => ({ user: { id: 'u1' } }),
      subscribe: vi.fn(),
    },
  )
  return { useAuthStore: store }
})

describe('UI Loading States Regression Tests', () => {
  describe('ShelfChip Waiting & Readiness Semantics (ISSUE-01)', () => {
    it('renders known shelfName immediately while membershipReady is false', () => {
      const { container } = render(
        <QueryClientProvider client={queryClient}>
          <ShelfChip
            bookId="b1"
            shelfId="s1"
            shelfName="科幻小说"
            membershipReady={false}
            membershipError={false}
            onFilter={vi.fn()}
          />
        </QueryClientProvider>,
      )

      expect(screen.getByText('科幻小说')).toBeInTheDocument()
      expect(screen.queryByText('书架信息暂不可用')).not.toBeInTheDocument()
      // Container should have aria-busy while membership is not ready
      expect(container.firstChild).toHaveAttribute('aria-busy', 'true')
    })

    it('renders "未分类" only when membership is ready and shelfId is null', () => {
      render(
        <QueryClientProvider client={queryClient}>
          <ShelfChip
            bookId="b1"
            shelfId={null}
            shelfName={undefined}
            membershipReady={true}
            membershipError={false}
            onFilter={vi.fn()}
          />
        </QueryClientProvider>,
      )

      expect(screen.getByText('未分类')).toBeInTheDocument()
      expect(screen.queryByText('书架信息暂不可用')).not.toBeInTheDocument()
    })

    it('renders "书架信息暂不可用" when membership request fails and no known shelf exists', () => {
      const { container } = render(
        <QueryClientProvider client={queryClient}>
          <ShelfChip
            bookId="b1"
            shelfId={null}
            shelfName={undefined}
            membershipReady={false}
            membershipError={true}
            onFilter={vi.fn()}
          />
        </QueryClientProvider>,
      )

      expect(screen.getByText('书架信息暂不可用')).toBeInTheDocument()
      expect(container.firstChild).not.toHaveAttribute('aria-busy')
    })
  })

  describe('NotesPanel Loading, Filter-empty and True-empty Semantics (ISSUE-06)', () => {
    const mockAnnotation: AnnotationRes = {
      id: 'a1',
      bookId: 'b1',
      userId: 'u1',
      kind: 'highlight',
      color: 'yellow',
      cfi: 'epubcfi(/6/2!/4/1:0)',
      text: '这是一个划线测试句子',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    it('renders skeletons and aria-busy when isLoading is true, not false empty message', () => {
      render(
        <NotesPanel
          isLoading={true}
          items={[]}
          allItems={[]}
          sort="chapter"
          chapterOrder={[]}
          bookId="b1"
        />,
      )

      expect(screen.queryByText('暂无笔记与批注')).not.toBeInTheDocument()
      const statusContainer = screen.getByRole('status')
      expect(statusContainer).toHaveAttribute('aria-busy', 'true')
    })

    it('renders "未找到匹配的笔记" when allItems > 0 but filter returns 0', () => {
      render(
        <NotesPanel
          isLoading={false}
          items={[]}
          allItems={[mockAnnotation]}
          sort="chapter"
          chapterOrder={[]}
          bookId="b1"
        />,
      )

      expect(screen.getByText('未找到匹配的笔记')).toBeInTheDocument()
      expect(screen.getByText('请尝试调整筛选条件或搜索关键词')).toBeInTheDocument()
      expect(screen.queryByText('暂无笔记与批注')).not.toBeInTheDocument()
    })

    it('renders "暂无笔记与批注" when allItems is truly empty', () => {
      render(
        <NotesPanel
          isLoading={false}
          items={[]}
          allItems={[]}
          sort="chapter"
          chapterOrder={[]}
          bookId="b1"
        />,
      )

      expect(screen.getByText('暂无笔记与批注')).toBeInTheDocument()
      expect(screen.getByText('阅读时划选文本即可添加高亮、想法或书签')).toBeInTheDocument()
    })
  })

  describe('SummaryCards Background Error Retention (ISSUE-07)', () => {
    it('preserves cached card values and renders retry notice during background error', async () => {
      const { default: SummaryCards } = await import('@/features/stats/components/SummaryCards')
      const { useReadingSummary } = await import('@/api/hooks/reading-records')

      vi.mocked(useReadingSummary).mockReturnValue({
        data: {
          data: {
            totalSeconds: 3600,
            todaySeconds: 600,
            weekSeconds: 1200,
            prevWeekSeconds: 1000,
            monthSeconds: 3600,
            prevMonthSeconds: 3000,
            totalBooks: 3,
            totalDays: 5,
            currentStreak: 2,
            longestStreak: 4,
            totalWordsRead: 10000,
          },
        },
        isLoading: false,
        isError: true, // background refetch error!
        isFetching: false,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useReadingSummary>)

      render(
        <QueryClientProvider client={queryClient}>
          <SummaryCards />
        </QueryClientProvider>,
      )

      // Cached values are retained instead of showing full QueryErrorState
      expect(screen.getByText('数据刷新失败，正在显示缓存数据')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
    })

    it('does NOT retain cached data when error is access revocation (FORBIDDEN / 403)', async () => {
      const { default: SummaryCards } = await import('@/features/stats/components/SummaryCards')
      const { useReadingSummary } = await import('@/api/hooks/reading-records')
      const { ApiError } = await import('@/api/client')

      vi.mocked(useReadingSummary).mockReturnValue({
        data: {
          data: {
            totalSeconds: 3600,
            todaySeconds: 600,
            weekSeconds: 1200,
            prevWeekSeconds: 1000,
            monthSeconds: 3600,
            prevMonthSeconds: 3000,
            totalBooks: 3,
            totalDays: 5,
            currentStreak: 2,
            longestStreak: 4,
            totalWordsRead: 10000,
          },
        },
        isLoading: false,
        isError: true,
        error: new ApiError('FORBIDDEN', 'Forbidden', undefined, 403),
        isFetching: false,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useReadingSummary>)

      render(
        <QueryClientProvider client={queryClient}>
          <SummaryCards />
        </QueryClientProvider>,
      )

      expect(screen.queryByText('数据刷新失败，正在显示缓存数据')).not.toBeInTheDocument()
      expect(screen.queryByText('10,000')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
    })
  })

  describe('DetailFieldMenu A11y Busy vs Disabled Semantics (P3)', () => {
    it('sets aria-busy only when busy is true, not when disabled is true', async () => {
      const { default: DetailFieldMenu } = await import('@/features/library/components/book-detail/DetailFieldMenu')
      const { container, rerender } = render(
        <DetailFieldMenu
          label="Test Field"
          editLabel="Edit"
          value={null}
          options={[]}
          editable={true}
          busy={false}
          disabled={true}
          onFilter={vi.fn()}
          onSelect={vi.fn()}
        />,
      )
      expect(container.firstChild).not.toHaveAttribute('aria-busy')

      rerender(
        <DetailFieldMenu
          label="Test Field"
          editLabel="Edit"
          value={null}
          options={[]}
          editable={true}
          busy={true}
          disabled={true}
          onFilter={vi.fn()}
          onSelect={vi.fn()}
        />,
      )
      expect(container.firstChild).toHaveAttribute('aria-busy', 'true')
    })
  })

  describe('Global queryClient Access Revocation Cache Eviction (P1)', () => {
    it('evicts cached data on FORBIDDEN / 403 while preserving error status and error object', async () => {
      const { queryClient: appQueryClient } = await import('@/lib/query-client')
      const { ApiError } = await import('@/api/client')

      const testKey = ['test-access-revocation-' + Date.now()]
      // Pre-warm the cache with existing data
      appQueryClient.setQueryData(testKey, { secretData: 'cached-user-content' })

      const query = appQueryClient.getQueryCache().find({ queryKey: testKey })
      expect(query?.state.data).toEqual({ secretData: 'cached-user-content' })
      expect(query?.state.status).toBe('success')

      // Now execute a fetch that throws a 403 ApiError
      const forbiddenError = new ApiError('FORBIDDEN', 'Access denied', undefined, 403)
      await expect(
        appQueryClient.fetchQuery({
          queryKey: testKey,
          queryFn: async () => {
            throw forbiddenError
          },
          staleTime: 0,
          retry: false,
        }),
      ).rejects.toThrow('Access denied')

      // Query state must have data removed, but status must remain 'error' with original error preserved
      expect(query?.state.data).toBeUndefined()
      expect(query?.state.status).toBe('error')
      expect(query?.state.error).toBe(forbiddenError)
    })

    it('ensures React component using real queryClient transitions from cached data to error state on 403', async () => {
      const { queryClient: appQueryClient } = await import('@/lib/query-client')
      const { ApiError } = await import('@/api/client')
      const { useQuery } = await import('@tanstack/react-query')

      const testKey = ['test-component-revocation-' + Date.now()]
      appQueryClient.setQueryData(testKey, { secret: 'secret-content' })

      let fail = false
      function TestComponent() {
        const q = useQuery({
          queryKey: testKey,
          queryFn: async () => {
            if (fail) throw new ApiError('FORBIDDEN', 'Forbidden', undefined, 403)
            return { secret: 'secret-content' }
          },
          staleTime: 0,
          retry: false,
        })
        if (q.isError) return <div>Access Denied</div>
        if (q.data) return <div>Data: {q.data.secret}</div>
        return <div>Loading</div>
      }

      render(
        <QueryClientProvider client={appQueryClient}>
          <TestComponent />
        </QueryClientProvider>,
      )

      expect(screen.getByText('Data: secret-content')).toBeInTheDocument()

      fail = true
      await appQueryClient.refetchQueries({ queryKey: testKey })

      await waitFor(() => {
        expect(screen.queryByText('Data: secret-content')).not.toBeInTheDocument()
        expect(screen.getByText('Access Denied')).toBeInTheDocument()
      })
    })

    it('does not invalidate interaction projections for an unrelated settled mutation', async () => {
      const { queryClient: appQueryClient } = await import('@/lib/query-client')
      const keys = [
        ['notifications'],
        ['note-archive'],
        ['reviews', 'author'],
      ]
      for (const key of keys) appQueryClient.setQueryData(key, { data: [] })

      const mutation = appQueryClient.getMutationCache().build(appQueryClient, {
        mutationFn: async () => ({ ok: true }),
      })
      await mutation.execute(undefined)

      for (const key of keys) expect(appQueryClient.getQueryState(key)?.isInvalidated).toBe(false)
    })
  })
})
