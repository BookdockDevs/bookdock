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
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-stone-300">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p className="text-lg font-medium text-stone-700 dark:text-stone-300">
            {i18n.t('errors.unexpectedTitle')}
          </p>
          <p className="max-w-sm text-sm text-stone-500">
            {i18n.t('errors.unexpectedDescription')}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => window.location.reload()}>
              {i18n.t('errors.refresh')}
            </Button>
            <Link to="/">
              <Button variant="secondary">{i18n.t('errors.backToLibrary')}</Button>
            </Link>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
