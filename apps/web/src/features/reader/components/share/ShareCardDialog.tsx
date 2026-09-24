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
import { CloseIcon, CopyIcon, DownloadIcon, SpinnerIcon } from '../annotation-icons'
import ShareCard, { SHARE_CARD_WIDTH } from './ShareCard'
import { BACKGROUND_OPTIONS, BRAND_OPTIONS, SHARE_CARD_TEMPLATES, loadShareCardPrefs, saveShareCardPrefs, type ShareCardPrefs } from './card-prefs'
import { copyCardBlob, downloadCardBlob, getCardBlob } from './export-image'
import { formatChineseDate, formatShareDate, shareFileName } from './share-text'

interface ShareCardDialogProps {
  bookId: string
}

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
  const [copying, setCopying] = useState(false)
  const [saving, setSaving] = useState(false)
  const exporting = copying || saving
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
  // must be loaded there (export already awaits document.fonts.ready).
  // Mount public builtin stylesheets so each font option chip uses its real face.
  useEffect(() => {
    if (!shareTarget) return
    const fonts = fontsData?.data ?? []
    const resolved = resolveFont(prefs.font, fonts, fontPreferences, fontOrder)
    if (resolved.builtin) ensureBuiltinFontLoaded(resolved.builtin.id)
    if (resolved.uploaded) void ensureUploadedFontLoaded(resolved.uploaded)
    ensureBuiltinFontsLoaded()
    fonts.forEach((f) => void ensureUploadedFontLoaded(f))
  }, [shareTarget, prefs.font, fontsData, fontPreferences, fontOrder])

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
    setSaving(true)
    try {
      const blob = await getCardBlob(node, renderKey)
      downloadCardBlob(blob, fileName)
    } catch {
      notify.error({ key: 'share.exportFailed' })
    } finally {
      setSaving(false)
    }
  }

  async function copyImage() {
    const node = cardRef.current
    if (!node) return
    setCopying(true)
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
      setCopying(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm sm:items-center sm:p-4 animate-modal-backdrop"
      onClick={() => setShareTarget(null)}
    >
      <div
        className="flex max-h-[calc(100dvh-1rem)] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl sm:max-h-[92vh] sm:rounded-2xl dark:bg-stone-900 animate-modal-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-3.5 pb-2">
          <span className="text-sm font-semibold tracking-wide text-stone-700 dark:text-stone-300">
            {_('annotation.shareExcerpt')}
          </span>
          <button
            type="button"
            onClick={() => setShareTarget(null)}
            title={_('share.close')}
            className="flex h-7 w-7 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-500/10 hover:text-stone-600 dark:hover:text-stone-200"
          >
            <CloseIcon size={16} />
          </button>
        </div>
        <div ref={previewRef} className="flex min-h-0 flex-1 justify-center overflow-y-auto custom-scrollbar [scrollbar-gutter:stable] px-4 py-3 sm:px-6">
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
        <div className="shrink-0 border-t border-stone-200/70 bg-stone-50/50 px-4 pt-3.5 pb-4 sm:px-6 dark:border-stone-800/80 dark:bg-stone-900/50">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-8 shrink-0 text-xs font-medium text-stone-400 dark:text-stone-500">
                {_('share.templateLabel')}
              </span>
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1 px-0.5">
                {SHARE_CARD_TEMPLATES.map((t) => {
                  const active = prefs.template === t
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => patchPrefs({ template: t })}
                      className={`shrink-0 rounded-full px-3 py-1 text-xs transition-all ${
                        active
                          ? 'bg-stone-900 font-medium text-white shadow-xs dark:bg-stone-100 dark:text-stone-900'
                          : 'bg-stone-200/70 text-stone-600 hover:bg-stone-200 hover:text-stone-900 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700 dark:hover:text-stone-100'
                      }`}
                    >
                      {_(`share.template.${t}`)}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-8 shrink-0 text-xs font-medium text-stone-400 dark:text-stone-500">
                {_('share.font')}
              </span>
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1 px-0.5">
                {enabledFontOptions.map((opt) => {
                  const active = prefs.font === opt.id
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => onSelectFont(opt)}
                      style={{ fontFamily: opt.stack }}
                      className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs transition-all ${
                        active
                          ? 'bg-stone-900 font-medium text-white shadow-xs dark:bg-stone-100 dark:text-stone-900'
                          : 'border border-stone-300/80 bg-white text-stone-700 hover:border-stone-400 hover:text-stone-900 dark:border-stone-700/80 dark:bg-stone-800/80 dark:text-stone-300 dark:hover:border-stone-500 dark:hover:text-stone-100'
                      }`}
                    >
                      <span>{opt.name}</span>
                      {opt.status === 'idle' && (
                        <span className={active ? 'text-stone-300 dark:text-stone-600' : 'text-stone-400 dark:text-stone-500'}>
                          <DownloadIcon size={12} />
                        </span>
                      )}
                      {opt.status === 'loading' && <SpinnerIcon size={12} />}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-8 shrink-0 text-xs font-medium text-stone-400 dark:text-stone-500">
                {_('share.background')}
              </span>
              <div className="flex items-center gap-2.5 overflow-x-auto no-scrollbar py-2.5 px-1.5">
                {BACKGROUND_OPTIONS.map((b) => {
                  const active = prefs.background === b.id
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => patchPrefs({ background: b.id })}
                      title={_(`share.bg.${b.id}`)}
                      style={{ background: b.colors.bg }}
                      className={`h-6 w-6 shrink-0 rounded-full transition-all ${
                        active
                          ? 'ring-2 ring-stone-900 ring-offset-2 shadow-xs dark:ring-stone-100 dark:ring-offset-stone-900'
                          : 'border border-stone-300/80 hover:scale-110 dark:border-stone-600'
                      }`}
                    />
                  )
                })}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-8 shrink-0 text-xs font-medium text-stone-400 dark:text-stone-500">
                {_('share.brandLabel')}
              </span>
              <div className="inline-flex rounded-lg bg-stone-200/60 p-0.5 dark:bg-stone-800">
                {BRAND_OPTIONS.map((b) => {
                  const active = prefs.brand === b
                  return (
                    <button
                      key={b}
                      type="button"
                      translate="no"
                      onClick={() => patchPrefs({ brand: b })}
                      className={`notranslate rounded-md px-2.5 py-1 text-xs transition-all ${
                        active
                          ? 'bg-white font-medium text-stone-900 shadow-xs dark:bg-stone-700 dark:text-stone-100'
                          : 'text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200'
                      }`}
                    >
                      {_(`share.brand.${b}`)}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => void copyImage()}
              disabled={exporting}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-stone-300/80 bg-white py-2.5 px-4 text-xs sm:text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50 hover:text-stone-900 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-800/80 dark:text-stone-200 dark:hover:bg-stone-700 dark:hover:text-stone-100"
            >
              {copying ? <SpinnerIcon size={16} /> : <CopyIcon size={16} />}
              <span>{_('share.copyImage')}</span>
            </button>
            <button
              type="button"
              onClick={() => void saveImage()}
              disabled={exporting}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-stone-900 py-2.5 px-4 text-xs sm:text-sm font-medium text-white shadow-xs transition-colors hover:bg-stone-800 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
            >
              {saving ? <SpinnerIcon size={16} /> : <DownloadIcon size={16} />}
              <span>{_('share.saveImage')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
