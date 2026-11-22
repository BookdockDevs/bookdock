import type { ReactNode } from 'react'

export const authInputClassName =
  'w-full rounded-xl border border-stone-200 bg-stone-50/80 px-3.5 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 outline-none transition-colors focus:border-stone-400 focus:bg-white focus:ring-2 focus:ring-stone-900/10 aria-invalid:border-red-400 aria-invalid:focus:ring-red-500/15 dark:border-stone-800 dark:bg-stone-950/60 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-stone-600 dark:focus:bg-stone-900 dark:focus:ring-stone-100/10 dark:aria-invalid:border-red-500'

export const authLabelClassName = 'mb-1.5 block text-sm font-medium text-stone-700 dark:text-stone-300'

export const authFieldErrorClassName = 'mt-1.5 text-xs text-red-600 dark:text-red-400'

export const authAlertClassName = 'mb-4 text-sm text-red-600 dark:text-red-400'

interface AuthCardShellProps {
  title: string
  subtitle: string
  badge?: string
  footer?: ReactNode
  children: ReactNode
}

export default function AuthCardShell({ title, subtitle, badge, footer, children }: AuthCardShellProps) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-stone-50 px-4 py-8 dark:bg-stone-950">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(120,113,108,0.1),transparent_60%)] dark:bg-[radial-gradient(ellipse_at_top,rgba(231,229,228,0.05),transparent_60%)]"
      />
      <div className="relative max-h-[calc(100dvh-2rem)] w-full max-w-[400px] overflow-y-auto rounded-2xl border border-stone-200/90 bg-white/95 p-6 shadow-sm ring-1 ring-stone-950/[0.03] backdrop-blur-xs sm:max-h-none sm:overflow-visible sm:p-8 dark:border-stone-800 dark:bg-stone-900/95 dark:ring-white/[0.04]">
        <header className="mb-6 text-center">
          <div className="mx-auto mb-3.5 flex h-11 w-11 items-center justify-center rounded-xl bg-stone-900 text-stone-50 shadow-xs dark:bg-stone-800 dark:text-stone-100 dark:ring-1 dark:ring-stone-700/80">
            <svg viewBox="0 0 32 32" fill="none" className="h-6 w-6" aria-hidden="true">
              <path d="M13.7 3.4C13.5 2.5 14.5 2.0 15.3 2.6C21.8 7.1 25.4 12.6 25.0 19.3C25.0 20.1 24.3 20.7 23.5 20.6C19.5 19.6 15.5 19.8 11.6 20.7C10.8 20.8 10.3 20.1 10.6 19.3C12.6 14.4 13.7 8.9 13.7 3.4Z" fill="currentColor" />
              <path d="M2.0 23.6C7.3 22.1 11.9 21.6 16.0 21.6C20.1 21.6 24.7 22.1 30.0 23.6C30.7 23.8 31.0 24.5 30.5 25.0C27.7 26.9 22.0 27.3 16.9 28.3C16.3 28.4 15.7 28.4 15.1 28.3C10.0 27.3 4.3 26.9 1.5 25.0C1.0 24.5 1.3 23.8 2.0 23.6Z" fill="currentColor" opacity="0.74" />
            </svg>
          </div>
          {badge && (
            <span className="mb-2 inline-flex items-center rounded-full bg-stone-100 px-2.5 py-0.5 text-[11px] font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-300">
              {badge}
            </span>
          )}
          <h1 className="font-serif text-xl font-semibold tracking-wide text-stone-900 dark:text-stone-50">
            {title}
          </h1>
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
            {subtitle}
          </p>
        </header>

        {children}

        {footer && (
          <footer className="mt-6 border-t border-stone-100 pt-5 text-center dark:border-stone-800/80">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}
