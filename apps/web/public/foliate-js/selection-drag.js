// Native selection cannot cross iframe documents. Keep the gesture and its
// anchor in the originating document even when another section is visible.
export class SelectionDrag {
    #options
    #session
    #timer
    #remove = []

    constructor(options) {
        this.#options = options
        const move = e => this.move(e)
        const stop = () => this.stop(true)
        const blur = () => { if (!document.hasFocus()) stop() }
        const hide = () => { if (document.hidden) stop() }
        const preventNativeDrag = e => { if (this.active) e.preventDefault() }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', stop)
        window.addEventListener('pointercancel', stop)
        window.addEventListener('blur', blur)
        window.addEventListener('mousemove', preventNativeDrag)
        document.addEventListener('visibilitychange', hide)
        this.#remove.push(() => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', stop)
            window.removeEventListener('pointercancel', stop)
            window.removeEventListener('blur', blur)
            window.removeEventListener('mousemove', preventNativeDrag)
            document.removeEventListener('visibilitychange', hide)
        })
    }
    attach(doc) {
        const listen = (target, type, handler) => {
            target.addEventListener(type, handler)
            return () => target.removeEventListener(type, handler)
        }
        const removers = [
            listen(doc, 'pointerdown', e => {
                this.stop()
                if (e.pointerType !== 'mouse' || e.button !== 0 || !this.#options.enabled()) return
                this.#session = { doc, direction: 0, continued: false, revision: 0 }
                this.#options.start?.()
            }),
            listen(doc, 'pointermove', e => this.move(e, doc)),
            listen(doc, 'mousemove', e => {
                // Native drag selection otherwise scrolls the clipped column
                // strip independently of the paginator's one-spread turns.
                if (this.active) e.preventDefault()
            }),
            listen(doc, 'selectionchange', () => {
                const state = this.#session
                if (state?.doc === doc && !state.anchor && Number.isFinite(state.x))
                    this.move({ clientX: state.x, clientY: state.y, buttons: 1 })
            }),
            listen(doc, 'pointerup', () => this.stop(this.#session?.doc !== doc)),
            listen(doc, 'pointercancel', () => this.stop(true)),
        ]
        const remove = () => {
            if (this.#session?.doc === doc) this.stop()
            removers.forEach(fn => fn())
            this.#remove = this.#remove.filter(fn => fn !== remove)
        }
        this.#remove.push(remove)
        return remove
    }
    move(e, sourceDoc) {
        const state = this.#session
        if (!state) return
        if (!(e.buttons & 1) || !this.#options.enabled()) {
            this.stop(true)
            return
        }
        const frame = sourceDoc?.defaultView?.frameElement
        const rect = frame?.getBoundingClientRect()
        state.x = e.clientX + (rect?.left ?? 0)
        state.y = e.clientY + (rect?.top ?? 0)
        const sel = state.doc.getSelection()
        if (!sel?.rangeCount || (sel.isCollapsed && !state.anchor)) {
            clearTimeout(this.#timer)
            state.direction = 0
            return
        }
        if (!state.anchor) {
            state.anchor = { node: sel.anchorNode, offset: sel.anchorOffset }
            const range = sel.getRangeAt(0)
            state.backward = sel.focusNode === range.startContainer
                && sel.focusOffset === range.startOffset
        }
        const bounds = this.#options.bounds()
        const left = state.x <= bounds.left + 48
        const right = state.x >= bounds.right - 48
        const top = state.y <= bounds.top + 64
        const bottom = state.y >= bounds.bottom - 64
        const direction = this.#options.rtl()
            ? (left && bottom ? 1 : right && top ? -1 : 0)
            : (right && bottom ? 1 : left && top ? -1 : 0)
        if (!state.framePending) {
            // Run after the browser's native selection default action.
            state.framePending = true
            requestAnimationFrame(() => {
                state.framePending = false
                if (this.#session === state) this.#extend(state)
            })
        }
        if (direction === state.direction) return
        clearTimeout(this.#timer)
        state.direction = direction
        state.revision++
        if (direction) state.lastDirection = direction
        if (direction) this.#schedule(state, 450)
    }
    #schedule(state, delay) {
        this.#timer = setTimeout(async () => {
            if (this.#session !== state || !state.direction || !this.#options.enabled()) return
            const direction = state.direction
            const revision = state.revision
            try {
                const moved = await this.#options.turn(state.doc, direction)
                if (this.#session !== state) return
                if (!moved) {
                    state.direction = 0
                    return
                }
                state.continued = true
                this.#extend(state)
                if (state.revision === revision && state.direction === direction)
                    this.#schedule(state, 1200)
            } catch {
                this.stop(true)
            }
        }, delay)
    }
    #extend(state) {
        const { doc, anchor } = state
        if (!anchor?.node.isConnected) return
        const visible = this.#options.visible(doc)
        if (!visible || visible.collapsed) return
        const frame = doc.defaultView?.frameElement?.getBoundingClientRect()
        const bounds = this.#options.bounds()
        const x = Math.max(bounds.left + 1, Math.min(bounds.right - 1, state.x)) - (frame?.left ?? 0)
        const y = Math.max(bounds.top + 1, Math.min(bounds.bottom - 1, state.y)) - (frame?.top ?? 0)
        let caret = doc.caretRangeFromPoint?.(x, y)
        if (!caret && doc.caretPositionFromPoint) {
            const point = doc.caretPositionFromPoint(x, y)
            if (point) {
                caret = doc.createRange()
                caret.setStart(point.offsetNode, point.offset)
                caret.collapse(true)
            }
        }
        const end = (state.direction || state.lastDirection || (state.backward ? -1 : 1)) === 1
        const visibleEnd = visible.cloneRange()
        visibleEnd.collapse(false)
        if (!caret || caret.compareBoundaryPoints(0, visible) < 0
            || caret.compareBoundaryPoints(0, visibleEnd) > 0) {
            caret = visible.cloneRange()
            caret.collapse(!end)
        }
        doc.getSelection()?.setBaseAndExtent(anchor.node, anchor.offset,
            caret.startContainer, caret.startOffset)
    }
    stop(commit = false) {
        clearTimeout(this.#timer)
        const state = this.#session
        if (state?.anchor) this.#extend(state)
        this.#session = undefined
        if (commit && state) state.doc.dispatchEvent(new Event('selection-drag-end'))
    }
    get active() {
        return !!this.#session?.anchor
    }
    destroy() {
        this.stop()
        for (const remove of [...this.#remove]) remove()
    }
}
