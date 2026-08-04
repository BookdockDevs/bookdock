import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import i18n from '../i18n/i18n'
import { SettingsPanel } from '../features/reader/components/SettingsPanel'
import { useUiStore } from '../stores/ui.store'

describe('SettingsPanel', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    localStorage.removeItem('bd-settings-section')
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
})
