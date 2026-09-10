import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import i18n from '../i18n/i18n'
import { SettingsPanel } from '../features/reader/components/SettingsPanel'
import { useFontLoaderStore } from '../features/reader/fonts'
import { useUiStore } from '../stores/ui.store'
import { useFonts } from '@/api/hooks/useFonts'
import { useBookTransforms } from '@/api/hooks/useTransforms'
import type { TextTransformRes } from '@bookdock/shared'

vi.mock('@/api/hooks/useFonts', () => ({
  useFonts: vi.fn(() => ({ data: { data: [] } })),
}))

vi.mock('@/api/hooks/useTransforms', () => ({
  useBookTransforms: vi.fn(() => ({ data: { data: [] } })),
}))

const mockTransforms = (list: TextTransformRes[]) => {
  vi.mocked(useBookTransforms).mockReturnValue({ data: { data: list } } as ReturnType<typeof useBookTransforms>)
}

const mockUploadedFonts = (fonts: unknown[]) => {
  vi.mocked(useFonts).mockReturnValue({ data: { data: fonts } } as ReturnType<typeof useFonts>)
}

describe('SettingsPanel', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    localStorage.removeItem('bd-settings-section')
    mockUploadedFonts([])
    useFontLoaderStore.setState({ loadedIds: [], loadingIds: [] })
    useUiStore.setState({
      fontFamily: 'serif',
      fontSize: 18,
      fontWeight: 400,
      lineHeight: 1.8,
      paragraphSpacing: 0.5,
      letterSpacing: 0,
      indent: 2,
      readingThemeId: 'paper',
      pageWidth: 800,
      verticalPadding: 24,
      horizontalPadding: 24,
      textAlignJustify: false,
      overrideBookFont: false,
      overrideBookLayout: false,
      readingMode: 'scroll',
      showHeader: true,
      showFooter: true,
      chineseConversion: 'off',
    })
  })

  it('renders font section by default', () => {
    render(<SettingsPanel />)

    expect(screen.getByText('宋体')).toBeInTheDocument()
    expect(screen.getByText('字号')).toBeInTheDocument()
    expect(screen.getByText('字体粗细')).toBeInTheDocument()
    expect(screen.getByText('两端对齐')).toBeInTheDocument()
    expect(screen.getByText('覆盖书籍字体')).toBeInTheDocument()
  })

  it('renders a single font list without group labels', () => {
    render(<SettingsPanel />)

    expect(screen.getByText('霞鹜文楷')).toBeInTheDocument()
    expect(screen.getByText('思源宋体')).toBeInTheDocument()
    expect(screen.getByText('思源黑体')).toBeInTheDocument()
    expect(screen.getByText('宋体')).toBeInTheDocument()
    expect(screen.queryByText('在线字体')).not.toBeInTheDocument()
    expect(screen.queryByText('系统字体')).not.toBeInTheDocument()
    expect(screen.queryByText('我的字体')).not.toBeInTheDocument()
    // 3 builtin + 4 system = exactly the visible window — no More chip
    expect(screen.queryByText('更多')).not.toBeInTheDocument()
  })

  it('collapses to 7 chips plus More, and expands in place', () => {
    mockUploadedFonts([
      { id: 'up1', family: '我的手写体', fileName: 'a.ttf', format: 'ttf', size: 1024, scope: 'user', mine: true, createdAt: 0 },
      { id: 'up2', family: '另一款字体', fileName: 'b.ttf', format: 'ttf', size: 1024, scope: 'user', mine: true, createdAt: 0 },
    ])
    render(<SettingsPanel />)

    // 9 options total; the two uploaded fonts are hidden behind the More chip
    expect(screen.getByText('霞鹜文楷')).toBeInTheDocument()
    expect(screen.getByText('更多')).toBeInTheDocument()
    expect(screen.getByText('楷体')).toBeInTheDocument()
    expect(screen.getByText('仿宋')).toBeInTheDocument()
    expect(screen.queryByText('我的手写体')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('更多'))
    expect(screen.getByText('收起')).toBeInTheDocument()
    expect(screen.getByText('我的手写体')).toBeInTheDocument()
    expect(screen.getByText('另一款字体')).toBeInTheDocument()

    fireEvent.click(screen.getByText('收起'))
    expect(screen.getByText('楷体')).toBeInTheDocument()
    expect(screen.queryByText('我的手写体')).not.toBeInTheDocument()
    expect(screen.getByText('更多')).toBeInTheDocument()
  })

  it('promotes a hidden selected font into the last visible slot', () => {
    mockUploadedFonts([
      { id: 'up1', family: '我的手写体', fileName: 'a.ttf', format: 'ttf', size: 1024, scope: 'user', mine: true, createdAt: 0 },
      { id: 'up2', family: '另一款字体', fileName: 'b.ttf', format: 'ttf', size: 1024, scope: 'user', mine: true, createdAt: 0 },
    ])
    useUiStore.setState({ fontFamily: 'up2' })
    render(<SettingsPanel />)

    // The selected second uploaded font is hidden by default and is promoted
    // while the last visible builtin font shifts out.
    expect(screen.getByText('另一款字体')).toBeInTheDocument()
    expect(screen.getByText('黑体')).toBeInTheDocument()
    expect(screen.getByText('楷体')).toBeInTheDocument()
    expect(screen.queryByText('思源黑体')).not.toBeInTheDocument()
  })

  it('lists uploaded fonts at the end and selects them by id', () => {
    mockUploadedFonts([
      { id: 'up1', family: '我的手写体', fileName: 'hand.ttf', format: 'ttf', size: 1024, scope: 'user', mine: true, createdAt: 0 },
    ])
    render(<SettingsPanel />)

    fireEvent.click(screen.getByText('更多'))
    fireEvent.click(screen.getByText('我的手写体'))
    expect(useUiStore.getState().fontFamily).toBe('up1')
  })

  it('selects a builtin font by id', () => {
    render(<SettingsPanel />)

    fireEvent.click(screen.getByText('霞鹜文楷'))
    expect(useUiStore.getState().fontFamily).toBe('lxgw-wenkai')
  })

  it('switches to layout section', () => {
    render(<SettingsPanel />)

    const layoutButton = screen.getByTitle('布局')
    fireEvent.click(layoutButton)

    expect(screen.getByText('页面宽度')).toBeInTheDocument()
    expect(screen.getByText('垂直边距')).toBeInTheDocument()
    expect(screen.getByText('水平边距')).toBeInTheDocument()
    expect(screen.getByText('覆盖书籍布局')).toBeInTheDocument()
  })

  it('switches to display section', () => {
    render(<SettingsPanel />)

    const displayButton = screen.getByTitle('显示')
    fireEvent.click(displayButton)

    expect(screen.getByText('阅读模式')).toBeInTheDocument()
    expect(screen.getByText('滚动')).toBeInTheDocument()
    expect(screen.getByText('翻页')).toBeInTheDocument()
    // header/footer info bar toggles show in both reading modes now
    expect(screen.getByText('显示页眉')).toBeInTheDocument()
    expect(screen.getByText('显示页脚')).toBeInTheDocument()

    fireEvent.click(screen.getByText('翻页'))
    expect(screen.getByText('分栏数')).toBeInTheDocument()
  })

  it('switches to theme section', () => {
    render(<SettingsPanel />)

    const themeButton = screen.getByTitle('主题')
    fireEvent.click(themeButton)

    expect(screen.getByText('白纸')).toBeInTheDocument()
    expect(screen.getByText('米黄')).toBeInTheDocument()
    expect(screen.getByText('护眼')).toBeInTheDocument()
    expect(screen.getByText('夜间')).toBeInTheDocument()
  })

  it('toggles two-column justify switch', () => {
    render(<SettingsPanel />)

    const justifyButton = screen.getByRole('switch', { name: /两端对齐/ })
    expect(justifyButton).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(justifyButton)
    expect(justifyButton).toHaveAttribute('aria-checked', 'true')
    expect(useUiStore.getState().textAlignJustify).toBe(true)
  })

  it('shows continuous scroll options in scroll mode with deselect-to-off', () => {
    render(<SettingsPanel />)

    fireEvent.click(screen.getByTitle('显示'))

    expect(screen.getByText('连续滚动')).toBeInTheDocument()
    expect(screen.getByText('递进')).toBeInTheDocument()
    expect(screen.getByText('连卷')).toBeInTheDocument()
    // no explicit "off" button: deselecting the active option means off
    expect(screen.queryByText('分章')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('递进'))
    expect(useUiStore.getState().continuousScroll).toBe('snap')

    fireEvent.click(screen.getByText('递进'))
    expect(useUiStore.getState().continuousScroll).toBe('off')
  })

  it('hides continuous scroll options in page mode', () => {
    useUiStore.setState({ readingMode: 'page' })
    render(<SettingsPanel />)

    fireEvent.click(screen.getByTitle('显示'))

    expect(screen.queryByText('连续滚动')).not.toBeInTheDocument()
  })

  it('toggles chinese conversion with deselect-to-off', () => {
    render(<SettingsPanel />)

    fireEvent.click(screen.getByTitle('显示'))

    expect(screen.getByText('简体')).toBeInTheDocument()
    expect(screen.getByText('繁体')).toBeInTheDocument()
    expect(screen.queryByText('不转换')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('简体'))
    expect(useUiStore.getState().chineseConversion).toBe('simplified')

    fireEvent.click(screen.getByText('简体'))
    expect(useUiStore.getState().chineseConversion).toBe('off')
  })

  it('changes reading mode in display section', () => {
    render(<SettingsPanel />)

    fireEvent.click(screen.getByTitle('显示'))
    fireEvent.click(screen.getByText('翻页'))

    expect(useUiStore.getState().readingMode).toBe('page')
  })

  it('toggles the auto-mark selection switch', () => {
    render(<SettingsPanel />)

    fireEvent.click(screen.getByTitle('行为'))

    const toggle = screen.getByRole('switch', { name: /选中即划线/ })
    expect(toggle).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(toggle)
    expect(useUiStore.getState().autoMarkSelection).toBe(true)
    expect(localStorage.getItem('bd-auto-mark-selection')).toBe('true')
  })

  it('click-area mode toggles between modes and deselects to none', () => {
    render(<SettingsPanel />)

    fireEvent.click(screen.getByTitle('行为'))

    expect(screen.getByRole('button', { name: /标准三区/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /任意侧翻下一页/ }))
    expect(useUiStore.getState().clickAreaMode).toBe('fullscreen')

    fireEvent.click(screen.getByRole('button', { name: /任意侧翻下一页/ }))
    expect(useUiStore.getState().clickAreaMode).toBe('none')

    fireEvent.click(screen.getByRole('button', { name: /左右交换/ }))
    expect(useUiStore.getState().clickAreaMode).toBe('swap')
  })

  it('hides the text-transforms entry without a bookId', () => {
    render(<SettingsPanel />)

    fireEvent.click(screen.getByTitle('行为'))
    expect(screen.queryByText('正文变换')).not.toBeInTheDocument()
  })

  it('shows the text-transforms entry with the effective count in the behavior section', () => {
    mockTransforms([
      { id: 'p1', bookId: 'b1', scope: 'book', matchType: 'point', pattern: null, replacement: '好', isRegex: false, caseSensitive: true, enabled: true, name: null, group: null, spineHref: 'c1', textOffset: 1, originalText: '坏', createdAt: 0, updatedAt: 0 },
      { id: 'r1', bookId: null, scope: 'global', matchType: 'pattern', pattern: 'foo', replacement: null, isRegex: false, caseSensitive: true, enabled: true, effectiveEnabled: false, hasOverride: true, name: null, group: null, spineHref: null, textOffset: null, originalText: null, createdAt: 0, updatedAt: 0 },
      { id: 'r2', bookId: null, scope: 'global', matchType: 'pattern', pattern: 'bar', replacement: null, isRegex: false, caseSensitive: true, enabled: false, effectiveEnabled: true, hasOverride: true, name: null, group: null, spineHref: null, textOffset: null, originalText: null, createdAt: 0, updatedAt: 0 },
    ])
    render(<SettingsPanel bookId="b1" />)

    fireEvent.click(screen.getByTitle('行为'))
    expect(screen.getByText('正文变换')).toBeInTheDocument()
    // point patch enabled + pattern rule effective via override = 2 active
    expect(screen.getByText('2 条生效')).toBeInTheDocument()
  })
})
