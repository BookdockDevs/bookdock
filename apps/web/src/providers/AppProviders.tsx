import { useEffect, useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { useUiStore, getEffectiveTheme } from '../stores/ui.store'
import { resolveReadingTheme } from '../lib/reading-theme'
import '@/i18n/i18n'
import { Toast } from '../components/ui/Toast'
import { router } from '../router'
import { SettingsSync } from './SettingsSync'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: Infinity, refetchOnWindowFocus: false },
  },
})

export default function AppProviders({ children }: { children?: ReactNode }) {
  const [effectiveTheme, setEffectiveTheme] = useState<'light' | 'dark'>(() => getEffectiveTheme())

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setEffectiveTheme(e.matches ? 'dark' : 'light')
    media.addEventListener('change', handler)
    return () => media.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', effectiveTheme === 'dark')
  }, [effectiveTheme])

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeStyleInjector />
      <SettingsSync />
      <RouterProvider router={router} />
      <Toast />
      {children}
    </QueryClientProvider>
  )
}

function ThemeStyleInjector() {
  const readingThemeId = useUiStore((s) => s.readingThemeId)
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
