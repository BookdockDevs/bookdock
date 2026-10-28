import { describe, expect, it, vi } from 'vitest'

import { createProgressSync, restoreProgress, type PositionPayload } from '../eink/progress-sync'

const position = (cfi: string): PositionPayload => ({ cfi, contentCfi: cfi, revisionId: 'rev', percent: 10, fraction: 0.1 })

describe('Kindle progress', () => {
  it('restores a valid content CFI and falls back to the saved chapter or book fraction', async () => {
    const view = { resolveNavigation: vi.fn(() => ({ index: 1 })), init: vi.fn(async () => {}), renderer: { goTo: vi.fn(async () => {}) } }
    await restoreProgress(view, { cfi: 'chapter:1:0.25', contentCfi: 'epubcfi(/6/4)', fraction: 0.5 }, 3)
    expect(view.init).toHaveBeenLastCalledWith({ lastLocation: 'epubcfi(/6/4)' })
    view.resolveNavigation.mockReturnValue({ index: -1 })
    await restoreProgress(view, { cfi: 'chapter:1:0.25', contentCfi: 'epubcfi(/6/4)', fraction: 0.5 }, 3)
    expect(view.renderer.goTo).toHaveBeenLastCalledWith({ index: 1, anchor: 0.25 })
    await restoreProgress(view, { cfi: 'epubcfi(/6/4)', percent: 60 }, 3)
    expect(view.init).toHaveBeenLastCalledWith({ lastLocation: { fraction: 0.6 } })
    await restoreProgress(view, { cfi: 'chapter:8:0.25', fraction: 0.4, percent: 40 }, 3)
    expect(view.init).toHaveBeenLastCalledWith({ lastLocation: { fraction: 0.4 } })
    await restoreProgress(view, { locationAvailable: false, cfi: 'epubcfi(/6/4)', fraction: 0.6 }, 3)
    expect(view.init).toHaveBeenLastCalledWith({})
  })

  it('falls back to the book fraction when CFI navigation fails', async () => {
    const view = { resolveNavigation: vi.fn(() => ({ index: 1 })), init: vi.fn().mockRejectedValueOnce(new Error('bad CFI')).mockResolvedValue(undefined), renderer: { goTo: vi.fn(async () => {}) } }
    await restoreProgress(view, { cfi: 'epubcfi(/6/4)', fraction: 0.45, percent: 45 }, 3)
    expect(view.init).toHaveBeenLastCalledWith({ lastLocation: { fraction: 0.45 } })
  })

  it('serializes the latest position behind an in-flight save', async () => {
    let finish!: () => void
    const first = new Promise<void>(resolve => { finish = resolve })
    const write = vi.fn().mockReturnValueOnce(first).mockResolvedValue(undefined)
    const sync = createProgressSync(write)
    sync.stage(position('one'))
    const flushing = sync.flush()
    sync.stage(position('two'))
    finish()
    await flushing
    expect(write.mock.calls.map(call => call[0].cfi)).toEqual(['one', 'two'])
  })

  it('keeps a failed save for a later flush', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const write = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
      const sync = createProgressSync(write)
      sync.stage(position('one'))
      await sync.flush()
      await sync.flush()
      expect(write).toHaveBeenCalledTimes(2)
      expect(write).toHaveBeenLastCalledWith(position('one'))
    } finally { warning.mockRestore() }
  })
})
