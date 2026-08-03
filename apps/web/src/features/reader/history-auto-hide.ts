export const HISTORY_HIDE_AFTER_SCREENS = 5
export const HISTORY_HIDE_AFTER_MS = 5 * 60_000

// A confirmed jump keeps producing relocate events while the view settles
// (section render clamps scrollTop, then the anchor scroll lands). Each one
// can carry a multi-screen displacement that is the jump's own movement, not
// reading — so relocates briefly after a jump only refresh the chapter
// baseline and never accumulate.
export const HISTORY_LANDING_GRACE_MS = 800

// Foliate fires relocate for sub-pixel scroll adjustments; ignore those
const SCREEN_MOVE_MIN = 0.05

export interface HistoryAutoHide {
  /** A jump just happened (confirmed jump, back, or forward): (re)arm the window */
  reset(): void
  /** Feed the screens moved and chapter index from each relocate event */
  trackRelocate(movedScreens: number | undefined, chapterIndex?: number | null): void
  dispose(): void
}

// The jump history only matters while the user is deciding whether a jump was
// right (the "change-of-mind window"). The window closes after enough settled
// reading — enough screens turned AND a chapter boundary crossed since the
// landing — or after enough time, whichever comes first. Disarmed after
// firing, so an already-hidden stack never re-triggers the callback.
export function createHistoryAutoHide(onHide: () => void): HistoryAutoHide {
  let armed = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let accumulated = 0
  // Chapter of the jump landing; the baseline for the "read into another
  // chapter" condition. Unknown chapters never satisfy it — an AND condition
  // must not silently degrade into screens-only.
  let landingChapter: number | null = null
  let graceUntil = 0

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  const fire = () => {
    clearTimer()
    armed = false
    accumulated = 0
    onHide()
  }

  return {
    reset() {
      clearTimer()
      armed = true
      accumulated = 0
      landingChapter = null
      graceUntil = Date.now() + HISTORY_LANDING_GRACE_MS
      timer = setTimeout(fire, HISTORY_HIDE_AFTER_MS)
    },
    trackRelocate(movedScreens, chapterIndex) {
      if (movedScreens === undefined) return
      if (Date.now() < graceUntil) {
        if (chapterIndex != null) landingChapter = chapterIndex
        return
      }
      if (!armed || movedScreens < SCREEN_MOVE_MIN) return
      accumulated += movedScreens
      const chapterChanged =
        landingChapter !== null && chapterIndex != null && chapterIndex !== landingChapter
      if (accumulated >= HISTORY_HIDE_AFTER_SCREENS && chapterChanged) fire()
    },
    dispose() {
      clearTimer()
      armed = false
      accumulated = 0
      landingChapter = null
      graceUntil = 0
    },
  }
}
