import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'

import type { HighlightRuleDef } from '@bookdock/shared'

import { Button } from '@/components/ui/Button'
import CodeEditor, { type CodeEditorHandle } from '@/components/ui/CodeEditor'
import Modal from '@/components/ui/Modal'
import SegmentedControl from '@/components/ui/SegmentedControl'
import { localRecordId } from '@/features/local-library/id'
import { useTranslation } from '@/hooks/useTranslation'
import { notify } from '@/lib/notifications'
import { generateSmartPalette, isHexColor, type EffectiveThemeCss } from '@/lib/reading-theme'
import { cssAssetLocations, validateContentCss } from '@/lib/theme-css-guard'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'

import ColorPickerPopover from './ColorPickerPopover'
import HighlightRulesDraftSection from './HighlightRulesDraftSection'
import ThemeIcon from './ThemeIcon'
import ThemeTrialBar from './ThemeTrialBar'
import ThemeFontLibrary from './ThemeFontLibrary'
import { useThemeFontList } from './font-refs'
import { stageThemeAsset, useThemeAssetUrls } from './asset-urls'
import { prepareThemeAsset, THEME_ASSET_LIMITS, ThemeAssetError, ThemeAssetStore, type PreparedThemeAsset } from './assets'
import { createHighlightRuleId, defaultThemeDraft, highlightRuleIssue, legacyThemeToDraft, resolveDraftColors } from './draft'
import type { ThemeCssCard, ThemePalette } from './theme-library'

export type ThemeCardEdit =
  | { kind: 'palette'; card?: ThemePalette }
  | { kind: 'css'; card?: ThemeCssCard }
  | { kind: 'highlight'; card?: HighlightRuleDef }

interface ThemeEditorDialogProps {
  editor: ThemeCardEdit
  variant: 'default' | 'reader'
  onSave: (card: ThemeCardEdit) => void
  onClose: () => void
  onDelete?: () => void
  onTrial?: (draft: ThemeCardEdit | null) => void
}

const colors = [
  ['pageBg', 'reader.themePageBg'],
  ['outsideBg', 'reader.themeOutsideBg'],
  ['fg', 'reader.themeText'],
  ['primary', 'reader.themePrimary'],
] as const

