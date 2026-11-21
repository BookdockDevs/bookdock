import { Blob as NativeBlob } from 'node:buffer'

import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest'
import { act, cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { useState } from 'react'
import JSZip from 'jszip'
import i18n from '../i18n/i18n'
import { SettingsPanel } from '../features/reader/components/SettingsPanel'
import * as readerFonts from '../features/reader/fonts'
import { useFontLoaderStore } from '../features/reader/fonts'
import { useReaderFontPreviews } from '../features/reader/hooks/useReaderFontPreviews'
import { useDeviceFontStore } from '../features/device-fonts/store'
import type { DeviceFontMeta } from '../features/device-fonts/db'
import { selectReadingThemeSlot, useUiStore } from '../stores/ui.store'
import { useFonts } from '@/api/hooks/useFonts'
import { useInstanceInfo } from '@/features/auth/hooks'
import { useBookReplacements } from '@/api/hooks/useReplacements'
import type { ReaderBookThemeSettings, TextReplacementRes } from '@bookdock/shared'
import { LocalReaderContext, type LocalReaderSession } from '@/features/reading-data/reader-source-context'
import { useAuthStore } from '@/stores/auth.store'
import { ThemeAssetStore } from '@/features/reading-theme/assets'
import { INITIAL_THEME_LIBRARY, readThemeLibrary, serializeThemeLibrary } from '@/features/reading-theme/theme-library'
import { parseReadingConfig } from '../features/reader/lib/reading-profiles'
import { resolveAppearance } from '@/features/reading-theme/appearance'
import ReadingThemesSettingsSection from '@/features/settings/components/ReadingThemesSettingsSection'
import { ViewSettingsContext, type ViewSettingsContextValue } from '@/features/reader/view-settings-context'
import type { GlobalAppearanceState } from '@/features/reading-theme/appearance'

vi.mock('@/api/hooks/useFonts', () => ({
  useFonts: vi.fn(() => ({ data: { data: [] } })),
}))

vi.mock('@/features/auth/hooks', () => ({
  useInstanceInfo: vi.fn(() => ({ data: undefined })),
}))

const mockInstanceInfo = (allowUserResourceUpload: boolean | undefined) => {
  vi.mocked(useInstanceInfo).mockReturnValue({ data: allowUserResourceUpload === undefined ? undefined : { data: { allowUserResourceUpload } } } as ReturnType<typeof useInstanceInfo>)
}

vi.mock('@/api/hooks/useReplacements', () => ({
  useBookReplacements: vi.fn(() => ({ data: { data: [] } })),
}))

const mockReplacements = (list: TextReplacementRes[]) => {
  vi.mocked(useBookReplacements).mockReturnValue({ data: { data: list } } as ReturnType<typeof useBookReplacements>)
}

const mockUploadedFonts = (fonts: unknown[]) => {
  vi.mocked(useFonts).mockReturnValue({ data: { data: fonts } } as ReturnType<typeof useFonts>)
}

const deviceFont: DeviceFontMeta = {
  id: 'device-fb1',
  family: 'Device SimSun',
  fileName: 'device-simsun.ttf',
  format: 'ttf',
  size: 4096,
  contentHash: 'hash',
  createdAt: 0,
}

// Every system and builtin id disabled, leaving only the device font enabled
const ONLY_DEVICE_ENABLED = Object.fromEntries([
  'sans-serif', 'serif', 'kaiti', 'fangsong', 'serif-en', 'sans-en',
  'noto-serif-sc', 'noto-sans-sc', 'lxgw-wenkai', 'literata',
].map((id) => [id, { enabled: false }]))

describe('SettingsPanel', () => {
  afterEach(() => {
    useDeviceFontStore.setState({ status: 'idle', fonts: [], preferences: {}, order: [], selection: { primary: null, cjk: null } })
    useUiStore.setState({ fontPreferences: {} })
  })

  const settings = (): ViewSettingsContextValue => ({
    effective: { cleanReading: false, fontSize: 18, lineHeight: 1.8, pageWidth: 800, horizontalPadding: 24, verticalPadding: 24, pageColumns: 2, columnGap: 5 } as ViewSettingsContextValue['effective'],
    groups: {},
    setGroupEnabled: vi.fn(),
    updateField: vi.fn(),
    bookDeviceFonts: undefined,
    setBookDeviceFont: vi.fn(),
    boundPresetId: null,
    setBoundPreset: vi.fn(),
    appearance: { candidateThemeId: 'paper', selectedThemeId: 'paper', paletteId: null, effectivePaletteId: 'paper', cssId: null, highlightIds: [] },
    pickTheme: vi.fn(),
    pickPalette: vi.fn(),
    setCss: vi.fn(),
    toggleHighlight: vi.fn(),
  })

  it('seeds four editable themes and palettes and saves a theme with a palette created inside it', () => {
    useAuthStore.setState({ user: { id: 'font-account', username: 'Reader', role: 'user' } })
    try {
      render(<LocalReaderContext.Provider value={{} as LocalReaderSession}><SettingsPanel /></LocalReaderContext.Provider>)
      expect(useFonts).toHaveBeenLastCalledWith(true)
      fireEvent.click(screen.getByTitle('主题'))
      const palette = screen.getByRole('region', { name: '配色' })
      expect(within(palette).getByRole('button', { name: '白纸' })).toHaveAttribute('aria-pressed', 'true')
      const themes = screen.getByRole('region', { name: '主题' })
      fireEvent.contextMenu(within(palette).getByRole('button', { name: '白纸' }))
      expect(screen.getByRole('button', { name: '编辑' })).toBeInTheDocument()
      fireEvent.click(document.body)
      fireEvent.contextMenu(within(themes).getByRole('button', { name: '白纸' }))
      expect(screen.getByRole('button', { name: '编辑' })).toBeInTheDocument()
      fireEvent.click(document.body)
      expect(useUiStore.getState().themeLibrary.themes).toHaveLength(4)
      fireEvent.click(screen.getByRole('button', { name: '新建主题' }))
      const dialog = within(screen.getByRole('dialog'))
      fireEvent.change(dialog.getByRole('textbox', { name: '名称' }), { target: { value: 'Device theme' } })
      fireEvent.click(dialog.getByRole('button', { name: '新建配色' }))
      const paletteDialog = within(screen.getByRole('dialog', { name: '新建配色' }))
      fireEvent.change(paletteDialog.getByRole('textbox', { name: '名称' }), { target: { value: 'Device palette' } })
      fireEvent.click(paletteDialog.getByRole('button', { name: '保存' }))
      const created = useUiStore.getState().themeLibrary.palettes.at(-1)!
      expect(created.name).toBe('Device palette')
      expect(dialog.getByRole('combobox', { name: '配色' })).toHaveValue(created.id)
      fireEvent.click(dialog.getByRole('button', { name: '保存' }))
      expect(useUiStore.getState().themeLibrary.themes.at(-1)).toMatchObject({ name: 'Device theme', cards: { paletteId: created.id, cssId: null, highlightIds: [] } })
    } finally { act(() => useAuthStore.setState({ user: null })) }
  })

  it('edits the effective reading tone, including device theme in system mode', () => {
    useUiStore.setState({
      themeLibrary: INITIAL_THEME_LIBRARY, readingThemeMode: 'system', systemTheme: 'light',
      lightReadingThemeId: 'paper', darkReadingThemeId: 'night',
    })
    render(<SettingsPanel bookId="book" />)
    fireEvent.click(screen.getByTitle('主题'))
    const themes = within(screen.getByRole('region', { name: '主题' }))
    expect(themes.getByRole('button', { name: '白纸' })).toHaveAttribute('aria-pressed', 'true')

    act(() => useUiStore.setState({ systemTheme: 'dark' }))
    expect(themes.getByRole('button', { name: '夜间' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(themes.getByRole('button', { name: '米黄' }))
    expect(useUiStore.getState()).toMatchObject({
      readingThemeMode: 'system', lightReadingThemeId: 'paper', darkReadingThemeId: 'cream',
    })
  })

  it('merges a theme import with changes made while the ZIP is being read', async () => {
    useUiStore.getState().setThemeLibrary(INITIAL_THEME_LIBRARY)
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify({
      format: 'bookdock-theme-package',
      version: 1,
      themes: [],
      palettes: [{ name: 'Imported palette', colors: { bg: '#132435', fg: '#ffffff', primary: '#e0a355' } }],
      assets: [],
    }))
    const bytes = await zip.generateAsync({ type: 'arraybuffer' })
    const read = Promise.withResolvers<ArrayBuffer>()
    const file = new File([bytes], 'themes.zip', { type: 'application/zip' })
    Object.defineProperty(file, 'arrayBuffer', { value: () => read.promise })
    const { container } = render(<ReadingThemesSettingsSection />)
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } })
    const edited = { ...INITIAL_THEME_LIBRARY.palettes[0]!, id: 'saved-during-import', name: 'Saved during import' }
    act(() => useUiStore.getState().setThemeLibrary({
      ...INITIAL_THEME_LIBRARY, palettes: [...INITIAL_THEME_LIBRARY.palettes, edited],
    }))
    read.resolve(bytes)
    await waitFor(() => expect(useUiStore.getState().themeLibrary.palettes.map(({ name }) => name))
      .toEqual(expect.arrayContaining([edited.name, 'Imported palette'])))
  })

  it('keeps the other slot choice while editing day and night', () => {
    useUiStore.setState({
      themeLibrary: INITIAL_THEME_LIBRARY, readingThemeMode: 'light', lightReadingThemeId: 'paper', darkReadingThemeId: 'night',
    })
    function BookThemeSettings() {
      const [theme, setTheme] = useState<ReaderBookThemeSettings>({
        selections: { light: { themeId: 'cream', paletteId: null }, dark: { themeId: 'sepia', paletteId: null } },
      })
      const slot = useUiStore(selectReadingThemeSlot)
      const state = useUiStore.getState()
      const globalState: GlobalAppearanceState = {
        lightReadingThemeId: state.lightReadingThemeId, darkReadingThemeId: state.darkReadingThemeId,
        lightPaletteId: null, darkPaletteId: null, cssMode: 'follow', cssId: null, highlightAdds: [], highlightRemoves: [],
      }
      return <ViewSettingsContext.Provider value={{
        ...settings(),
        groups: { theme } as ViewSettingsContextValue['groups'],
        appearance: resolveAppearance(state.themeLibrary, globalState, theme, slot),
        pickTheme: (themeId) => setTheme((current) => ({ ...current, selections: { ...current.selections, [slot]: { themeId, paletteId: null } } })),
      }}>
        <SettingsPanel bookId="book" />
      </ViewSettingsContext.Provider>
    }
    render(<BookThemeSettings />)
    fireEvent.click(screen.getByTitle('主题'))
    const themes = within(screen.getByRole('region', { name: '主题' }))
    expect(themes.getByRole('button', { name: '米黄' })).toHaveAttribute('aria-pressed', 'true')

    act(() => useUiStore.setState({ readingThemeMode: 'dark' }))
    expect(themes.getByRole('button', { name: '护眼' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('selects only custom items in edit mode and deletes them in one step', () => {
    const custom = { id: 'mine', name: '我的主题', cards: { paletteId: 'paper', cssId: null, highlightIds: [] } }
    useUiStore.getState().setThemeLibrary({
      ...INITIAL_THEME_LIBRARY,
      themes: [...INITIAL_THEME_LIBRARY.themes, custom],
      css: [{ id: 'css-a', name: '暗纹', contentCss: '', uiCss: '', assets: [] }],
    })
    render(<ReadingThemesSettingsSection />)
    fireEvent.click(screen.getByRole('button', { name: /编辑模式/ }))
    const themes = screen.getByRole('region', { name: '主题' })

    // 内置主题可拖不可勾：点它不改变选择，也不会打开编辑器
    fireEvent.click(within(themes).getByRole('button', { name: '白纸' }))
    expect(screen.getByText('已选 0 项')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(within(themes).getByRole('button', { name: '我的主题' }))
    fireEvent.click(within(screen.getByRole('region', { name: '自定义 CSS' })).getByRole('button', { name: '暗纹' }))
    expect(screen.getByText('已选 2 项')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '删除所选' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '删除' }))
    expect(useUiStore.getState().themeLibrary.themes.some(({ id }) => id === 'mine')).toBe(false)
    expect(useUiStore.getState().themeLibrary.css).toHaveLength(0)
  })

  it('retains image bytes saved by another tab when deleting from a stale library', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const scope = useAuthStore.getState().user?.id ?? 'device'
      const otherTab = new ThemeAssetStore()
      const blob = new NativeBlob(['image data'], { type: 'image/png' }) as unknown as Blob
      const assetId = 'asset-other-tab'
      await otherTab.storePrepared(scope, [{ key: assetId, image: {
        blob,
        asset: {
          id: assetId, scope, fileName: 'wallpaper.png', mime: 'image/png',
          size: blob.size, width: 1, height: 1, contentHash: 'hash', createdAt: 0,
        },
      } }])
      expect(await otherTab.getBlob(scope, assetId)).not.toBeNull()
      useUiStore.getState().setThemeLibrary({
        ...INITIAL_THEME_LIBRARY,
        css: [{ id: 'temporary', name: 'Temporary CSS', contentCss: '', uiCss: '', assets: [] }],
      })
      render(<ReadingThemesSettingsSection />)
      fireEvent.click(screen.getByRole('button', { name: /编辑模式/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Temporary CSS' }))
      fireEvent.click(screen.getByRole('button', { name: '删除所选' }))
      fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '删除' }))
      expect(useUiStore.getState().themeLibrary.css).toHaveLength(0)
      await act(() => vi.advanceTimersByTimeAsync(11_100))
      expect(await otherTab.getBlob(scope, assetId)).not.toBeNull()
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('keeps edits to the initial palette and does not reseed a deleted initial theme on read', () => {
    const migrated = readThemeLibrary(JSON.stringify({ version: 2, palettes: [], themes: [], css: [], highlights: [] }))!
    expect(migrated.themes).toHaveLength(4)
    const library = {
      ...migrated,
      palettes: migrated.palettes.map((palette) => palette.id === 'paper' ? { ...palette, colors: { ...palette.colors, bg: '#dddddd' } } : palette),
      themes: migrated.themes.filter((theme) => theme.id !== 'night'),
    }
    useUiStore.getState().setThemeLibrary(readThemeLibrary(serializeThemeLibrary(library))!)
    expect(useUiStore.getState().themeLibrary.themes.some(({ id }) => id === 'night')).toBe(false)
    expect(useUiStore.getState().customThemes.find(({ id }) => id === 'paper')?.colors.bg).toBe('#dddddd')
  })

  it('applies a whole theme, layers extra CSS and rules, and keeps the appearance out of the preset config', () => {
    const palette = { id: 'ink', name: '纸色', colors: { bg: '#111111', fg: '#eeeeee', primary: '#888888' } }
    const rule = { id: 'r1', name: '对白', pattern: '正文', enabled: true, isRegex: false }
    useUiStore.getState().setThemeLibrary({
      palettes: [...INITIAL_THEME_LIBRARY.palettes, palette],
      css: [{ id: 'c1', name: '章标题', contentCss: 'p { color: red }', uiCss: '', assets: [] }],
      highlights: [rule, { ...rule, id: 'r2', name: '书名' }, { ...rule, id: 'r3', name: '括号' }],
      themes: [...INITIAL_THEME_LIBRARY.themes,
        { id: 't1', name: '古籍', cards: { paletteId: palette.id, cssId: 'c1', highlightIds: ['r1', 'r2'] } },
        { id: 't2', name: '古籍无 CSS', cards: { paletteId: palette.id, cssId: null, highlightIds: ['r1', 'r2'] } },
        { id: 'rulesOnly', name: '只有规则', cards: { cssId: null, highlightIds: ['r1'] } },
      ],
    })
    render(<SettingsPanel bookId="book" />)
    fireEvent.click(screen.getByTitle('主题'))
    const card = (name: string) => screen.getByRole('button', { name, exact: true })
    const palettes = within(screen.getByRole('region', { name: '配色' }))

    // Picking a palette writes the global palette layer only; no theme chip is
    // auto-attributed to the assembled combination
    fireEvent.click(palettes.getByRole('button', { name: '米黄' }))
    expect(useUiStore.getState().lightPaletteId).toBe('cream')
    expect(within(screen.getByRole('region', { name: '主题' })).queryAllByRole('button', { pressed: true })).toHaveLength(0)

    // Picking a theme applies what it specifies (palette + css + rules)
    fireEvent.click(card('古籍'))
    expect(useUiStore.getState().lightReadingThemeId).toBe('t1')
    expect(useUiStore.getState().lightPaletteId).toBeNull()
    expect(useUiStore.getState().appearanceCssMode).toBe('follow')
    for (const name of ['古籍', '纸色', '章标题', '对白', '书名']) expect(card(name)).toHaveAttribute('aria-pressed', 'true')

    // A CSS-less theme retains the effective stylesheet. Clicking its CSS
    // card again turns it off.
    fireEvent.click(card('古籍无 CSS'))
    expect(useUiStore.getState()).toMatchObject({ appearanceCssMode: 'card', appearanceCssId: 'c1' })
    expect(card('古籍无 CSS')).toHaveAttribute('aria-pressed', 'true')
    expect(card('章标题')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(card('章标题'))
    expect(useUiStore.getState().appearanceCssMode).toBe('off')
    expect(card('古籍无 CSS')).toHaveAttribute('aria-pressed', 'true')

    // Extra highlight rules keep the theme selected; disabling a theme rule
    // does not
    fireEvent.click(card('括号'))
    expect(card('古籍无 CSS')).toHaveAttribute('aria-pressed', 'true')
    expect(card('括号')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(card('对白'))
    expect(card('古籍无 CSS')).toHaveAttribute('aria-pressed', 'false')
    expect(card('书名')).toHaveAttribute('aria-pressed', 'true')
    expect(useUiStore.getState().highlightRemoves).toEqual(['r1'])
    fireEvent.click(card('对白'))
    expect(card('古籍无 CSS')).toHaveAttribute('aria-pressed', 'true')
    expect(useUiStore.getState().highlightRemoves).toEqual([])

    // A highlight-only theme applies its rules while palette and CSS continue
    // (7 themes exceed the collapsed row: expand first)
    fireEvent.click(within(screen.getByRole('region', { name: '主题' })).getByRole('button', { name: '更多' }))
    fireEvent.click(card('只有规则'))
    expect(card('只有规则')).toHaveAttribute('aria-pressed', 'true')
    expect(card('纸色')).toHaveAttribute('aria-pressed', 'true')

    // Appearance layers fold into the config's global snapshot but never into
    // a preset snapshot
    const after = parseReadingConfig(useUiStore.getState().readingConfig)
    expect(after?.global.lightReadingThemeId).toBe('rulesOnly')
    expect(after?.global.lightPaletteId).toBe('ink')
    expect(after?.global.highlightAdds).toEqual(['r3', 'r1'])
    expect(after?.presets).toHaveLength(0)
  })

  it('creates an independent CSS card inside a theme and reuses it from another theme', () => {
    render(<SettingsPanel bookId="book" />)
    fireEvent.click(screen.getByTitle('主题'))
    fireEvent.click(screen.getByRole('button', { name: '新建主题' }))
    const theme = within(screen.getByRole('dialog', { name: '新建主题' }))
    fireEvent.change(theme.getByRole('textbox', { name: '名称' }), { target: { value: '第一套' } })
    fireEvent.click(theme.getByRole('button', { name: '新建 CSS' }))
    const css = within(screen.getByRole('dialog', { name: '新建 CSS' }))
    fireEvent.change(css.getByRole('textbox', { name: '名称' }), { target: { value: '章标题' } })
    fireEvent.change(css.getByRole('textbox', { name: '正文 CSS' }), { target: { value: 'p { color: red }' } })
    fireEvent.click(css.getByRole('button', { name: '保存' }))
    const savedCard = useUiStore.getState().themeLibrary.css[0]!
    expect(theme.getByRole('combobox', { name: '自定义 CSS' })).toHaveValue(savedCard.id)
    fireEvent.click(theme.getByRole('button', { name: '保存' }))
    fireEvent.click(screen.getByRole('button', { name: '新建主题' }))
    const next = within(screen.getByRole('dialog', { name: '新建主题' }))
    fireEvent.change(next.getByRole('textbox', { name: '名称' }), { target: { value: '第二套' } })
    fireEvent.change(next.getByRole('combobox', { name: '自定义 CSS' }), { target: { value: savedCard.id } })
    fireEvent.click(next.getByRole('button', { name: '保存' }))
    const library = useUiStore.getState().themeLibrary
    expect(library.themes.slice(-2).map((item) => item.cards.cssId)).toEqual([savedCard.id, savedCard.id])
    expect(readThemeLibrary(serializeThemeLibrary(library))).toEqual(library)
    fireEvent.contextMenu(screen.getByRole('button', { name: '章标题' }))
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    const editor = within(screen.getByRole('dialog', { name: '编辑 CSS' }))
    fireEvent.change(editor.getByRole('textbox', { name: '正文 CSS' }), { target: { value: 'p { color: blue }' } })
    fireEvent.click(editor.getByRole('button', { name: '保存' }))
    expect(useUiStore.getState().customThemes.slice(-2).map((item) => item.contentCss)).toEqual(['p { color: blue }', 'p { color: blue }'])
  })

  it('tests CSS on the active book with the editor closed and leaves no draft behind on a book switch', () => {
    const { rerender } = render(<SettingsPanel bookId="first-book" />)
    fireEvent.click(screen.getByTitle('主题'))
    fireEvent.click(screen.getByRole('button', { name: '新建 CSS' }))
    fireEvent.change(screen.getByRole('textbox', { name: '正文 CSS' }), { target: { value: 'p { color: red }' } })
    fireEvent.click(screen.getByRole('button', { name: '预览' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(useUiStore.getState().readerThemeTrial?.contentCss).toBe('p { color: red }')
    fireEvent.click(screen.getByRole('button', { name: '返回编辑' }))
    expect(screen.getByRole('textbox', { name: '正文 CSS' })).toHaveValue('p { color: red }')
    expect(useUiStore.getState().readerThemeTrial).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '预览' }))

    rerender(<SettingsPanel bookId="second-book" />)
    expect(useUiStore.getState().readerThemeTrial).toBeNull()
    expect(useUiStore.getState().themeLibrary.css).toEqual([])
  })

  it('keeps the local font preview mounted between CSS editor tabs', () => {
    useDeviceFontStore.setState({ status: 'ready', fonts: [deviceFont] })
    const { unmount } = render(<SettingsPanel bookId="book" />)
    fireEvent.click(screen.getByTitle('主题'))
    fireEvent.click(screen.getByRole('button', { name: '新建 CSS' }))
    const css = within(screen.getByRole('dialog', { name: '新建 CSS' }))
    expect(css.queryByTitle(deviceFont.family)).toBeNull()
    const fontsTab = css.getByRole('button', { name: /字体参考/ })
    fireEvent.click(fontsTab)
    const font = css.getByTitle(deviceFont.family)
    fireEvent.click(css.getByRole('button', { name: /图片素材/ }))
    expect(font).not.toBeVisible()
    fireEvent.click(fontsTab)
    expect(css.getByTitle(deviceFont.family)).toBe(font)
    expect(font).toBeVisible()
    unmount()
    expect(font).not.toBeInTheDocument()
  })

  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    localStorage.removeItem('bd-settings-section')
    mockUploadedFonts([])
    useUiStore.getState().setThemeLibrary(INITIAL_THEME_LIBRARY)
    useFontLoaderStore.setState({ loadedIds: [], loadingIds: [], latinIds: [] })
    useUiStore.setState({
      fontFamily: 'sans-serif',
      cjkFontFamily: 'sans-serif',
      fontSize: 18,
      fontWeight: 400,
      lineHeight: 1.8,
      paragraphSpacing: 0.5,
      chapterTitleAlign: 'center',
      chapterTitleSize: 1.5,
      chapterTitleTopSpacing: 1.5,
      chapterTitleBottomSpacing: 2.25,
      letterSpacing: 0,
      indent: 2,
      readingThemeMode: 'light',
      readingThemeId: 'paper',
      lightReadingThemeId: 'paper',
      darkReadingThemeId: 'night',
      lightPaletteId: null,
      darkPaletteId: null,
      appearanceCssMode: 'follow',
      appearanceCssId: null,
      highlightAdds: [],
      highlightRemoves: [],
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
      clickAreaMode: 'standard',
    })
  })

  const primaryRow = () => (screen.queryByText('主字体') ?? screen.getByText('字体')).parentElement!.parentElement!
  const cjkRow = () => screen.getByText('中文字体').parentElement!.parentElement!
  it('renders font section by default without CJK companion for CJK primary font', () => {
    render(<SettingsPanel overrideSupported />)

    expect(screen.getByText('字体')).toBeInTheDocument()
    expect(screen.queryByText('中文字体')).not.toBeInTheDocument()
    expect(screen.getByText('字号')).toBeInTheDocument()
    expect(screen.getByText('字体粗细')).toBeInTheDocument()
    expect(screen.getByText('覆盖书籍字体')).toBeInTheDocument()
  })

  it('loads visible device previews once and keeps them across reader settings closes', async () => {
    const localFonts = Array.from({ length: 9 }, (_, index) => ({
      ...deviceFont,
      id: `device-preview-${index}`,
      family: `Device SimSun ${index}`,
    }))
    useUiStore.setState({ fontPreferences: ONLY_DEVICE_ENABLED })
    useDeviceFontStore.setState({ status: 'ready', fonts: localFonts, order: localFonts.map(({ id }) => id) })
    const fontFaceSet = Object.getOwnPropertyDescriptor(document, 'fonts')
    const loadFont = vi.fn().mockResolvedValue([{}])
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load: loadFont } })
    let finishFirst!: (url: string) => void
    const first = new Promise<string>((resolve) => { finishFirst = resolve })
    const ensure = vi.spyOn(readerFonts, 'ensureDeviceFontFace').mockImplementation((font) =>
      font.id === localFonts[0]!.id ? first : Promise.resolve(null))
    const release = vi.spyOn(readerFonts, 'releaseDeviceFontFace').mockImplementation(() => {})
    function Reader({ open }: { open: boolean }) {
      const previews = useReaderFontPreviews()
      return open ? <SettingsPanel fontPreviews={previews} /> : null
    }
    const { rerender, unmount } = render(<Reader open />)
    try {
      const getChip = () => screen.getByRole('button', { name: localFonts[0]!.family })
      expect(ensure).toHaveBeenCalledTimes(8)
      expect(getChip().textContent).toBe(localFonts[0]!.family)
      expect(getChip().style.fontFamily).toContain(`bd-font-${localFonts[0]!.id}`)
      expect(loadFont).not.toHaveBeenCalled()
      await act(async () => finishFirst('blob:font'))
      expect(loadFont).toHaveBeenCalledWith(expect.stringContaining(localFonts[0]!.id), localFonts[0]!.family)
      fireEvent.click(screen.getByTitle('主题'))
      expect(release).not.toHaveBeenCalled()
      fireEvent.click(screen.getByTitle('字体'))
      expect(getChip().textContent).toBe(localFonts[0]!.family)
      rerender(<Reader open={false} />)
      expect(release).not.toHaveBeenCalled()
      rerender(<Reader open />)
      expect(getChip().textContent).toBe(localFonts[0]!.family)
      expect(ensure).toHaveBeenCalledTimes(8)
      expect(loadFont).toHaveBeenCalledTimes(1)
      fireEvent.click(within(primaryRow()).getByRole('button', { name: '更多' }))
      expect(ensure).toHaveBeenCalledTimes(9)
      unmount()
      expect(release).toHaveBeenCalledTimes(9)
    } finally {
      unmount()
      ensure.mockRestore()
      release.mockRestore()
      if (fontFaceSet) Object.defineProperty(document, 'fonts', fontFaceSet)
      else Reflect.deleteProperty(document, 'fonts')
    }
  })

  it('hides marginal font size when both info bar sections are disabled', () => {
    useUiStore.setState({ showHeader: false, showFooter: false })
    render(<SettingsPanel />)

    fireEvent.click(screen.getByTitle('显示'))
    expect(screen.queryByText('信息栏字号')).not.toBeInTheDocument()
  })

  it('reveals CJK companion row when a Latin primary font is selected', () => {
    useUiStore.setState({ fontFamily: 'serif-en' })
    render(<SettingsPanel />)

    expect(screen.queryByText('在线字体')).not.toBeInTheDocument()
    expect(screen.queryByText('系统字体')).not.toBeInTheDocument()
    expect(screen.queryByText('我的字体')).not.toBeInTheDocument()
    expect(screen.getByText('主字体')).toBeInTheDocument()
    expect(screen.getByText('中文字体')).toBeInTheDocument()
    // primary: 4 online + 6 system = 10 options, header expand button + first 7 chips + promoted selected font '西文衬线'
    const primary = within(primaryRow())
    expect(primary.getAllByRole('button')).toEqual(
      ['更多', '黑体', '宋体', '思源宋体', '思源黑体', '霞鹜文楷', '楷体', '仿宋', '西文衬线']
        .map((name) => primary.getByRole('button', { name, exact: true })),
    )
    expect(within(primaryRow()).getByText('霞鹜文楷')).toBeInTheDocument()
    // cjk: 4 system + 3 online = 7 options, all 7 chips fit without an expand button
    expect(within(cjkRow()).getByText('霞鹜文楷')).toBeInTheDocument()
    expect(within(cjkRow()).getByText('思源宋体')).toBeInTheDocument()
    expect(within(cjkRow()).getByText('思源黑体')).toBeInTheDocument()

    fireEvent.click(within(primaryRow()).getByRole('button', { name: '更多' }))
    expect(within(primaryRow()).getByRole('button', { name: '收起' })).toBeInTheDocument()
    expect(within(primaryRow()).getByText('仿宋')).toBeInTheDocument()
    expect(within(primaryRow()).getByText('西文无衬线')).toBeInTheDocument()
  })

  it('collapses to 8 chips plus header expand button, and expands in place', () => {
    mockUploadedFonts([
      { id: 'up1', family: '我的手写体', fileName: 'a.ttf', format: 'ttf', size: 1024, scope: 'user', mine: true, createdAt: 0 },
      { id: 'up2', family: '另一款字体', fileName: 'b.ttf', format: 'ttf', size: 1024, scope: 'user', mine: true, createdAt: 0 },
    ])
    render(<SettingsPanel />)

    // 12 primary options; entries past slot 8 hide behind More
    expect(within(primaryRow()).getByText('黑体')).toBeInTheDocument()
    expect(within(primaryRow()).getByText('宋体')).toBeInTheDocument()
    expect(within(primaryRow()).getByRole('button', { name: '更多' })).toBeInTheDocument()
    expect(within(primaryRow()).getByText('楷体')).toBeInTheDocument()
    expect(within(primaryRow()).getByText('仿宋')).toBeInTheDocument()
    expect(within(primaryRow()).getByText('霞鹜文楷')).toBeInTheDocument()
    expect(within(primaryRow()).queryByText('我的手写体')).not.toBeInTheDocument()

    fireEvent.click(within(primaryRow()).getByRole('button', { name: '更多' }))
    expect(within(primaryRow()).getByRole('button', { name: '收起' })).toBeInTheDocument()
    expect(within(primaryRow()).getByText('我的手写体')).toBeInTheDocument()
    expect(within(primaryRow()).getByText('另一款字体')).toBeInTheDocument()

    fireEvent.click(within(primaryRow()).getByRole('button', { name: '收起' }))
    expect(within(primaryRow()).getByText('楷体')).toBeInTheDocument()
    expect(screen.queryByText('我的手写体')).not.toBeInTheDocument()
    expect(within(primaryRow()).getByRole('button', { name: '更多' })).toBeInTheDocument()
  })

  it('promotes a hidden selected font into the last visible slot', () => {
    mockUploadedFonts([
      { id: 'up1', family: '我的手写体', fileName: 'a.ttf', format: 'ttf', size: 1024, scope: 'user', mine: true, createdAt: 0 },
      { id: 'up2', family: '另一款字体', fileName: 'b.ttf', format: 'ttf', size: 1024, scope: 'user', mine: true, createdAt: 0 },
    ])
    useUiStore.setState({ fontFamily: 'up2' })
    render(<SettingsPanel />)

    // The selected second uploaded font is hidden by default and is promoted
    // while the 8th default font (sans) shifts out
    expect(screen.getByText('另一款字体')).toBeInTheDocument()
    expect(screen.getAllByText('黑体')).toHaveLength(1)
    expect(screen.getAllByText('宋体')).toHaveLength(1)
    expect(screen.queryByText('西文无衬线')).not.toBeInTheDocument()
  })

  it('lists uploaded fonts at the end and selects them by id', () => {
    mockUploadedFonts([
      { id: 'up1', family: '我的手写体', fileName: 'hand.ttf', format: 'ttf', size: 1024, scope: 'user', mine: true, createdAt: 0 },
    ])
    render(<SettingsPanel />)

    fireEvent.click(within(primaryRow()).getByRole('button', { name: '更多' }))
    fireEvent.click(within(primaryRow()).getByText('我的手写体'))
    expect(useUiStore.getState().fontFamily).toBe('up1')
  })

  it('selects a builtin font by id', () => {
    render(<SettingsPanel />)

    fireEvent.click(within(primaryRow()).getByRole('button', { name: '更多' }))
    fireEvent.click(within(primaryRow()).getByText('霞鹜文楷'))
    expect(useUiStore.getState().fontFamily).toBe('lxgw-wenkai')
  })

  it('selects a CJK companion without changing the primary font', () => {
    useUiStore.setState({ fontFamily: 'serif-en' })
    render(<SettingsPanel />)

    fireEvent.click(within(cjkRow()).getByText('霞鹜文楷'))
    expect(useUiStore.getState().cjkFontFamily).toBe('lxgw-wenkai')
    expect(useUiStore.getState().fontFamily).toBe('serif-en')
  })

  it('switches to layout section', () => {
    render(<SettingsPanel overrideSupported />)

    const layoutButton = screen.getByTitle('布局')
    fireEvent.click(layoutButton)

    expect(screen.getByText('页面宽度')).toBeInTheDocument()
    expect(screen.getByText('上下边距')).toBeInTheDocument()
    expect(screen.getByText('左右边距')).toBeInTheDocument()
    expect(screen.getByText('覆盖书籍布局')).toBeInTheDocument()
    expect(screen.getByText('章节标题')).toBeInTheDocument()
    expect(screen.getByText('对齐方式')).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: '页面宽度' })).toHaveValue('800')
    expect(screen.getByRole('slider', { name: '行间距' })).toHaveValue('1.8')
    expect(screen.getByText('两端对齐')).toBeInTheDocument()
    expect(screen.getByText('上边距').parentElement?.parentElement?.querySelector('input[type="range"]')).toHaveAttribute('max', '6')
    expect(screen.getByText('下边距').parentElement?.parentElement?.querySelector('input[type="range"]')).toHaveAttribute('max', '6')
    fireEvent.click(screen.getByRole('button', { name: '靠右' }))
    expect(useUiStore.getState().chapterTitleAlign).toBe('end')
  })

  it('switches to display section and shows the three semantic groups', () => {
    render(<SettingsPanel />)

    const displayButton = screen.getByTitle('显示')
    fireEvent.click(displayButton)

    expect(screen.getByText('阅读方式')).toBeInTheDocument()
    expect(screen.getByText('正文显示')).toBeInTheDocument()
    expect(screen.getByText('阅读辅助')).toBeInTheDocument()

    expect(screen.getByText('阅读模式')).toBeInTheDocument()
    expect(screen.getByText('滚动')).toBeInTheDocument()
    expect(screen.getByText('翻页')).toBeInTheDocument()
    // header/footer info bar toggles show in both reading modes now
    expect(screen.getByText('页眉')).toBeInTheDocument()
    expect(screen.getByText('页脚')).toBeInTheDocument()

    fireEvent.click(screen.getByText('翻页'))
    expect(screen.getByText('分栏数')).toBeInTheDocument()
  })

  it('switches to theme section', () => {
    render(<SettingsPanel />)

    const themeButton = screen.getByTitle('主题')
    fireEvent.click(themeButton)

    const palettes = within(screen.getByRole('region', { name: '配色' }))
    for (const name of ['白纸', '米黄', '护眼', '夜间']) expect(palettes.getByRole('button', { name })).toBeInTheDocument()
  })

  it('toggles two-column justify switch in the layout section', () => {
    render(<SettingsPanel />)

    fireEvent.click(screen.getByTitle('布局'))
    const justifyButton = screen.getByRole('switch', { name: /两端对齐/ })
    expect(justifyButton).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(justifyButton)
    expect(justifyButton).toHaveAttribute('aria-checked', 'true')
    expect(useUiStore.getState().textAlignJustify).toBe(true)
  })

  it('shows continuous scroll options in scroll mode', () => {
    render(<SettingsPanel />)

    fireEvent.click(screen.getByTitle('显示'))

    expect(screen.getByText('连续滚动')).toBeInTheDocument()
    expect(screen.getByText('关闭')).toBeInTheDocument()
    expect(screen.getByText('跳章')).toBeInTheDocument()
    expect(screen.getByText('长卷')).toBeInTheDocument()

    fireEvent.click(screen.getByText('跳章'))
    expect(useUiStore.getState().continuousScroll).toBe('snap')

    fireEvent.click(screen.getByText('长卷'))
    expect(useUiStore.getState().continuousScroll).toBe('seamless')

    fireEvent.click(screen.getByText('关闭'))
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

  it('auto-fallback onto a device font writes the device selection, never the account settings', async () => {
    useDeviceFontStore.setState({ status: 'ready', fonts: [deviceFont], preferences: {}, order: [], selection: { primary: null, cjk: null } })
    useUiStore.setState({ fontPreferences: ONLY_DEVICE_ENABLED })
    render(<SettingsPanel />)

    await waitFor(() => {
      expect(useDeviceFontStore.getState().selection).toEqual({ primary: deviceFont.id, cjk: deviceFont.id })
    })
    expect(useUiStore.getState().fontFamily).toBe('sans-serif')
    expect(useUiStore.getState().cjkFontFamily).toBe('sans-serif')
    expect(useUiStore.getState().readingConfig).not.toContain(deviceFont.id)
    // The load→classify→rebuild loop guard: classification state stays stable
    const latinBefore = useFontLoaderStore.getState().latinIds
    await act(async () => {})
    await act(async () => {})
    expect(Object.is(useFontLoaderStore.getState().latinIds, latinBefore)).toBe(true)
  })

  it('leaves the cjk selection untouched when only a latin device font is enabled', async () => {
    // A latin device font is not a CJK candidate: writing it into the cjk
    // slot and clearing it again would ping-pong between the two effects
    const latinDeviceFont: DeviceFontMeta = { ...deviceFont, id: 'device-latin1', family: 'Latin Device Text' }
    useDeviceFontStore.setState({ status: 'ready', fonts: [latinDeviceFont], preferences: {}, order: [], selection: { primary: null, cjk: null } })
    useUiStore.setState({ fontPreferences: ONLY_DEVICE_ENABLED })
    render(<SettingsPanel />)

    await waitFor(() => expect(useDeviceFontStore.getState().selection.primary).toBe(latinDeviceFont.id))
    expect(useDeviceFontStore.getState().selection.cjk).toBeNull()
    const selectionBefore = useDeviceFontStore.getState().selection
    await act(async () => {})
    await act(async () => {})
    // Reference equality: no clear/write ping-pong touched the selection
    expect(useDeviceFontStore.getState().selection).toBe(selectionBefore)
    expect(useUiStore.getState().cjkFontFamily).toBe('sans-serif')
    expect(useUiStore.getState().readingConfig).not.toContain(latinDeviceFont.id)
  })

  it('non-device auto-fallback clears the device override and writes the account settings', async () => {
    useDeviceFontStore.setState({ status: 'ready', fonts: [], preferences: {}, order: [], selection: { primary: 'device-gone', cjk: null } })
    useUiStore.setState({ fontPreferences: { 'sans-serif': { enabled: false } } })
    render(<SettingsPanel />)

    await waitFor(() => expect(useUiStore.getState().fontFamily).toBe('serif'))
    expect(useDeviceFontStore.getState().selection.primary).toBeNull()
    expect(useUiStore.getState().readingConfig).toContain('"fontFamily":"serif"')
    expect(useUiStore.getState().readingConfig).not.toContain('device-gone')
  })

  it('hides never-fetched builtins from members of instances that keep resource uploads off', () => {
    useAuthStore.setState({ user: { id: 'reader', username: 'reader', role: 'user' } })
    mockInstanceInfo(false)
    render(<SettingsPanel />)

    // No builtin is loaded in this environment: none of them appear
    expect(within(primaryRow()).queryByText('霞鹜文楷')).not.toBeInTheDocument()
    expect(within(primaryRow()).getByText('宋体')).toBeInTheDocument()

    // The instance owner keeps the full catalog with download entries
    cleanup()
    useAuthStore.setState({ user: { id: 'owner', username: 'owner', role: 'owner' } })
    render(<SettingsPanel />)
    expect(within(primaryRow()).getByText('霞鹜文楷')).toBeInTheDocument()
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

    expect(screen.getByRole('button', { name: /标准/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /单手/ }))
    expect(useUiStore.getState().clickAreaMode).toBe('fullscreen')

    fireEvent.click(screen.getByRole('button', { name: /单手/ }))
    expect(useUiStore.getState().clickAreaMode).toBe('none')

    fireEvent.click(screen.getByRole('button', { name: /反向/ }))
    expect(useUiStore.getState().clickAreaMode).toBe('swap')
  })

  it('toggles click-area info popover and dismisses on toggle or outside click', () => {
    render(<SettingsPanel />)

    fireEvent.click(screen.getByTitle('行为'))

    const hintBtn = screen.getByTitle('翻页点击区说明')
    expect(hintBtn).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '翻页点击区说明' })).not.toBeInTheDocument()

    // open popover card
    fireEvent.click(hintBtn)
    const dialog = screen.getByRole('dialog', { name: '翻页点击区说明' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText(/左侧上一页 · 右侧下一页 · 中间菜单/)).toBeInTheDocument()
    expect(screen.getByText(/两侧均翻下一页 · 中间菜单/)).toBeInTheDocument()
    expect(screen.getByText(/左侧下一页 · 右侧上一页 · 中间菜单/)).toBeInTheDocument()

    // toggle closed via clicking the hint button again
    fireEvent.click(hintBtn)
    expect(screen.queryByRole('dialog', { name: '翻页点击区说明' })).not.toBeInTheDocument()

    // reopen and close via outside click
    fireEvent.click(hintBtn)
    expect(screen.getByRole('dialog', { name: '翻页点击区说明' })).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('dialog', { name: '翻页点击区说明' })).not.toBeInTheDocument()
  })

  it('hides the text-replacements entry without a bookId', () => {
    render(<SettingsPanel />)

    fireEvent.click(screen.getByTitle('行为'))
    expect(screen.queryByText('文本替换')).not.toBeInTheDocument()
  })

  it('shows the text-replacements entry with the effective count in the behavior section', () => {
    mockReplacements([
      { id: 'p1', bookId: 'b1', scope: 'book', matchType: 'point', pattern: null, replacement: '好', isRegex: false, applyTo: 'content', enabled: true, name: null, group: null, spineHref: 'c1', textOffset: 1, originalText: '坏', createdAt: 0, updatedAt: 0 },
      { id: 'r1', bookId: null, scope: 'global', matchType: 'pattern', pattern: 'foo', replacement: null, isRegex: false, applyTo: 'content', enabled: true, effectiveEnabled: false, hasOverride: true, name: null, group: null, spineHref: null, textOffset: null, originalText: null, createdAt: 0, updatedAt: 0 },
      { id: 'r2', bookId: null, scope: 'global', matchType: 'pattern', pattern: 'bar', replacement: null, isRegex: false, applyTo: 'content', enabled: false, effectiveEnabled: true, hasOverride: true, name: null, group: null, spineHref: null, textOffset: null, originalText: null, createdAt: 0, updatedAt: 0 },
    ])
    render(<SettingsPanel bookId="b1" />)

    fireEvent.click(screen.getByTitle('行为'))
    expect(screen.getByText('文本替换')).toBeInTheDocument()
    // point patch enabled + pattern rule effective via override = 2 active
    expect(screen.getByText('2 条生效')).toBeInTheDocument()
  })

  it('adjusts font size using stepper buttons', () => {
    useUiStore.setState({ fontSize: 18 })
    render(<SettingsPanel />)

    const incBtn = screen.getByRole('button', { name: '放大字号' })
    const decBtn = screen.getByRole('button', { name: '缩小字号' })

    fireEvent.click(incBtn)
    expect(useUiStore.getState().fontSize).toBe(19)

    fireEvent.click(decBtn)
    expect(useUiStore.getState().fontSize).toBe(18)
  })

  it('toggles switch when clicking on the row text container', () => {
    render(<SettingsPanel />)

    fireEvent.click(screen.getByTitle('布局'))
    const labelText = screen.getByText('两端对齐')
    const justifySwitch = screen.getByRole('switch', { name: /两端对齐/ })
    expect(justifySwitch).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(labelText)
    expect(justifySwitch).toHaveAttribute('aria-checked', 'true')
    expect(useUiStore.getState().textAlignJustify).toBe(true)
  })

  it('displays group labels and auto width in layout section', () => {
    useUiStore.setState({ readingMode: 'page', pageWidth: 0 })
    render(<SettingsPanel />)

    fireEvent.click(screen.getByTitle('布局'))

    expect(screen.getByText('版面尺寸')).toBeInTheDocument()
    expect(screen.getByText('文字排版')).toBeInTheDocument()
    expect(screen.getByText('自适应')).toBeInTheDocument()
  })

  it('only displays column gap when page columns is greater than 1', () => {
    useUiStore.setState({ readingMode: 'page', pageColumns: 1 })
    render(<SettingsPanel />)

    fireEvent.click(screen.getByTitle('显示'))
    expect(screen.queryByText('分栏间距')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '2' }))
    expect(screen.getByText('分栏间距')).toBeInTheDocument()
  })

  it('collapses header, footer, and idea secondary controls when toggled off, and restores on re-enable', () => {
    useUiStore.setState({
      showHeader: true,
      headerLeft: 'bookTitle',
      headerCenter: 'none',
      headerRight: 'time',
      showFooter: true,
      footerLeft: 'chapterProgress',
      footerCenter: 'none',
      footerRight: 'chapterWordCount',
      showFriendIdeas: true,
      ideaDisplayMode: 'sidebar',
    })
    render(<SettingsPanel />)

    fireEvent.click(screen.getByTitle('显示'))

    // Headers and footers are open: 3 distinct select dropdowns with position markers exist
    const headerLeftSelect = screen.getByRole('combobox', { name: '页眉（左）' })
    const headerCenterSelect = screen.getByRole('combobox', { name: '页眉（中）' })
    const headerRightSelect = screen.getByRole('combobox', { name: '页眉（右）' })
    expect(headerLeftSelect).toHaveValue('bookTitle')
    expect(headerCenterSelect).toHaveValue('none')
    expect(headerRightSelect).toHaveValue('time')

    const footerLeftSelect = screen.getByRole('combobox', { name: '页脚（左）' })
    const footerRightSelect = screen.getByRole('combobox', { name: '页脚（右）' })
    expect(footerLeftSelect).toHaveValue('chapterProgress')
    expect(footerRightSelect).toHaveValue('chapterWordCount')

    // Idea display mode is open
    expect(screen.getByText('想法展示方式')).toBeInTheDocument()
    expect(screen.getByText('侧边栏')).toBeInTheDocument()
    expect(screen.getByText('居中卡片')).toBeInTheDocument()

    // Turn off Header
    const headerToggle = screen.getByRole('switch', { name: '页眉' })
    fireEvent.click(headerToggle)
    expect(useUiStore.getState().showHeader).toBe(false)
    expect(screen.queryByRole('combobox', { name: '页眉（左）' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '页眉（中）' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '页眉（右）' })).not.toBeInTheDocument()
    // Values in store are not cleared
    expect(useUiStore.getState().headerLeft).toBe('bookTitle')
    expect(useUiStore.getState().headerRight).toBe('time')

    // Turn off Footer
    const footerToggle = screen.getByRole('switch', { name: '页脚' })
    fireEvent.click(footerToggle)
    expect(useUiStore.getState().showFooter).toBe(false)
    expect(screen.queryByRole('combobox', { name: '页脚（左）' })).not.toBeInTheDocument()
    expect(useUiStore.getState().footerLeft).toBe('chapterProgress')

    // Turn off Friend Ideas: ideaDisplayMode stays available because it also governs own ideas
    const ideasToggle = screen.getByRole('switch', { name: '显示书友想法' })
    fireEvent.click(ideasToggle)
    expect(useUiStore.getState().showFriendIdeas).toBe(false)
    expect(screen.getByText('想法展示方式')).toBeInTheDocument()
    expect(screen.getByText('侧边栏')).toBeInTheDocument()

    // Re-enable Header: original values are preserved and controls reappear
    fireEvent.click(headerToggle)
    expect(useUiStore.getState().showHeader).toBe(true)
    const restoredHeaderLeft = screen.getByRole('combobox', { name: '页眉（左）' })
    expect(restoredHeaderLeft).toHaveValue('bookTitle')

    // Re-enable Footer: original values preserved
    fireEvent.click(footerToggle)
    expect(useUiStore.getState().showFooter).toBe(true)
    const restoredFooterLeft = screen.getByRole('combobox', { name: '页脚（左）' })
    expect(restoredFooterLeft).toHaveValue('chapterProgress')

    // Re-enable Friend Ideas
    fireEvent.click(ideasToggle)
    expect(useUiStore.getState().showFriendIdeas).toBe(true)
  })

  it('keeps secondary controls out of keyboard focus order when collapsed', () => {
    useUiStore.setState({
      showHeader: false,
      showFooter: false,
      showFriendIdeas: false,
    })
    render(<SettingsPanel />)

    fireEvent.click(screen.getByTitle('显示'))

    // When collapsed, no combobox elements exist in the DOM, while independent idea display mode remains
    expect(screen.queryAllByRole('combobox')).toHaveLength(0)
    expect(screen.getByText('想法展示方式')).toBeInTheDocument()
  })

  it('only renders clean reading when cleanReadingSupported is true', () => {
    const { unmount } = render(<SettingsPanel cleanReadingSupported={false} />)
    fireEvent.click(screen.getByTitle('显示'))
    expect(screen.queryByText('纯净阅读')).not.toBeInTheDocument()
    unmount()

    render(<SettingsPanel cleanReadingSupported={true} />)
    fireEvent.click(screen.getByTitle('显示'))
    const cleanReadingSwitch = screen.getByRole('switch', { name: '纯净阅读' })
    expect(cleanReadingSwitch).toBeInTheDocument()
    expect(cleanReadingSwitch).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(cleanReadingSwitch)
    expect(cleanReadingSwitch).toHaveAttribute('aria-checked', 'true')
    expect(useUiStore.getState().cleanReading).toBe(true)
  })

  it('updates display settings via standard store setters', () => {
    useUiStore.setState({
      showHeader: true,
      showFriendIdeas: true,
      pageAnimation: false,
    })
    render(<SettingsPanel />)

    fireEvent.click(screen.getByTitle('显示'))

    // Changing headerLeft
    const headerLeft = screen.getByRole('combobox', { name: '页眉（左）' })
    fireEvent.change(headerLeft, { target: { value: 'chapter' } })
    expect(useUiStore.getState().headerLeft).toBe('chapter')

    // Changing ideaDisplayMode
    fireEvent.click(screen.getByRole('button', { name: '居中卡片' }))
    expect(useUiStore.getState().ideaDisplayMode).toBe('modal')

    // Toggling page animation
    const pageAnimSwitch = screen.getByRole('switch', { name: '翻页动画' })
    fireEvent.click(pageAnimSwitch)
    expect(useUiStore.getState().pageAnimation).toBe(true)
  })
})
