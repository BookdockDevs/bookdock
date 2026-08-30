const getTokens = value => new Set((value ?? '').split(/\s+/).filter(Boolean))
// bookdock: accept both namespace-aware XHTML attributes and HTML-style epub:type.
const getTypes = el => getTokens(el?.getAttributeNS?.('http://www.idpf.org/2007/ops', 'type')
    || el?.getAttribute?.('epub:type'))
const getRoles = el => getTokens(el?.getAttribute?.('role'))

const isSuper = el => {
    if (!el) return false
    try {
        const { verticalAlign } = getComputedStyle(el)
        return verticalAlign === 'super' || /^\d/.test(verticalAlign)
    } catch {
        return false
    }
}

const refTypes = ['biblioref', 'glossref', 'noteref']
const refRoles = ['doc-biblioref', 'doc-glossref', 'doc-noteref']
const knownClasses = new Set(['duokan-footnote', 'footnote-link', 'footnote-ref', 'footnote'])
const isBacklink = el => getTypes(el).has('backlink') || getRoles(el).has('doc-backlink')
const isExplicitReference = el => {
    const types = getTypes(el)
    const roles = getRoles(el)
    return refRoles.some(r => roles.has(r)) || refTypes.some(t => types.has(t))
        || [...(el?.classList ?? [])].some(name => knownClasses.has(name))
}
const isSuperscriptCandidate = el => !isBacklink(el)
    && (isSuper(el) || el?.children?.length === 1 && isSuper(el.children[0]) || isSuper(el?.parentElement))
const elementOf = value => {
    if (value?.nodeType === 1) return value
    if (value?.startContainer) {
        return value.startContainer.nodeType === 1
            ? value.startContainer
            : value.startContainer.parentElement
    }
    return null
}
const isInline = 'a, span, sup, sub, em, strong, i, b, small, big'
const hasNoteContent = el => {
    if (!el || el.matches?.(isInline)) return false
    return Boolean(el.textContent?.trim())
}
const isNumberLink = el => /^\d{1,4}[.)]?$/.test(el?.textContent?.trim() ?? '')
const isNumberLinkCluster = anchor => {
    if (!isNumberLink(anchor)) return false
    let parent = anchor?.parentElement
    for (let depth = 0; parent && depth < 3; depth++, parent = parent.parentElement) {
        const links = [...parent.querySelectorAll('a[href]')]
        if (links.filter(isNumberLink).length >= 2) return true
    }
    return false
}

const getReferencedType = el => {
    const types = getTypes(el)
    const roles = getRoles(el)
    return roles.has('doc-biblioentry') || types.has('biblioentry') ? 'biblioentry'
        : roles.has('definition') || types.has('glossdef') ? 'definition'
            : roles.has('doc-endnote') || types.has('endnote') || types.has('rearnote') ? 'endnote'
                : roles.has('doc-footnote') || types.has('footnote') ? 'footnote'
                    : roles.has('note') || types.has('note') ? 'note' : null
}

// bookdock: explicit references and conservative superscript fallback are kept
// here so ordinary links remain cancelable and reversible at the host boundary.
export const classifyFootnoteReference = (anchor, target) => {
    if (!anchor?.getAttribute?.('href') || isBacklink(anchor)) return { kind: 'normal' }
    if (isExplicitReference(anchor)) {
        const types = getTypes(anchor)
        const roles = getRoles(anchor)
        const reason = refRoles.some(r => roles.has(r)) ? 'aria-role'
            : refTypes.some(t => types.has(t)) ? 'epub-type' : 'known-class'
        return { kind: 'explicit', reason }
    }
    if (isNumberLinkCluster(anchor) || !isSuperscriptCandidate(anchor)) return { kind: 'normal' }
    const targetElement = elementOf(target)
    if (getReferencedType(targetElement) || hasNoteContent(targetElement)) {
        return { kind: 'heuristic', reason: 'superscript-note-target' }
    }
    return { kind: 'normal' }
}

// bookdock: extract a block fragment without mutating the source chapter.
const extractFootnote = (doc, anchor) => {
    const rawTarget = anchor(doc)
    let el = elementOf(rawTarget)
    const target = elementOf(rawTarget)
    if (!el) throw new Error('Failed to resolve footnote target')
    while (el.matches(isInline)) {
        const parent = el.parentElement
        if (!parent) break
        el = parent
    }
    if (el === doc.body) {
        const sibling = target.nextElementSibling
            if (sibling && !sibling.matches(isInline)) return sibling
        throw new Error('Failed to extract footnote')
    }
    return el
}

