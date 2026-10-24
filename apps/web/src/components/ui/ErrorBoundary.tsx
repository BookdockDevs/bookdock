import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'

import i18n from '@/i18n/i18n'

import { Button } from './Button'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-stone-100 text-stone-400 dark:bg-stone-800/80 dark:text-stone-500" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div className="space-y-1">
            <p className="text-base font-semibold text-stone-800 dark:text-stone-200">
              {i18n.t('errors.unexpectedTitle')}
            </p>
            <p className="max-w-sm text-xs leading-relaxed text-stone-500 dark:text-stone-400">
              {i18n.t('errors.unexpectedDescription')}
            </p>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
              {i18n.t('errors.refresh')}
            </Button>
            <Link to="/">
              <Button variant="primary" size="sm">{i18n.t('errors.backToLibrary')}</Button>
            </Link>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
