import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { useQuery } from '@tanstack/react-query'

import type { BookDetailRes } from '@bookdock/shared'

import { apiGet } from '@/api/client'
import { useFonts } from '@/api/hooks/useFonts'
import QueryErrorState from '@/components/ui/QueryErrorState'
import { useTranslation } from '@/hooks/useTranslation'
import { avatarUrl } from '@/lib/avatar'
import { notify } from '@/lib/notifications'
import { getUserDisplayName, useAuthStore } from '@/stores/auth.store'
import { useUiStore } from '@/stores/ui.store'

import { markEscConsumed } from '../../lib/esc-consumed'

import { useReaderState } from '../../state/reader-state'
import { buildFontOptions, ensureBuiltinFontLoaded, ensureBuiltinFontsLoaded, ensureUploadedFontLoaded, resolveFont, useFontLoaderStore, type FontOption } from '../../fonts'
import { ChevronLeftIcon, CloseIcon, DownloadIcon, ShareIcon, SpinnerIcon, TemplateIcon } from '../annotation-icons'
import ShareCard, { SHARE_CARD_WIDTH } from './ShareCard'
import { BACKGROUND_OPTIONS, SHARE_CARD_TEMPLATES, loadShareCardPrefs, nextBrand, saveShareCardPrefs, type ShareCardPrefs } from './card-prefs'
import { copyCardBlob, downloadCardBlob, getCardBlob } from './export-image'
import { formatChineseDate, formatShareDate, shareFileName } from './share-text'

interface ShareCardDialogProps {
  bookId: string
}

const actionBtn =
  'flex flex-col items-center gap-1.5 text-xs text-stone-600 transition-colors hover:text-stone-900 disabled:opacity-50 dark:text-stone-400 dark:hover:text-stone-100'
const actionIcon =
  'flex h-12 w-12 items-center justify-center rounded-full bg-stone-100 transition-colors hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700'
const chip =
  'rounded-lg border border-stone-300 px-3 py-1.5 text-sm transition-colors hover:border-stone-500 dark:border-stone-700 dark:hover:border-stone-500'
const chipActive = 'border-stone-900 dark:border-stone-100'

/** Centered modal with a live card preview and image export actions. The card
 * DOM stays at SHARE_CARD_WIDTH; the preview scales down via transform on a
 * wrapper while the untransformed card node is what gets exported. */
