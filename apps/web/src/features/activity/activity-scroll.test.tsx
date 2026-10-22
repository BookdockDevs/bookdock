import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { activityScrollKey, saveActivityScroll, takeActivityScroll, useActivityScrollPreservation } from './activity-scroll'

function ScrollHarness({ cacheKey }: { cacheKey: string | null }) {
  useActivityScrollPreservation(cacheKey)
  return <div>Feed</div>
}

describe('activity feed scroll preservation', () => {
  it('restores the same viewer, source, filter, and history entry after the feed mounts', () => {
    sessionStorage.clear()
    let scrollY = 0
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY })
    vi.spyOn(window, 'scrollTo').mockImplementation((options) => { scrollY = typeof options === 'number' ? options : options.top ?? 0 })
    const key = activityScrollKey('viewer-1', 'personal', 'author-1', 'idea', 8)!
    saveActivityScroll(key, 640)

    const view = render(<ScrollHarness cacheKey={key} />)

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 640, behavior: 'instant' })
    view.unmount()
    vi.restoreAllMocks()
  })

  it('does not apply a saved position to a different account or history entry', () => {
    sessionStorage.clear()
    let scrollY = 0
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY })
    vi.spyOn(window, 'scrollTo').mockImplementation((options) => { scrollY = typeof options === 'number' ? options : options.top ?? 0 })
    const sourceKey = activityScrollKey('viewer-1', 'library', 'library-1', 'all', 12)!
    const otherKey = activityScrollKey('viewer-2', 'library', 'library-1', 'all', 13)!
    saveActivityScroll(sourceKey, 720)

    const view = render(<ScrollHarness cacheKey={otherKey} />)

    expect(window.scrollTo).not.toHaveBeenCalled()
    view.unmount()
    expect(takeActivityScroll(sourceKey)).toBe(720)
    vi.restoreAllMocks()
  })
})
