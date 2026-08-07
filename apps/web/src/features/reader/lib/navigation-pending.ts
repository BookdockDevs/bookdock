// Chapter-switch loading indicator (Readest-style): a navigation is only
// surfaced after it outlives the anti-flicker window, and only the newest
// in-flight navigation may show it — a rapid second jump supersedes the first
// instead of both indicators fighting.
export const NAVIGATION_ANTI_FLICKER_MS = 200

export class NavigationPending {
  private gen = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private shown = false
  private onChange: (pending: boolean) => void

  constructor(onChange: (pending: boolean) => void) {
    this.onChange = onChange
  }

  // Records a new navigation as the latest in flight and returns its
  // generation token, which the caller must pass to end() when it settles.
  begin(): number {
    const gen = ++this.gen
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      if (gen !== this.gen) return
      this.shown = true
      this.onChange(true)
    }, NAVIGATION_ANTI_FLICKER_MS)
    return gen
  }

  // Settles the given navigation. Stale generations (a newer navigation
  // started meanwhile) are ignored so the indicator follows the latest one.
  end(gen: number) {
    if (gen !== this.gen) return
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.shown) {
      this.shown = false
      this.onChange(false)
    }
  }

  // Cancels the anti-flicker timer and invalidates any in-flight navigation
  // (e.g. on destroy — the consumer is unmounted anyway).
  dispose() {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.gen++
  }
}
