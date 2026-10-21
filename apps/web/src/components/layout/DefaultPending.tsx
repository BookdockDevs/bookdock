export default function DefaultPending() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 sm:p-6" role="status" aria-busy="true">
      <div className="h-8 w-32 animate-pulse rounded-lg bg-stone-200/70 dark:bg-stone-800/70" />
      <div className="h-64 animate-pulse rounded-2xl bg-stone-200/50 dark:bg-stone-800/50" />
    </div>
  )
}
