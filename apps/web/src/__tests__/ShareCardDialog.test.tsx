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
    useFontLoaderStore.setState({ loadedIds: [], loadingIds: [], latinIds: [] })
    vi.mocked(apiGet).mockResolvedValue({ data: { title: '不平静的日常', author: '惰天使' } })
    vi.mocked(useFonts).mockReturnValue({ data: { data: [uploadedFont] } } as ReturnType<typeof useFonts>)
    useReaderState.setState({ shareTarget: { text: '白君确实有招蜂引蝶的资本', chapter: '第三十二章' } })
  })

  it('renders primary font row by default and reveals CJK companion row when Latin font selected', async () => {
    renderDialog()

    expect(screen.queryByText('在线字体')).not.toBeInTheDocument()
    expect(screen.queryByText('系统字体')).not.toBeInTheDocument()
    expect(screen.queryByText('我的字体')).not.toBeInTheDocument()
    expect(screen.queryByText('中文', { selector: 'span' })).not.toBeInTheDocument()

    const fontRow = (await screen.findByText('字体', { selector: 'span' })).parentElement!
    const chips = Array.from(fontRow.querySelectorAll('button'))
    expect(chips[0]).toHaveTextContent('黑体')
    expect(chips.map((c) => c.textContent)).toEqual([
      '黑体',
      '宋体',
      '思源宋体',
      '思源黑体',
      '霞鹜文楷',
      '楷体',
      '仿宋',
      'Literata',
      '西文衬线',
      '西文无衬线',
      '我的手写体',
    ])

    // no collapse control in the share card dialog
    expect(screen.queryByText('更多')).not.toBeInTheDocument()

    // Selecting a Latin font reveals the CJK companion row
    const literata = chips.find((c) => c.textContent?.includes('Literata'))!
    fireEvent.click(literata)

    const cjkRow = (await screen.findByText('中文', { selector: 'span' })).parentElement!
    const cjkChips = Array.from(cjkRow.querySelectorAll('button'))
    expect(cjkChips.map((c) => c.textContent)).toEqual([
      '黑体',
      '宋体',
      '思源宋体',
      '思源黑体',
      '霞鹜文楷',
      '楷体',
      '仿宋',
      '我的手写体',
    ])
  })

  it('selects a CJK companion when Latin font is active', async () => {
    renderDialog()

    const fontRow = (await screen.findByText('字体', { selector: 'span' })).parentElement!
    const literata = Array.from(fontRow.querySelectorAll('button')).find((b) => b.textContent?.includes('Literata'))!
    fireEvent.click(literata)

    const cjkRow = (await screen.findByText('中文', { selector: 'span' })).parentElement!
    const wenkai = Array.from(cjkRow.querySelectorAll('button')).find((b) => b.textContent === '霞鹜文楷')!
    fireEvent.click(wenkai)
    expect(loadShareCardPrefs().cjkFont).toBe('lxgw-wenkai')
    expect(loadShareCardPrefs().font).toBe('literata')
  })

  it('loads builtin stylesheets when the share card dialog opens', async () => {
    const { container } = renderDialog()

    const fontRow = (await screen.findByText('字体', { selector: 'span' })).parentElement!
    const wenkaiChip = Array.from(fontRow.querySelectorAll('button')).find((b) => b.textContent === '霞鹜文楷')!
    expect(wenkaiChip.querySelector('.animate-spin')).toBeTruthy()
    expect(document.head.querySelectorAll('link[data-bd-font]')).toHaveLength(4)

    fireEvent.click(wenkaiChip)
    expect(loadShareCardPrefs().font).toBe('lxgw-wenkai')
    expect(container.querySelector('.animate-spin')).toBeTruthy()
    // System and uploaded chips never carry a builtin loading status icon.
    const chipByName = (name: string) => Array.from(fontRow.querySelectorAll('button')).find((b) => b.textContent === name)!
    expect(chipByName('宋体').querySelector('svg')).toBeNull()
    expect(chipByName('我的手写体').querySelector('svg')).toBeNull()
  })

  it('renders the brand options as a segmented control and persistent export actions', async () => {
    renderDialog()
    expect(await screen.findByRole('button', { name: 'Bookdock' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '书坞' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '不显示' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制图片' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存图片' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '书坞' }))
    expect(loadShareCardPrefs().brand).toBe('zh')
  })
})
