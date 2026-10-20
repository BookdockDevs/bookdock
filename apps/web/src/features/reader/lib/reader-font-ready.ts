/** Wait for font styles and visible glyphs; core reader CSS is independent. */
export async function waitForReaderFonts(doc: Document, signal: AbortSignal, viewport?: { top: number; bottom: number }): Promise<boolean> {
  if (!doc.fonts?.load || signal.aborted) return true
  let timer: ReturnType<typeof setTimeout> | undefined
  let stop: () => void = () => {}
  const cleanups: (() => void)[] = []
  let cancelled = false
  const deadline = new Promise<boolean>((resolve) => {
    stop = () => resolve(false)
    timer = setTimeout(stop, 8000)
    signal.addEventListener('abort', stop, { once: true })
  })
  const load = async () => {
    const started = performance.now()
    // A frame lets newly injected @import rules participate in style/font readiness.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const imports = Array.from(doc.querySelectorAll<HTMLStyleElement>('style[data-bd-reader-fonts]'))
      .filter((style) => style.textContent?.includes('@import'))
    await Promise.all(imports.map((style) => {
      // The style load event covers nested and cross-origin imports. CSSOM
      // access alone cannot prove those resources have finished loading.
      if (style.dataset.loadState === 'loaded') return
      if (style.dataset.loadState === 'error') throw new Error('Reader font stylesheet failed')
      return new Promise<void>((resolve) => {
        const finish = () => {
          style.removeEventListener('load', finish)
          style.removeEventListener('error', fail)
          resolve()
        }
        const fail = () => {
          cancelled = true
          finish()
        }
        style.addEventListener('load', finish, { once: true })
        style.addEventListener('error', fail, { once: true })
        cleanups.push(() => {
          style.removeEventListener('load', finish)
          style.removeEventListener('error', fail)
          resolve()
        })
      })
    }))
    if (signal.aborted || cancelled) return false
    const stylesReady = performance.now()
    const frameTop = doc.defaultView?.frameElement?.getBoundingClientRect().top ?? 0
    const paragraphs = Array.from(doc.querySelectorAll('h1, h2, p, pre, li'))
    const visible = viewport ? paragraphs.filter((element) => {
      const rect = element.getBoundingClientRect()
      return frameTop + rect.bottom > viewport.top && frameTop + rect.top < viewport.bottom
    }) : paragraphs
    const targets = (visible.length ? visible : [doc.body]).slice(0, 8)
    await Promise.all(targets.map((element) => {
      const style = doc.defaultView!.getComputedStyle(element)
      const text = (element.textContent ?? '').slice(0, 1024)
      return doc.fonts.load(`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`, text)
    }))
    console.debug(`[bd] reader fonts: styles ${(stylesReady - started).toFixed(0)}ms, glyphs ${(performance.now() - stylesReady).toFixed(0)}ms`)
    return true
  }
  try {
    return await Promise.race([load().catch(() => false), deadline])
  } finally {
    cancelled = true
    clearTimeout(timer)
    signal.removeEventListener('abort', stop)
    cleanups.forEach((cleanup) => cleanup())
  }
}
