export interface JumpHistory {
  /** Record the position being left before a user-initiated jump */
  push(cfi: string): void
  /** Move back one entry; the current position goes onto the forward stack */
  back(currentCfi: string): string | null
  /** Move forward one entry; the current position goes onto the back stack */
  forward(currentCfi: string): string | null
  canBack(): boolean
  canForward(): boolean
  clear(): void
}

const DEFAULT_LIMIT = 50

// Browser-style session history: a new jump clears the forward stack, and
// back/forward shuttle the current position between the two stacks. In-memory
// only — the reader drops it when the book changes or the page unmounts.
export function createJumpHistory(limit = DEFAULT_LIMIT): JumpHistory {
  let backStack: string[] = []
  let forwardStack: string[] = []

  return {
    push(cfi) {
      if (!cfi) return
      backStack.push(cfi)
      if (backStack.length > limit) backStack.shift()
      forwardStack = []
    },
    back(currentCfi) {
      const target = backStack.pop()
      if (target === undefined) return null
      if (currentCfi) forwardStack.push(currentCfi)
      return target
    },
    forward(currentCfi) {
      const target = forwardStack.pop()
      if (target === undefined) return null
      if (currentCfi) {
        backStack.push(currentCfi)
        if (backStack.length > limit) backStack.shift()
      }
      return target
    },
    canBack() {
      return backStack.length > 0
    },
    canForward() {
      return forwardStack.length > 0
    },
    clear() {
      backStack = []
      forwardStack = []
    },
  }
}
