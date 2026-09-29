import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import LibraryInvite from '../features/library/LibraryInvite'
import i18n from '../i18n/i18n'

const API = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/api/client', () => ({ apiGet: API.get, apiPost: API.post, apiDelete: vi.fn() }))

const TOKEN = 'K7M2QX9V4TN8BZRD'

// The code travels in a real path segment; stub the router rather than booting
// a whole router tree for one page.
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ token: `+${TOKEN}` }),
}))

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><LibraryInvite /></QueryClientProvider>)
}

describe('LibraryInvite', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage('zh-CN')
    API.get.mockResolvedValue({ data: { id: 'u1', username: 'alice', role: 'member', guest: false } })
    API.post.mockImplementation((url: string) => {
      if (url.includes('/preview')) {
        return Promise.resolve({
          data: { libraryId: 'lib_1', name: '私密小屋', description: '嘿嘿嘿', relation: 'non-member', memberCount: 12, workCount: 34 },
        })
      }
      return Promise.resolve({ data: { libraryId: 'lib_1' } })
    })
  })

  it('shows the library name, its size and its roster', async () => {
    renderPage()
    expect(await screen.findByText('私密小屋')).toBeInTheDocument()
    expect(screen.getByText('嘿嘿嘿')).toBeInTheDocument()
    // Icons with the numbers, the way the discovery rows state them — never
    // spelled-out labels.
    expect(screen.getByTitle('作品')).toHaveTextContent('34')
    expect(screen.getByTitle('成员')).toHaveTextContent('12')
    // The "you will find it in your list" line was noise next to real numbers.
    expect(screen.queryByText('加入后即可在书库列表中找到此书库。')).toBeNull()
  })
})
