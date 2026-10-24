/** Wait briefly for font styles; core reader CSS is independent. */
const FONT_WAIT_MS = 200

export async function waitForReaderFonts(doc: Document, signal: AbortSignal, viewport?: { top: number; bottom: number }): Promise<boolean> {
  if (!doc.fonts?.load || signal.aborted) return true
  let timer: ReturnType<typeof setTimeout> | undefined
  let stop: () => void = () => {}
  const deadline = new Promise<boolean>((resolve) => {
    stop = () => resolve(false)
    timer = setTimeout(stop, FONT_WAIT_MS)
    signal.addEventListener('abort', stop, { once: true })
  })
  const load = async () => {
    const started = performance.now()
    // A frame lets newly injected font rules participate in computed styles.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    if (signal.aborted) return false
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
    console.debug(`[bd] reader fonts: glyphs ${(performance.now() - started).toFixed(0)}ms`)
    return true
  }
  try {
    return await Promise.race([load().catch(() => false), deadline])
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', stop)
  }
}