export default function ShareCardDialog({ bookId }: ShareCardDialogProps) {
  const _ = useTranslation()
  const shareTarget = useReaderState((s) => s.shareTarget)
  const setShareTarget = useReaderState((s) => s.setShareTarget)
  const user = useAuthStore((s) => s.user)
  const authorName = getUserDisplayName(user, _('auth.guest'))
  const avatarKey = useAuthStore((s) => s.user?.avatarKey)
  const fontPreferences = useUiStore((s) => s.fontPreferences)
  const fontOrder = useUiStore((s) => s.fontOrder)
  const bookQuery = useQuery({
    queryKey: ['book', bookId],
    queryFn: () => apiGet<{ data: BookDetailRes }>(`/books/${bookId}`),
  })
  const { data: fontsData } = useFonts()
  const uploadedFonts = useMemo(() => fontsData?.data ?? [], [fontsData])
  const fontLoadedIds = useFontLoaderStore((s) => s.loadedIds)
  const fontLoadingIds = useFontLoaderStore((s) => s.loadingIds)
  const fontOptions = useMemo(
    () => buildFontOptions(uploadedFonts, { loadedIds: fontLoadedIds, loadingIds: fontLoadingIds }, fontPreferences, fontOrder),
    // loaded/loading ids feed a builtin option's status icon
    [uploadedFonts, fontLoadedIds, fontLoadingIds, fontPreferences, fontOrder],
  )
  const enabledFontOptions = useMemo(() => fontOptions.filter((option) => option.enabled), [fontOptions])

  const previewRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const [{ scale, height }, setMetrics] = useState({ scale: 1, height: 0 })
  const [exporting, setExporting] = useState(false)
  const [customizing, setCustomizing] = useState(false)
  const [prefs, setPrefs] = useState<ShareCardPrefs>(loadShareCardPrefs)

  useEffect(() => {
    if (!shareTarget || enabledFontOptions.some((option) => option.id === prefs.font)) return
    const fallback = enabledFontOptions[0]
    if (fallback) setPrefs((current) => ({ ...current, font: fallback.id }))
  }, [enabledFontOptions, prefs.font, shareTarget])

  const book = bookQuery.data?.data

  /** Snapshot of everything the exported image depends on — any change
   *  invalidates the cached render */
  const renderKey = useMemo(
    () =>
      JSON.stringify({
        template: prefs.template,
        font: prefs.font,
        background: prefs.background,
        brand: prefs.brand,
        note: shareTarget?.note ?? null,
        text: shareTarget?.text ?? '',
        title: book?.title ?? '',
        author: book?.author ?? '',
        chapter: shareTarget?.chapter ?? null,
        user: authorName,
        avatar: avatarKey ?? null,
        writtenAt: shareTarget?.createdAt ?? null,
      }),
    [prefs, shareTarget, book, authorName, avatarKey],
  )

  useLayoutEffect(() => {
    if (!shareTarget) return
    setCustomizing(false)
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        markEscConsumed()
        setShareTarget(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)

    const preview = previewRef.current
    const card = cardRef.current
    const update = () => {
      if (!preview || !card) return
      const nextScale = Math.min(1, preview.clientWidth / SHARE_CARD_WIDTH)
      setMetrics({ scale: nextScale, height: card.offsetHeight * nextScale })
    }
    update()
    const ro = new ResizeObserver(update)
    if (preview) ro.observe(preview)
    if (card) ro.observe(card)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      ro.disconnect()
    }
  }, [shareTarget, book, setShareTarget])

  // The card preview/export renders in the main document: the selected font
  // must be loaded there (export already awaits document.fonts.ready). While
  // The card preview renders in the main document. Mount all public builtin
  // stylesheets while the font list is open so each chip uses its real face.
  useEffect(() => {
    if (!shareTarget) return
    const fonts = fontsData?.data ?? []
    const resolved = resolveFont(prefs.font, fonts, fontPreferences, fontOrder)
    if (resolved.builtin) ensureBuiltinFontLoaded(resolved.builtin.id)
    if (resolved.uploaded) void ensureUploadedFontLoaded(resolved.uploaded)
    if (!customizing) return
    ensureBuiltinFontsLoaded()
    fonts.forEach((f) => void ensureUploadedFontLoaded(f))
  }, [shareTarget, prefs.font, customizing, fontsData, fontPreferences, fontOrder])

  // Warm the export cache in the background while the user reads the preview,
  // so copy/save resolve from cache instead of paying the render cost on
  // click; debounced so rapid template/font/background switching collapses
  // into one render
  useEffect(() => {
    if (!shareTarget) return
    const timer = setTimeout(() => {
      const node = cardRef.current
      if (node) void getCardBlob(node, renderKey).catch(() => {})
    }, 300)
    return () => clearTimeout(timer)
  }, [shareTarget, renderKey])

  if (!shareTarget) return null

  if (bookQuery.isError) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm sm:items-center sm:p-4 animate-modal-backdrop"
        onClick={() => setShareTarget(null)}
      >
        <div
          className="w-full max-w-xl rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-xl sm:rounded-2xl dark:bg-stone-900 animate-modal-panel"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-end px-4 pt-3">
            <button
              type="button"
              onClick={() => setShareTarget(null)}
              title={_('share.close')}
              className="flex h-8 w-8 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-500/10 hover:text-stone-600 dark:hover:text-stone-200"
            >
              <CloseIcon />
            </button>
          </div>
          <QueryErrorState className="px-6 pb-6 pt-2" isRetrying={bookQuery.isFetching} onRetry={bookQuery.refetch} />
        </div>
      </div>
    )
  }

  if (!book) return null

  const fileName = shareFileName(book.title)
  const fontStack = resolveFont(prefs.font, uploadedFonts, fontPreferences, fontOrder).stack

  function patchPrefs(patch: Partial<ShareCardPrefs>) {
    setPrefs((prev) => {
      const next = { ...prev, ...patch }
      saveShareCardPrefs(next)
      return next
    })
  }

  // Selecting applies immediately (font-display: swap); the click only kicks
  // off the builtin download as visual feedback
  function onSelectFont(opt: FontOption) {
    patchPrefs({ font: opt.id })
    if (opt.source === 'builtin') ensureBuiltinFontLoaded(opt.id)
  }

  async function saveImage() {
    const node = cardRef.current
    if (!node) return
    setExporting(true)
    try {
      const blob = await getCardBlob(node, renderKey)
      downloadCardBlob(blob, fileName)
    } catch {
      notify.error({ key: 'share.exportFailed' })
    } finally {
      setExporting(false)
    }
  }

  async function copyImage() {
    const node = cardRef.current
    if (!node) return
    setExporting(true)
    try {
      const blob = await getCardBlob(node, renderKey)
      if (await copyCardBlob(blob)) {
        notify.success({ key: 'share.copied' })
        return
      }
      notify.error({ key: 'share.copyFailed' })
    } catch {
      notify.error({ key: 'share.exportFailed' })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm sm:items-center sm:p-4 animate-modal-backdrop"
      onClick={() => setShareTarget(null)}
    >
      <div
        className="flex max-h-[calc(100dvh-1rem)] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-xl sm:max-h-full sm:rounded-2xl dark:bg-stone-900 animate-modal-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-end px-4 pt-3">
          <button
            onClick={() => setShareTarget(null)}
            title={_('share.close')}
            className="flex h-8 w-8 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-500/10 hover:text-stone-600 dark:hover:text-stone-200"
          >
            <CloseIcon />
          </button>
        </div>
        <div ref={previewRef} className="flex min-h-0 flex-1 justify-center overflow-y-auto custom-scrollbar [scrollbar-gutter:stable] px-4 pb-2 sm:px-6">
          <div style={{ width: SHARE_CARD_WIDTH * scale, height }} className="shrink-0">
            <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: SHARE_CARD_WIDTH }}>
              <ShareCard
                ref={cardRef}
                text={shareTarget.text}
                title={book.title}
                author={book.author}
                chapter={shareTarget.chapter}
                template={prefs.template}
                fontStack={fontStack}
                background={prefs.background}
                brand={prefs.brand}
                note={shareTarget.note}
                authorName={authorName}
                avatarUrl={avatarUrl(avatarKey)}
                writtenAt={shareTarget.createdAt ? _('share.writtenAt', { date: formatShareDate(shareTarget.createdAt) }) : undefined}
                writtenAtCn={shareTarget.createdAt ? _('share.writtenAtCn', { date: formatChineseDate(shareTarget.createdAt) }) : undefined}
              />
            </div>
          </div>
        </div>
        {customizing ? (
          <div className="shrink-0 border-t border-stone-200/60 px-4 py-4 sm:px-6 dark:border-stone-800/60">
            <div className="mb-3 flex items-center">
              <button
                onClick={() => setCustomizing(false)}
                title={_('share.back')}
                className="flex h-7 w-7 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-500/10 hover:text-stone-600 dark:hover:text-stone-200"
              >
                <ChevronLeftIcon />
              </button>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-2 overflow-x-auto">
                <span className="w-8 shrink-0 text-xs text-stone-500 dark:text-stone-400">{_('share.templateLabel')}</span>
                {SHARE_CARD_TEMPLATES.map((t) => (
                  <button
                    key={t}
                    onClick={() => patchPrefs({ template: t })}
                    className={`${chip} shrink-0 ${prefs.template === t ? chipActive : ''}`}
                  >
                    {_(`share.template.${t}`)}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 overflow-x-auto">
                <span className="w-8 shrink-0 text-xs text-stone-500 dark:text-stone-400">{_('share.font')}</span>
                {enabledFontOptions.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => onSelectFont(opt)}
                    style={{ fontFamily: opt.stack }}
                    className={`${chip} flex shrink-0 items-center gap-1 ${prefs.font === opt.id ? chipActive : ''}`}
                  >
                    {opt.name}
                    {opt.status === 'idle' && <DownloadIcon size={12} />}
                    {opt.status === 'loading' && <SpinnerIcon size={12} />}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 overflow-x-auto">
                <span className="w-8 shrink-0 text-xs text-stone-500 dark:text-stone-400">{_('share.background')}</span>
                {BACKGROUND_OPTIONS.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => patchPrefs({ background: b.id })}
                    title={_(`share.bg.${b.id}`)}
                    style={{ background: b.colors.bg }}
                    className={`h-8 w-8 shrink-0 rounded-full transition-colors ${
                      prefs.background === b.id
                        ? 'border-2 border-stone-900 dark:border-stone-100'
                        : 'border border-stone-300 hover:border-stone-500 dark:border-stone-600 dark:hover:border-stone-400'
                    }`}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2 overflow-x-auto">
                <span className="w-8 shrink-0 text-xs text-stone-500 dark:text-stone-400">{_('share.brandLabel')}</span>
                <button
                  onClick={() => patchPrefs({ brand: nextBrand(prefs.brand) })}
                  className={`${chip} shrink-0`}
                >
                  {_(`share.brand.${prefs.brand}`)}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex shrink-0 items-center justify-center gap-6 border-t border-stone-200/60 px-4 py-4 sm:gap-10 sm:px-6 dark:border-stone-800/60">
            <button onClick={() => setCustomizing(true)} className={actionBtn}>
              <span className={actionIcon}><TemplateIcon /></span>
              {_('share.changeTemplate')}
            </button>
            <button onClick={() => void saveImage()} disabled={exporting} className={actionBtn}>
              <span className={actionIcon}><DownloadIcon /></span>
              {_('share.saveImage')}
            </button>
            <button onClick={() => void copyImage()} disabled={exporting} className={actionBtn}>
              <span className={actionIcon}><ShareIcon /></span>
              {_('share.copyImage')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
