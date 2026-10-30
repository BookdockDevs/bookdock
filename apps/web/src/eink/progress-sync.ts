import { getProgressRestoreTarget, type ProgressRestoreState } from '../features/reader/lib/progress-restoration'

export interface PositionPayload {
  revisionId: string
  cfi: string
  contentCfi: string
  chapter?: string
  chapterIndex?: number
  percent: number
  fraction: number
}

export async function restoreProgress(view: {
  resolveNavigation: (target: string) => { index?: number } | undefined
  init: (options: { lastLocation?: string | { fraction: number } }) => Promise<void>
  renderer: { goTo: (target: { index: number; anchor?: number }) => Promise<void> }
}, progress: ProgressRestoreState | null | undefined, sectionCount: number): Promise<void> {
  const target = getProgressRestoreTarget(progress)
  if (target.cfi || target.contentCfi || target.fraction !== undefined) {
    const cfi = target.contentCfi
    if (cfi) {
      try {
        const index = view.resolveNavigation(cfi)?.index
        if (Number.isInteger(index) && index! >= 0 && index! < sectionCount) {
          await view.init({ lastLocation: cfi })
          return
        }
      } catch { /* Fall back to the saved chapter or fraction. */ }
    }
    const chapter = /^chapter:(\d+)(?::(\d+(?:\.\d+)?))?$/.exec(target.cfi)
    if (chapter) {
      const index = Number(chapter[1])
      const anchor = chapter[2] === undefined ? undefined : Number(chapter[2])
      if (index < sectionCount && (anchor === undefined || anchor <= 1)) {
        try {
          await view.renderer.goTo({ index, ...(anchor === undefined ? {} : { anchor }) })
          return
        } catch { /* Fall back to the saved fraction. */ }
      }
    }
    const fraction = target.fraction
    if (typeof fraction === 'number' && Number.isFinite(fraction) && fraction > 0 && fraction <= 1) {
      await view.init({ lastLocation: { fraction } })
      return
    }
  }
  await view.init({})
}

export function createProgressSync(write: (position: PositionPayload) => Promise<void>) {
  let pending: PositionPayload | null = null
  let running: Promise<void> | null = null

  function stage(position: PositionPayload) { pending = position }
  async function flush(): Promise<void> {
    if (running) return running
    if (!pending) return
    running = (async () => {
      while (pending) {
        const position = pending
        pending = null
        try { await write(position) }
        catch (error) {
          pending ??= position
          console.warn('Failed to save reading progress', error)
          break
        }
      }
    })()
    try { await running } finally { running = null }
  }
  return { stage, flush }
}