function colorsEqual(a?: string, b?: string): boolean {
  if (!a || !b) return false
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

const formInput =
  'w-full min-w-0 rounded-lg border border-stone-300/70 bg-stone-500/5 px-3 py-2 text-sm text-current placeholder:text-current/35 outline-none transition-colors focus:border-stone-400 focus:bg-stone-500/10 focus:ring-1 focus:ring-stone-400/20 dark:border-stone-700/80'
const iconAction =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-current/60 hover:bg-stone-500/10 hover:text-current transition-colors disabled:opacity-35'

export default function ThemeEditorDialog({ editor, variant, onSave, onClose, onDelete, onTrial }: ThemeEditorDialogProps) {
  const _ = useTranslation()
  const inputId = useId()
  const scope = useAuthStore((s) => s.user?.id ?? 'device')
  const store = useMemo(() => new ThemeAssetStore(), [])
  const [name, setName] = useState(editor.card?.name ?? '')
  const [newId] = useState(localRecordId)
  const [palette, setPalette] = useState(() => editor.kind === 'palette' && editor.card ? legacyThemeToDraft(editor.card) : defaultThemeDraft())
  const [css, setCss] = useState<EffectiveThemeCss>(() => editor.kind === 'css' && editor.card ? editor.card : { contentCss: '', uiCss: '', assets: [] })
  const [cssTab, setCssTab] = useState<'content' | 'images' | 'fonts'>('content')
  const [visitedFontTab, setVisitedFontTab] = useState(false)
  const fontList = useThemeFontList()
  const codeEditorRef = useRef<CodeEditorHandle>(null)
  const savedScrollTop = useRef<number>(0)
  const [rules, setRules] = useState<HighlightRuleDef[]>(() => [editor.kind === 'highlight' && editor.card ? editor.card : {
    id: createHighlightRuleId(), name: '', pattern: '', enabled: true, isRegex: false, style: { backgroundColor: '#F5E3B8' },
  }])
  const [activeColorPicker, setActiveColorPicker] = useState<{
    key: 'pageBg' | 'outsideBg' | 'fg' | 'primary'
    anchorRect: DOMRect
  } | null>(null)

  const pageBg = palette.colors.pageBg ?? palette.colors.bg ?? '#ECECEC'
  const smartPalette = useMemo(() => generateSmartPalette(pageBg), [pageBg])
  const isSmartMatching = useMemo(() => {
    if (!isHexColor(pageBg)) return false
    return (
      colorsEqual(palette.colors.outsideBg ?? palette.colors.bg, smartPalette.outsideBg) &&
      colorsEqual(palette.colors.fg, smartPalette.fg) &&
      colorsEqual(palette.colors.primary, smartPalette.primary)
    )
  }, [palette.colors, smartPalette, pageBg])

  const handleSmartPalette = () => {
    const smart = generateSmartPalette(pageBg)
    setPalette((current) => ({
      ...current,
      colors: {
        ...current.colors,
        pageBg,
        outsideBg: smart.outsideBg,
        fg: smart.fg,
        primary: smart.primary,
        bg: smart.outsideBg,
      },
    }))
    notify.success({
      key: isSmartMatching ? 'reader.themeSmartPaletteAlreadyMatched' : 'reader.themeSmartPaletteDone',
    })
  }

  const [largeImage, setLargeImage] = useState<string | null>(null)
  const [removeImage, setRemoveImage] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [trial, setTrial] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const generation = useRef(0)
  const staged = useRef(new Map<string, { image: PreparedThemeAsset; release: () => void }>())
  const assetIds = useMemo(() => editor.kind === 'palette' ? (palette.wallpaperAssetId ? [palette.wallpaperAssetId] : []) : css.assets.map(({ id }) => id),
    [editor.kind, palette.wallpaperAssetId, css.assets])
  const { urls, missing } = useThemeAssetUrls(scope, assetIds)
  // Trial lives in the store, not in this component: leaving the editor by any
  // route — back, close, another card replacing this one — has to hand the
  // book back, or the preview outlives the dialog that started it.
  const onTrialRef = useRef(onTrial)
  onTrialRef.current = onTrial
  useEffect(() => () => { onTrialRef.current?.(null) }, [])
  useEffect(() => () => {
    generation.current++
    for (const entry of staged.current.values()) entry.release()
    staged.current.clear()
  }, [scope])
  useEffect(() => {
    for (const [id, entry] of staged.current) {
      if (assetIds.includes(id)) continue
      entry.release()
      staged.current.delete(id)
    }
  }, [assetIds])

  useEffect(() => {
    if (!palette.wallpaperAssetId || palette.wallpaperFileName) return
    let active = true
    const stagedAsset = staged.current.get(palette.wallpaperAssetId)?.image.asset
    if (stagedAsset?.fileName) {
      setPalette((current) => current.wallpaperFileName ? current : { ...current, wallpaperFileName: stagedAsset.fileName })
      return
    }
    store.list(scope).then((assets) => {
      if (!active) return
      const found = assets.find((a) => a.id === palette.wallpaperAssetId)
      if (found?.fileName) {
        setPalette((current) => current.wallpaperFileName ? current : { ...current, wallpaperFileName: found.fileName })
      }
    }).catch(() => {})
    return () => { active = false }
  }, [palette.wallpaperAssetId, palette.wallpaperFileName, scope, store])

  const cssIds = useMemo(() => new Set(css.assets.map(({ id }) => id)), [css.assets])
  const content = useMemo(() => validateContentCss(css.contentCss, { ids: cssIds }), [css.contentCss, cssIds])
  const cssTabs = useMemo(() => [
    {
      value: 'content' as const,
      label: (
        <span className="inline-flex items-center gap-1.5">
          <span>{_('reader.themeContentCss')}</span>
          {content.issues.length > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500/20 px-1 text-[10px] font-bold text-red-600 dark:text-red-400">
              {content.issues.length}
            </span>
          )}
        </span>
      ),
    },
    {
      value: 'images' as const,
      label: (
        <span className="inline-flex items-center gap-1.5">
          <span>{_('reader.themeAssetImages')}</span>
          {css.assets.length > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-stone-500/15 px-1 text-[10px] font-medium text-current/70">
              {css.assets.length}
            </span>
          )}
        </span>
      ),
    },
    {
      value: 'fonts' as const,
      label: (
        <span className="inline-flex items-center gap-1.5">
          <span>{_('reader.themeAssetFonts')}</span>
          {fontList.length > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-stone-500/15 px-1 text-[10px] font-medium text-current/70">
              {fontList.length}
            </span>
          )}
        </span>
      ),
    },
  ], [_, content.issues.length, css.assets.length, fontList.length])

  const handleCssTabChange = (nextTab: 'content' | 'images' | 'fonts') => {
    if (nextTab === 'fonts') setVisitedFontTab(true)
    if (cssTab === 'content') {
      const view = codeEditorRef.current?.getEditorView()
      if (view?.scrollDOM) {
        savedScrollTop.current = view.scrollDOM.scrollTop
      }
    }
    setCssTab(nextTab)
  }

  useEffect(() => {
    if (cssTab === 'content') {
      requestAnimationFrame(() => {
        const view = codeEditorRef.current?.getEditorView()
        if (view) {
          view.requestMeasure()
          if (savedScrollTop.current > 0) {
            view.scrollDOM.scrollTop = savedScrollTop.current
          }
        }
      })
    }
  }, [cssTab])

  const insertCssSnippet = (snippet: string) => {
    setCssTab('content')
    requestAnimationFrame(() => {
      if (codeEditorRef.current) {
        codeEditorRef.current.insertText(snippet)
      } else {
        setCss((curr) => {
          const trimmed = curr.contentCss.trimEnd()
          const nextContent = trimmed ? `${trimmed}\n\n${snippet}\n` : `${snippet}\n`
          return { ...curr, contentCss: nextContent }
        })
      }
    })
    notify.success({ key: 'reader.themeAssetInserted' })
  }
  const rule = rules[0]
  const valid = editor.kind === 'palette' ? colors.every(([field]) => isHexColor(palette.colors[field]))
    : editor.kind === 'css' ? content.ok : Boolean(rule && !highlightRuleIssue(rule))
  const cardName = (editor.kind === 'highlight' ? rule?.name : name)?.trim()
  const title = _(editor.kind === 'palette' ? 'reader.themePaletteLabel' : editor.kind === 'css' ? 'reader.themeCssLabel' : 'reader.themeHighlightRuleLabel')
  const buildCard = (): ThemeCardEdit => {
    const id = !editor.card ? newId : editor.card.id
    const name = cardName || title
    if (editor.kind === 'palette') return {
      kind: 'palette',
      card: {
        id,
        name,
        colors: resolveDraftColors(palette),
        wallpaperAssetId: palette.wallpaperAssetId,
        wallpaperFileName: palette.wallpaperFileName,
        wallpaperOpacity: palette.wallpaperOpacity,
        wallpaperBlur: palette.wallpaperBlur,
      },
    }
    if (editor.kind === 'css') return { kind: 'css', card: { ...css, id, name, contentCss: content.css, uiCss: '' } }
    return { kind: 'highlight', card: { ...rule!, id, name, enabled: true } }
  }

  const pickImage = async (file?: File) => {
    if (!file || busyRef.current) return
    const pickedAt = ++generation.current
    try {
      const image = await prepareThemeAsset(scope, file)
      const queued = [...staged.current.values()].find((entry) => entry.image.asset.contentHash === image.asset.contentHash)
      const existing = queued?.image.asset ?? (await store.list(scope)).find((asset) => asset.contentHash === image.asset.contentHash)
      if (pickedAt !== generation.current || scope !== (useAuthStore.getState().user?.id ?? 'device')) return
      const { id, fileName } = existing ?? image.asset
      if (editor.kind === 'css' && !cssIds.has(id) && cssIds.size >= THEME_ASSET_LIMITS.maxPerTheme) {
        notify.warning({ key: 'reader.themeAssetsLimit', params: { count: THEME_ASSET_LIMITS.maxPerTheme } })
        return
      }
      if (!existing) staged.current.set(id, { image, release: stageThemeAsset(scope, id, image.blob) })
      if (editor.kind === 'palette') setPalette((current) => ({
        ...current,
        wallpaperAssetId: id,
        wallpaperFileName: file.name || fileName,
      }))
      else setCss((current) => current.assets.some((item) => item.id === id) ? current : { ...current, assets: [...current.assets, { id, name: fileName }] })
    } catch (error) {
      if (pickedAt !== generation.current) return
      const category = error instanceof ThemeAssetError ? error.category : null
      notify.error({ key: category === 'too-large' ? 'reader.themeAssetTooLarge'
        : category === 'too-large-dimensions' ? 'reader.themeAssetTooLargeDimensions' : 'reader.themeAssetInvalid' })
    }
  }

  const save = async () => {
    if (!valid || !cardName || busyRef.current) return
    const card = buildCard()
    const started = ++generation.current
    const entries = assetIds.flatMap((id) => {
      const asset = staged.current.get(id)
      return asset ? [{ key: id, image: asset.image, keepId: true }] : []
    })
    busyRef.current = true
    setBusy(true)
    try {
      if (entries.length) await store.storePrepared(scope, entries)
      if (started === generation.current && scope === (useAuthStore.getState().user?.id ?? 'device')) onSave(card)
    } catch (error) {
      const full = error instanceof ThemeAssetError && (error.category === 'too-many' || error.category === 'storage-full')
      notify.error({ key: full ? 'reader.themeAssetsStorageFull' : 'reader.themeAssetSaveFailed' })
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const locationText = removeImage ? [
    { label: _('reader.themeContentCss'), code: css.contentCss },
  ].flatMap(({ label, code }) => {
    const lines = [...new Set(cssAssetLocations(code).filter(({ id }) => id === removeImage).map(({ line }) => line))]
    return lines.length ? [`${label} · ${lines.join(', ')}`] : []
  }) : []

  const assetRow = (id: string, label: string, wallpaper: boolean): ReactNode => (
    <li
      key={id}
      className="flex min-w-0 items-center gap-2.5 rounded-xl border border-stone-300/70 bg-stone-500/5 p-2 transition-colors dark:border-stone-700/80"
    >
      <button
        type="button"
        disabled={!urls[id]}
        onClick={() => setLargeImage(largeImage === id ? null : id)}
        aria-label={_('reader.themeViewAsset', { name: label })}
        title={_('reader.themeViewAsset', { name: label })}
        className="flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-black/10 bg-current/5 shadow-2xs"
      >
        {urls[id] ? <img src={urls[id]} alt="" className="h-full w-full object-cover" /> : <ThemeIcon name="image" size={15} />}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-xs font-medium text-current" title={label}>
          {label}
        </span>
        {missing.includes(id) && (
          <span className="text-[10px] text-amber-600 dark:text-amber-400">
            {_('reader.themeAssetMissingBadge')}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        {!wallpaper && (
          <>
            <button
              type="button"
              className={iconAction}
              title={_('reader.themeAssetInsert')}
              aria-label={_('reader.themeAssetInsert')}
              onClick={() => insertCssSnippet(`url("bd-asset:${id}")`)}
            >
              <ThemeIcon name="plus" size={13} />
            </button>
            <button
              type="button"
              className={iconAction}
              title={_('reader.themeAssetsCopyReference')}
              aria-label={_('reader.themeAssetsCopyReference')}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(`url("bd-asset:${id}")`)
                  notify.success({ key: 'reader.themeAssetsCopied' })
                } catch {
                  notify.error({ key: 'reader.themeAssetsCopyFailed' })
                }
              }}
            >
              <ThemeIcon name="copy" size={14} />
            </button>
          </>
        )}
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-red-500 transition-colors hover:bg-red-500/10"
          aria-label={_('reader.themeAssetsRemove')}
          title={_('reader.themeAssetsRemove')}
          onClick={() => {
            if (wallpaper) {
              setPalette((current) => ({ ...current, wallpaperAssetId: undefined }))
              if (largeImage === id) setLargeImage(null)
            } else setRemoveImage(id)
          }}
        >
          <ThemeIcon name="delete" size={14} />
        </button>
      </div>
    </li>
  )

  if (trial) return <ThemeTrialBar onBack={() => { onTrial?.(null); setTrial(false) }} />

  // The highlight editor puts its four style blocks on one row when there is
  // room, which needs a panel wider than the palette editor's to keep the HEX
  // inputs readable. CSS editing keeps the widest panel.
  const editorSize = editor.kind === 'css' ? '3xl' : editor.kind === 'highlight' ? 'wide' : 'xl'

  return (
    <Modal
      title={title}
      variant={variant}
      size={editorSize}
      panelClassName={editor.kind === 'css' ? 'h-[85vh] max-h-[720px] min-h-[500px]' : ''}
      contentClassName={editor.kind === 'css' ? 'flex flex-col min-h-0 overflow-hidden' : ''}
      containerProps={{ 'data-settings-toggle': '' }}
      onClose={() => {
        if (!busyRef.current) onClose()
      }}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <div>
            {!deleting && onTrial && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!valid || busy}
                onClick={() => {
                  onTrial(buildCard())
                  setTrial(true)
                }}
              >
                <ThemeIcon name="preview" size={14} />
                <span>{_('reader.themeTrial')}</span>
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={deleting ? () => setDeleting(false) : onClose}
            >
              {_('library.cancel')}
            </Button>
            {deleting ? (
              <Button type="button" variant="danger" size="sm" onClick={onDelete}>
                {_('reader.deleteTheme')}
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={!valid || busy || !cardName}
                onClick={() => void save()}
              >
                {_('reader.saveTheme')}
              </Button>
            )}
          </div>
        </div>
      }
    >
      {deleting ? (
        <p className="px-5 py-6 text-sm text-current/80">
          {_('reader.themeConfirmDeleteCard', { name: editor.card?.name ?? '' })}
        </p>
      ) : (
        <div className={`flex flex-col gap-3 px-1 py-1 ${editor.kind === 'css' ? 'flex-1 min-h-0' : 'gap-4.5'}`}>
          {editor.kind !== 'highlight' && (
            <label htmlFor={inputId} className="flex shrink-0 flex-col gap-1.5">
              <span className="text-xs font-medium text-current/80">{_('reader.themeName')}</span>
              <input
                id={inputId}
                aria-label={_('reader.themeName')}
                className={formInput}
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          )}
          {editor.kind !== 'highlight' && (
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                void pickImage(file)
              }}
            />
          )}
          {editor.kind === 'palette' && (
            <>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-current/80">{_('reader.themeColorSection')}</span>
                  <button
                    type="button"
                    onClick={handleSmartPalette}
                    aria-pressed={isSmartMatching}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all active:scale-95 cursor-pointer',
                      isSmartMatching
                        ? 'border-stone-400/60 bg-stone-500/15 text-current shadow-2xs ring-1 ring-stone-400/20 dark:border-stone-600/60'
                        : 'border-stone-300/70 bg-stone-500/5 text-current/75 hover:bg-stone-500/10 hover:text-current dark:border-stone-700/80',
                    )}
                    title={_('reader.themeSmartPalette')}
                  >
                    <ThemeIcon
                      name="spark"
                      size={13}
                      fill={isSmartMatching ? 'currentColor' : 'none'}
                      className={isSmartMatching ? 'text-amber-500 dark:text-amber-400' : 'text-current/60'}
                    />
                    <span>{_('reader.themeSmartPalette')}</span>
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {colors.map(([key, labelKey]) => {
                    const val = palette.colors[key] ?? ''
                    const hexVal = /^#[0-9a-f]{6}$/i.test(val) ? val : '#ffffff'
                    return (
                      <label key={key} className="flex min-w-0 flex-col gap-1.5">
                        <span className="text-xs font-medium text-current/80">{_(labelKey)}</span>
                        <div className="flex min-w-0 items-center gap-2 rounded-lg border border-stone-300/70 bg-stone-500/5 p-1.5 pr-2.5 transition-colors focus-within:border-stone-400 focus-within:bg-stone-500/10 focus-within:ring-1 focus-within:ring-stone-400/20 dark:border-stone-700/80">
                          <button
                            type="button"
                            aria-label={_(labelKey)}
                            title={_(labelKey)}
                            onClick={(e) => {
                              const rect = e.currentTarget.getBoundingClientRect()
                              setActiveColorPicker({ key, anchorRect: rect })
                            }}
                            className="relative h-7 w-7 shrink-0 cursor-pointer overflow-hidden rounded-md border border-black/15 shadow-2xs transition-transform hover:scale-105 active:scale-95"
                          >
                            <span className="absolute inset-0" style={{ backgroundColor: hexVal }} />
                          </button>
                          <input
                            value={val}
                            maxLength={9}
                            aria-label={`${_(labelKey)} HEX`}
                            spellCheck={false}
                            className="w-full min-w-0 bg-transparent font-mono text-xs uppercase text-current outline-none"
                            onChange={(e) =>
                              setPalette((current) => ({
                                ...current,
                                colors: { ...current.colors, [key]: e.target.value },
                              }))
                            }
                          />
                        </div>
                      </label>
                    )
                  })}
                </div>
              </div>
              {activeColorPicker && (
                <ColorPickerPopover
                  value={palette.colors[activeColorPicker.key] ?? '#FFFFFF'}
                  anchorRect={activeColorPicker.anchorRect}
                  onClose={() => setActiveColorPicker(null)}
                  onChange={(newColor) => {
                    setPalette((current) => ({
                      ...current,
                      colors: { ...current.colors, [activeColorPicker.key]: newColor },
                    }))
                  }}
                />
              )}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-current/80">{_('reader.themeWallpaper')}</span>
                {palette.wallpaperAssetId ? (
                  <>
                    <div className="flex items-center gap-3 rounded-xl border border-stone-300/70 bg-stone-500/5 p-2.5 dark:border-stone-700/80">
                      <button
                        type="button"
                        onClick={() => setLargeImage(palette.wallpaperAssetId!)}
                        aria-label={_('reader.themeViewAsset', { name: _('reader.themeWallpaper') })}
                        title={_('reader.themeViewAsset', { name: _('reader.themeWallpaper') })}
                        className="relative h-12 w-16 shrink-0 overflow-hidden rounded-lg border border-black/10 shadow-2xs transition-transform hover:scale-105 active:scale-95"
                        style={{ backgroundColor: palette.colors.pageBg ?? palette.colors.bg }}
                      >
                        {urls[palette.wallpaperAssetId] ? (
                          <img
                            src={urls[palette.wallpaperAssetId]}
                            alt=""
                            className="h-full w-full object-cover transition-[opacity,filter] duration-150"
                            style={{
                              opacity: palette.wallpaperOpacity ?? 1,
                              filter: palette.wallpaperBlur ? `blur(${palette.wallpaperBlur}px)` : undefined,
                            }}
                          />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-current/40">
                            <ThemeIcon name="image" size={16} />
                          </span>
                        )}
                      </button>
                      <div className="flex min-w-0 flex-1 flex-col justify-center">
                        <span
                          className="truncate text-xs font-medium text-current"
                          title={palette.wallpaperFileName || _('reader.themeWallpaper')}
                        >
                          {palette.wallpaperFileName || _('reader.themeWallpaper')}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setPalette((current) => ({
                              ...current,
                              wallpaperAssetId: undefined,
                              wallpaperFileName: undefined,
                            }))
                            if (largeImage === palette.wallpaperAssetId) setLargeImage(null)
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-red-500 hover:bg-red-500/10 transition-colors"
                          title={_('reader.themeWallpaperRemove')}
                          aria-label={_('reader.themeWallpaperRemove')}
                        >
                          <ThemeIcon name="delete" size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div className="flex flex-col gap-1.5 rounded-xl border border-stone-300/70 bg-stone-500/5 p-2.5 dark:border-stone-700/80">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-current/80 font-medium">{_('reader.themeWallpaperOpacity')}</span>
                          <span className="text-current/60 tabular-nums">{Math.round((palette.wallpaperOpacity ?? 1) * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0.1"
                          max="1"
                          step="0.05"
                          value={palette.wallpaperOpacity ?? 1}
                          onChange={(e) => setPalette((curr) => ({ ...curr, wallpaperOpacity: parseFloat(e.target.value) }))}
                          aria-label={_('reader.themeWallpaperOpacity')}
                          className="bd-slider w-full"
                          style={{ '--slider-fill': `${Math.round((((palette.wallpaperOpacity ?? 1) - 0.1) / 0.9) * 100)}%` } as React.CSSProperties}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5 rounded-xl border border-stone-300/70 bg-stone-500/5 p-2.5 dark:border-stone-700/80">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-current/80 font-medium">{_('reader.themeWallpaperBlur')}</span>
                          <span className="text-current/60 tabular-nums">{palette.wallpaperBlur ?? 0}px</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="20"
                          step="1"
                          value={palette.wallpaperBlur ?? 0}
                          onChange={(e) => setPalette((curr) => ({ ...curr, wallpaperBlur: parseInt(e.target.value, 10) }))}
                          aria-label={_('reader.themeWallpaperBlur')}
                          className="bd-slider w-full"
                          style={{ '--slider-fill': `${Math.round(((palette.wallpaperBlur ?? 0) / 20) * 100)}%` } as React.CSSProperties}
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-stone-300/80 bg-stone-500/5 py-3.5 text-xs font-medium text-current/70 transition-colors hover:border-stone-400 hover:bg-stone-500/10 hover:text-current dark:border-stone-700/80"
                  >
                    <ThemeIcon name="image" size={16} />
                    <span>{_('reader.themeWallpaperPick')}</span>
                  </button>
                )}
              </div>
            </>
          )}
          {editor.kind === 'css' && (
            <div className="flex flex-1 flex-col min-h-0 gap-3">
              <div className="shrink-0">
                <SegmentedControl
                  options={cssTabs}
                  value={cssTab}
                  onChange={handleCssTabChange}
                  fullWidth
                  size="md"
                />
              </div>

              <div className={cssTab === 'content' ? 'flex flex-1 flex-col min-h-0' : 'hidden'}>
                <CodeEditor
                  ref={codeEditorRef}
                  value={css.contentCss}
                  onChange={(contentCss) => setCss((current) => ({ ...current, contentCss }))}
                  language="css"
                  ariaLabel={_('reader.themeContentCss')}
                  placeholder={'/* 示例:\n[data-bd-chapter-title] {\n  color: #b45309 !important;\n}\n*/'}
                  issues={content.issues}
                  className="flex-1 min-h-0"
                  height="100%"
                  minHeight="0"
                />
              </div>

              {cssTab === 'images' && (
                <div className="flex flex-1 flex-col min-h-0 overflow-y-auto pr-1">
                  {css.assets.length === 0 ? (
                    <button
                      type="button"
                      onClick={() => fileInput.current?.click()}
                      className="flex flex-1 min-h-[180px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-stone-300/80 bg-stone-500/5 p-8 text-center transition-colors hover:border-stone-400 hover:bg-stone-500/10 dark:border-stone-700/80 cursor-pointer"
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-stone-500/10 text-current/60">
                        <ThemeIcon name="image" size={20} />
                      </div>
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-xs font-medium text-current/80">
                          {_('reader.themeAssetsAdd')}
                        </span>
                        <span className="text-[11px] text-current/50">
                          {_('reader.themeAssetsHint')}
                        </span>
                      </div>
                    </button>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300/70 bg-stone-500/5 px-2.5 py-1 text-xs font-medium text-current transition-colors hover:bg-stone-500/10 dark:border-stone-700/80"
                          onClick={() => fileInput.current?.click()}
                        >
                          <ThemeIcon name="plus" size={13} />
                          <span>{_('reader.themeAssetsAdd')}</span>
                        </button>
                      </div>
                      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {css.assets.map(({ id, name }) => assetRow(id, name, false))}
                      </ul>
                    </div>
                  )}
                  {removeImage && (
                    <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
                      <p className="font-medium text-current/90">
                        {_(locationText.length ? 'reader.themeAssetInUse' : 'reader.themeConfirmRemoveAsset')}
                      </p>
                      {!!locationText.length && (
                        <p className="mt-1 text-[11px] opacity-75">{locationText.join(' · ')}</p>
                      )}
                      <div className="mt-2.5 flex justify-end gap-1.5">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => setRemoveImage(null)}
                        >
                          {_('library.cancel')}
                        </Button>
                        {!locationText.length && (
                          <Button
                            type="button"
                            variant="danger"
                            size="sm"
                            onClick={() => {
                              setCss((current) => ({
                                ...current,
                                assets: current.assets.filter(({ id }) => id !== removeImage),
                              }))
                              if (largeImage === removeImage) setLargeImage(null)
                              setRemoveImage(null)
                            }}
                          >
                            {_('reader.themeAssetsRemove')}
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {visitedFontTab && (
                <div hidden={cssTab !== 'fonts'} className={cssTab === 'fonts' ? 'flex flex-1 flex-col min-h-0 overflow-y-auto pr-1' : 'hidden'}>
                  <ThemeFontLibrary fonts={fontList} onInsert={insertCssSnippet} />
                </div>
              )}
            </div>
          )}
          {editor.kind === 'highlight' && (
            <HighlightRulesDraftSection single rules={rules} onChange={setRules} />
          )}
          {largeImage && urls[largeImage] && (() => {
            const isWallpaper = editor.kind === 'palette' && largeImage === palette.wallpaperAssetId
            const bg = isWallpaper ? (palette.colors.pageBg ?? palette.colors.outsideBg ?? palette.colors.bg) : undefined
            return (
              <figure
                className="relative grid place-items-center overflow-hidden rounded-xl border border-current/10 p-3 transition-colors"
                style={{ backgroundColor: bg ?? 'color-mix(in srgb, currentColor 5%, transparent)' }}
              >
                <img
                  src={urls[largeImage]}
                  alt={css.assets.find(({ id }) => id === largeImage)?.name ?? _('reader.themeWallpaper')}
                  className="max-h-[50dvh] max-w-full rounded-lg object-contain transition-[opacity,filter] duration-150"
                  style={isWallpaper ? {
                    opacity: palette.wallpaperOpacity ?? 1,
                    filter: palette.wallpaperBlur ? `blur(${palette.wallpaperBlur}px)` : undefined,
                  } : undefined}
                />
                <button
                  type="button"
                  className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--bd-read-page-bg,white)] text-current/80 shadow-xs transition-colors hover:bg-stone-100 hover:text-current dark:hover:bg-stone-800"
                  aria-label={_('library.close')}
                  onClick={() => setLargeImage(null)}
                >
                  <ThemeIcon name="close" size={14} />
                </button>
              </figure>
            )
          })()}
        </div>
      )}
    </Modal>
  )
}
