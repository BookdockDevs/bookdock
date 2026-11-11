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
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z" />
              <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
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
