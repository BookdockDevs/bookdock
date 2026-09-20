// Write-back gate for the saved reading position. When progress shows a
// saved position exists, relocate-driven auto-saves must stay blocked until
// the initial restore settles: before that the view may emit relocations at
// the book start (progress fetch failed, stale CFI that cannot resolve, slow
// initial navigation), and writing those back would permanently overwrite
// the saved position. The gate opens when the mount finishes its initial
// navigation (rendered), the user navigates explicitly, or the user chooses
// to start over.
export interface RestoreGate {
  isPending(): boolean
  arm(): void
  open(): void
}

export function createRestoreGate(): RestoreGate {
  let pending = false
  return {
    isPending: () => pending,
    arm: () => {
      pending = true
    },
    open: () => {
      pending = false
    },
  }
}
