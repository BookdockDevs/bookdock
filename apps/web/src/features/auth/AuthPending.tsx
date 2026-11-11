export default function AuthPending() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="relative flex min-h-screen items-center justify-center overflow-hidden bg-stone-50 px-4 py-8 dark:bg-stone-950"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(120,113,108,0.1),transparent_60%)] dark:bg-[radial-gradient(ellipse_at_top,rgba(231,229,228,0.05),transparent_60%)]"
      />
      <div className="relative w-full max-w-[400px] animate-pulse rounded-2xl border border-stone-200/90 bg-white/95 p-6 shadow-sm ring-1 ring-stone-950/[0.03] backdrop-blur-xs sm:p-8 dark:border-stone-800 dark:bg-stone-900/95 dark:ring-white/[0.04]">
        <div className="mb-6 flex flex-col items-center">
          <div className="mb-3.5 h-11 w-11 rounded-xl bg-stone-200/80 dark:bg-stone-800" />
          <div className="h-5 w-16 rounded-md bg-stone-200/80 dark:bg-stone-800" />
          <div className="mt-2 h-3.5 w-36 rounded bg-stone-200/50 dark:bg-stone-800/60" />
        </div>
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i}>
              <div className="mb-1.5 h-3.5 w-14 rounded bg-stone-200/60 dark:bg-stone-800/70" />
              <div className="h-10 w-full rounded-xl bg-stone-100 dark:bg-stone-800/60" />
            </div>
          ))}
          <div className="pt-2">
            <div className="h-10 w-full rounded-xl bg-stone-200/80 dark:bg-stone-800" />
          </div>
        </div>
      </div>
    </div>
  )
}