export class FootnoteHandler extends EventTarget {
    // bookdock: request cancellation and disposable temporary views make popup
    // teardown safe when navigation or React unmount races async section loads.
    detectFootnotes = true
    #nextRequestId = 0
    #pending = new Map()
    #cancelled = new Set()
    #showFragment(book, { index, anchor }, href, requestId) {
        const view = document.createElement('foliate-view')
        return new Promise((resolve, reject) => {
            if (this.#cancelled.delete(requestId)) {
                view.remove()
                resolve({ kind: 'cancelled', view })
                return
            }
            let settled = false
            const cleanup = () => {
                this.#pending.delete(requestId)
                view.removeEventListener('load', onLoad)
            }
            const cancel = () => {
                if (settled) return
                settled = true
                cleanup()
                try { view.close() } catch { /* the view may not have opened */ }
                view.remove()
                resolve({ kind: 'cancelled', view })
            }
            this.#pending.set(requestId, { view, cancel })
            const onLoad = e => {
                if (settled) return
                try {
                    const { doc } = e.detail
                    const raw = anchor(doc)
                    const el = elementOf(raw)
                    if (!el) throw new Error('Failed to resolve footnote target')
                    const type = getReferencedType(el)
                    const hidden = el.matches?.('aside') && type === 'footnote'
                    if (hidden) {
                        el.removeAttribute('hidden')
                        el.style.display = 'block'
                    }
                    const range = raw?.startContainer ? raw : doc.createRange()
                    if (!raw?.startContainer) {
                        if (el.matches('li, aside')) range.selectNodeContents(el)
                        else range.selectNode(el)
                    }
                    const frag = range.extractContents()
                    doc.body.replaceChildren()
                    doc.body.appendChild(frag)
                    const detail = { view, href, type, hidden, target: el, requestId }
                    settled = true
                    cleanup()
                    this.dispatchEvent(new CustomEvent('render', { detail }))
                    resolve({ kind: 'open', ...detail })
                } catch (e) {
                    settled = true
                    cleanup()
                    reject(e)
                }
            }
            view.addEventListener('load', onLoad)
            view.open(book)
                .then(() => this.dispatchEvent(new CustomEvent('before-render', { detail: { view, requestId } })))
                .then(() => settled ? undefined : view.goTo(index))
                .catch(e => {
                    if (settled) return
                    settled = true
                    cleanup()
                    try { view.close() } catch { /* partial init */ }
                    view.remove()
                    reject(e)
                })
        })
    }
    cancel(requestId) {
        const pending = this.#pending.get(requestId)
        if (pending) pending.cancel()
        else this.#cancelled.add(requestId)
    }
    dispose(view) {
        for (const [requestId, pending] of this.#pending) {
            if (pending.view === view) {
                pending.cancel()
                return
            }
        }
        try { view?.close?.() } catch { /* partial init */ }
        view?.remove?.()
    }
    disposeAll() {
        for (const requestId of this.#pending.keys()) this.cancel(requestId)
        this.#cancelled.clear()
    }
    handle(book, e) {
        const { a, href } = e.detail
        const classification = classifyFootnoteReference(a)
        const candidate = classification.kind === 'explicit' || isSuperscriptCandidate(a) && !isNumberLinkCluster(a)
        if (candidate) {
            e.preventDefault()
            const requestId = ++this.#nextRequestId
            const result = Promise.resolve().then(() => book.resolveHref(href)).then(async target => {
                if (!target) return { kind: 'fallback', href }
                if (classification.kind !== 'explicit') {
                    const doc = await book.sections?.[target.index]?.createDocument?.()
                    const rawTarget = doc ? target.anchor(doc) : null
                    const extracted = doc ? extractFootnote(doc, target.anchor) : null
                    if (classifyFootnoteReference(a, extracted ?? rawTarget).kind !== 'heuristic') {
                        return { kind: 'fallback', href }
                    }
                    return this.#showFragment(book, { index: target.index, anchor: doc2 => extractFootnote(doc2, target.anchor) }, href, requestId)
                }
                return this.#showFragment(book, target, href, requestId)
            }).catch(() => ({ kind: 'fallback', href }))
            result.requestId = requestId
            return result
        }
    }
}
