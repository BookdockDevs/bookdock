import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { apiGet } from '@/api/client'
import { useFonts } from '@/api/hooks/useFonts'
import i18n from '../i18n/i18n'
import ShareCardDialog from '../features/reader/components/share/ShareCardDialog'
import { loadShareCardPrefs } from '../features/reader/components/share/card-prefs'
import { useFontLoaderStore } from '../features/reader/fonts'
import { useReaderState } from '../features/reader/state/reader-state'

vi.mock('@/api/client', () => ({
  BASE_URL: '/api/v1',
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}))

vi.mock('@/api/hooks/useFonts', () => ({
  useFonts: vi.fn(() => ({ data: { data: [] } })),
}))

// jsdom lacks ResizeObserver (used by the preview scaling effect)
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

const uploadedFont = {
  id: 'up1',
  family: '我的手写体',
  fileName: 'hand.ttf',
  format: 'ttf',
  size: 1024,
  scope: 'user',
  mine: true,
  createdAt: 0,
}

function renderDialog() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ShareCardDialog bookId="b1" />
    </QueryClientProvider>,
  )
}

describe('ShareCardDialog', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    localStorage.clear()
    document.head.querySelectorAll('link[data-bd-font]').forEach((link) => link.remove())
    useFontLoaderStore.setState({ loadedIds: [], loadingIds: [] })
    vi.mocked(apiGet).mockResolvedValue({ data: { title: '不平静的日常', author: '惰天使' } })
    vi.mocked(useFonts).mockReturnValue({ data: { data: [uploadedFont] } } as ReturnType<typeof useFonts>)
    useReaderState.setState({ shareTarget: { text: '白君确实有招蜂引蝶的资本', chapter: '第三十二章' } })
  })

  it('renders the font row as a single list in the default order, without group labels', async () => {
    renderDialog()
    fireEvent.click(await screen.findByText('更换模板'))

    expect(screen.queryByText('在线字体')).not.toBeInTheDocument()
    expect(screen.queryByText('系统字体')).not.toBeInTheDocument()
    expect(screen.queryByText('我的字体')).not.toBeInTheDocument()

    const fontRow = screen.getByText('字体', { selector: 'span' }).parentElement!
    const chips = Array.from(fontRow.querySelectorAll('button'))
    expect(chips[0]).toHaveTextContent('宋体')
    expect(chips.map((c) => c.textContent)).toEqual([
      '宋体',
      '黑体',
      '楷体',
      '仿宋',
      '霞鹜文楷',
      '思源宋体',
      '思源黑体',
      '我的手写体',
    ])
    // no collapse control in the share card dialog
    expect(screen.queryByText('更多')).not.toBeInTheDocument()
  })

  it('loads builtin stylesheets when the font customization list opens', async () => {
    const { container } = renderDialog()
    fireEvent.click(await screen.findByText('更换模板'))

    const wenkaiChip = screen.getByText('霞鹜文楷').closest('button')!
    expect(wenkaiChip.querySelector('.animate-spin')).toBeTruthy()
    expect(document.head.querySelectorAll('link[data-bd-font]')).toHaveLength(3)

    fireEvent.click(wenkaiChip)
    expect(loadShareCardPrefs().font).toBe('lxgw-wenkai')
    expect(container.querySelector('.animate-spin')).toBeTruthy()
    // System and uploaded chips never carry a builtin loading status icon.
    expect(screen.getByText('宋体').closest('button')!.querySelector('svg')).toBeNull()
    expect(screen.getByText('我的手写体').closest('button')!.querySelector('svg')).toBeNull()
  })
})
