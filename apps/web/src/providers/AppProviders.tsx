import type { ClientBookRef } from '@bookdock/shared'
import { retryReadingRecords } from '@/features/reader/lib/reading-record-queue'
import DownloadDialogHost from '@/features/library/components/DownloadDialogHost'
import { isDeviceBook } from '@/features/reading-data/book-source'
import { useEffect, type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { selectEffectiveReadingThemeId, useUiStore } from '../stores/ui.store'
import { resolveReadingTheme } from '../lib/reading-theme'
import { queryClient } from '../lib/query-client'
import '@/i18n/i18n'
import { Toast } from '../components/ui/Toast'
import { DEFAULT_UNDO_QUERY_KEYS, hasUndoOpportunity, runUndo } from '../lib/undo'
import { useAuthStore } from '../stores/auth.store'
import { isReaderModalOpen, readReaderShortcuts, shortcutMatches } from '@/features/reader/lib/reader-shortcuts'
import { router } from '../router'
import { SettingsSync } from './SettingsSync'

export default function AppProviders({ children }: { children?: ReactNode }) {
  useEffect(() => {
    const changed = () => {
      void queryClient.invalidateQueries({ queryKey: ['client-catalog'] })
      void queryClient.invalidateQueries({ queryKey: ['local-library', 'archive-session'] })
      void queryClient.invalidateQueries({ queryKey: ['reading-records', 'merged'] })
      void queryClient.invalidateQueries({ queryKey: ['archive', 'merged'] })
      void queryClient.invalidateQueries({ queryKey: ['archive', 'device'] })
      void queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'books' && query.queryKey[query.queryKey.length - 1] === 'unified' })
      void queryClient.invalidateQueries({ predicate: (query) => ['book', 'annotations', 'progress', 'reading-records', 'archive'].includes(String(query.queryKey[0])) && query.queryKey.some((part) => typeof part === 'string' && part.startsWith('local:')) })
    }
    const publicationChanged = (event: Event) => {
      const ref = (event as CustomEvent<ClientBookRef>).detail
      if (isDeviceBook(ref)) void queryClient.invalidateQueries({ queryKey: ['local-library', 'session', ref.scope.vaultId, ref.bookId] })
    }
    window.addEventListener('bd-local-publication-changed', publicationChanged)
    window.addEventListener('bd-local-library-changed', changed)
    return () => { window.removeEventListener('bd-local-library-changed', changed); window.removeEventListener('bd-local-publication-changed', publicationChanged) }
  }, [])
  const effectiveTheme = useUiStore((s) => s.systemTheme)
  const setSystemTheme = useUiStore((s) => s.setSystemTheme)

  useEffect(() => {
    // The pending-records queue belongs to the remote account, not to the
    // displayed source; retrying it no-ops without a user and never carries
    // local vault data.
    void retryReadingRecords()
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    setSystemTheme(media.matches ? 'dark' : 'light')
    const handler = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? 'dark' : 'light')
    media.addEventListener('change', handler)
    return () => media.removeEventListener('change', handler)
  }, [setSystemTheme])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', effectiveTheme === 'dark')
    document.documentElement.style.colorScheme = effectiveTheme
    const favicon = document.getElementById('bookdock-favicon') as HTMLLinkElement | null
    if (favicon) favicon.href = effectiveTheme === 'dark' ? '/favicon-dark.svg?v=1' : '/favicon.svg?v=5'
  }, [effectiveTheme])

  // Preload the foliate engine (reader-entry.js + its module graph) at app
  // boot so the reader's first open doesn't pay the download+eval on the
  // critical path — loadFoliateScript finds the global already set and skips
  // the dynamic import entirely. Same runtime-import pattern as FoliateReader.
  useEffect(() => {
    const dynamicImport = new Function('url', 'return import(url)') as (url: string) => Promise<unknown>
    void dynamicImport('/foliate-js/reader-entry.js').catch(() => undefined)
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeStyleInjector />
      <SettingsSync />
      <UndoHotkey />
      <RouterProvider router={router} />
      <Toast />
      <DownloadDialogHost />
      {children}
    </QueryClientProvider>
  )
}

export function UndoHotkey() {
  const userId = useAuthStore((state) => state.user?.id ?? null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const path = event.composedPath()
      const typing = path.some((entry) => entry instanceof HTMLElement && (
        entry.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(entry.tagName)
      ))
      if (typing || event.isComposing || (event as KeyboardEvent & { keyCode?: number }).keyCode === 229
        || event.repeat || isReaderModalOpen() || !hasUndoOpportunity()) return
      const shortcut = readReaderShortcuts(userId).undo
      if (!shortcutMatches(event, shortcut)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      void runUndo()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [userId])

  useEffect(() => {
    const invalidate = (event: Event) => {
      const queryKeys = (event as CustomEvent<{ queryKeys?: readonly (readonly unknown[])[] }>).detail?.queryKeys ?? DEFAULT_UNDO_QUERY_KEYS
      for (const queryKey of queryKeys) void queryClient.invalidateQueries({ queryKey })
    }
    window.addEventListener('bd:undo-complete', invalidate)
    return () => window.removeEventListener('bd:undo-complete', invalidate)
  }, [])

  return null
}

function ThemeStyleInjector() {
  const readingThemeId = useUiStore(selectEffectiveReadingThemeId)
  const customThemes = useUiStore((s) => s.customThemes)
  const fontSize = useUiStore((s) => s.fontSize)
  const lineHeight = useUiStore((s) => s.lineHeight)

  const theme = resolveReadingTheme(readingThemeId, customThemes)

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--bd-read-bg', theme.bg)
    root.style.setProperty('--bd-read-page-bg', theme.pageBg)
    root.style.setProperty('--bd-read-text', theme.text)
    root.style.setProperty('--bd-read-sub', theme.uiText)
    root.style.setProperty('--bd-read-accent', theme.accent)
    root.style.setProperty('--bd-read-primary', theme.primary)
  }, [theme])

  return <style>{`
    :root { --bd-read-bg: ${theme.bg}; --bd-read-page-bg: ${theme.pageBg}; --bd-read-text: ${theme.text}; --bd-read-sub: ${theme.uiText}; --bd-read-accent: ${theme.accent}; --bd-read-primary: ${theme.primary}; --bd-font-size: ${fontSize}px; --bd-line-height: ${lineHeight}; }
  `}</style>
}
