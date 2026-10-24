import { beforeEach, describe, expect, it } from 'vitest'

import { notify } from '@/lib/notifications'
import { publishUndoOpportunity } from '@/lib/undo'
import { useToastStore } from '@/stores/toast.store'
import { forwardReaderShortcut, isReaderContentTarget, isReaderModalOpen, READER_SHORTCUT_DEFAULTS, readReaderShortcuts, readerShortcutStorageKey, shortcutConflict, shortcutMatches, shortcutRejection, writeReaderShortcuts } from '../features/reader/lib/reader-shortcuts'

describe('reader shortcuts', () => {
  beforeEach(() => { localStorage.clear(); useToastStore.getState().clearToasts() })

  it('provides the requested defaults and keeps each account cache separate', () => {
    expect(READER_SHORTCUT_DEFAULTS.sidebar?.key).toBe('p')
    expect(READER_SHORTCUT_DEFAULTS.fontIncrease).toMatchObject({ key: '=', ctrl: true })
    expect(READER_SHORTCUT_DEFAULTS.search).toMatchObject({ key: 'f', ctrl: true })
    expect(READER_SHORTCUT_DEFAULTS).toMatchObject({
      historyBack: { key: 'ArrowLeft', alt: true },
      historyForward: { key: 'ArrowRight', alt: true },
      tts: { key: 'r' },
      autoReading: { key: 'a' },
      chapterStart: { key: 'Home' },
      chapterEnd: { key: 'End' },
      shortcutsMenu: { key: '/', shift: true },
      undo: { key: 'z', ctrl: true },
    })
    const changed = { ...READER_SHORTCUT_DEFAULTS, toc: null }
    writeReaderShortcuts('alice', changed)
    expect(readReaderShortcuts('alice').toc).toBeNull()
    expect(readReaderShortcuts('bob').toc).toEqual(READER_SHORTCUT_DEFAULTS.toc)
    expect(readerShortcutStorageKey(null)).not.toBe(readerShortcutStorageKey('alice'))
  })

  it('fills defaults for commands missing from an older saved map', () => {
    localStorage.setItem(readerShortcutStorageKey('alice'), JSON.stringify({ toc: null, search: READER_SHORTCUT_DEFAULTS.search }))
    expect(readReaderShortcuts('alice')).toMatchObject({ toc: null, historyBack: READER_SHORTCUT_DEFAULTS.historyBack, chapterEnd: READER_SHORTCUT_DEFAULTS.chapterEnd, undo: READER_SHORTCUT_DEFAULTS.undo })
  })

  it('matches modified keys, rejects collisions, and protects fixed/browser shortcuts', () => {
    expect(shortcutMatches({ key: 'f', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false }, READER_SHORTCUT_DEFAULTS.search)).toBe(true)
    expect(shortcutConflict(READER_SHORTCUT_DEFAULTS, 'toc', READER_SHORTCUT_DEFAULTS.sidebar!)).toBe('sidebar')
    expect(shortcutConflict(READER_SHORTCUT_DEFAULTS, 'search', READER_SHORTCUT_DEFAULTS.undo!)).toBe('undo')
    expect(shortcutRejection({ key: 'z', ctrl: true, meta: false, alt: false, shift: false })).toBeNull()
    expect(shortcutRejection({ key: 'w', ctrl: true, meta: false, alt: false, shift: false })).toBeTruthy()
    expect(shortcutRejection({ key: 'ArrowLeft', ctrl: false, meta: false, alt: false, shift: false })).toBeTruthy()
    expect(shortcutRejection(READER_SHORTCUT_DEFAULTS.historyBack!)).toBeNull()
    expect(shortcutRejection(READER_SHORTCUT_DEFAULTS.chapterStart!)).toBeNull()
    expect(shortcutRejection({ key: 'ArrowLeft', ctrl: false, meta: false, alt: true, shift: true })).toBeTruthy()
    expect(shortcutMatches({ key: 'ArrowLeft', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false }, READER_SHORTCUT_DEFAULTS.historyBack)).toBe(true)
    expect(shortcutMatches({ key: '+', ctrlKey: true, altKey: false, shiftKey: true, metaKey: false }, READER_SHORTCUT_DEFAULTS.fontIncrease)).toBe(true)
  })

  it('treats Ctrl plus and equals as the same binding for matching and conflict checks', () => {
    const map = { ...READER_SHORTCUT_DEFAULTS, toc: { key: '+', ctrl: true, alt: false, shift: true, meta: false } }
    expect(shortcutConflict(map, 'fontIncrease', READER_SHORTCUT_DEFAULTS.fontIncrease!)).toBe('toc')
    expect(shortcutMatches({ key: '=', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false }, map.toc)).toBe(true)
  })

  it('treats Ctrl and Command versions of a binding as conflicting across platforms', () => {
    const map = { ...READER_SHORTCUT_DEFAULTS, toc: { key: 'k', ctrl: true, alt: false, shift: false, meta: false } }
    expect(shortcutConflict(map, 'notes', { key: 'k', ctrl: false, alt: false, shift: false, meta: true })).toBe('toc')
  })

  it('matches Shift+/ when the browser reports the shifted key as question mark', () => {
    expect(shortcutMatches({ key: '?', ctrlKey: false, altKey: false, shiftKey: true, metaKey: false }, READER_SHORTCUT_DEFAULTS.shortcutsMenu)).toBe(true)
    expect(shortcutConflict(READER_SHORTCUT_DEFAULTS, 'toc', { key: '?', ctrl: false, alt: false, shift: true, meta: false })).toBe('shortcutsMenu')
  })

  it('blocks shortcuts for modal and alertdialog overlays', () => {
    document.body.innerHTML = '<div data-reader-modal></div>'
    expect(isReaderModalOpen()).toBe(true)
    document.body.innerHTML = '<div role="alertdialog" aria-modal="true"></div>'
    expect(isReaderModalOpen()).toBe(true)
    document.body.innerHTML = '<div role="dialog" aria-modal="true"></div>'
    expect(isReaderModalOpen()).toBe(true)
    document.body.innerHTML = ''
    expect(isReaderModalOpen()).toBe(false)
  })

  it('recognizes the renderer host nested inside the reader viewport as reading content', () => {
    const viewport = document.createElement('div')
    const rendererHost = document.createElement('div')
    viewport.append(rendererHost)

    expect(isReaderContentTarget(rendererHost, viewport)).toBe(true)
    expect(isReaderContentTarget(document.createElement('button'), viewport)).toBe(false)
  })

  it('forwards iframe shortcuts once with modifiers and leaves composing or text inputs alone', () => {
    const frameInput = document.createElement('div')
    const host = document.createElement('div')
    const received: KeyboardEvent[] = []
    host.addEventListener('keydown', (event) => received.push(event as KeyboardEvent))
    const search = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, cancelable: true, bubbles: true })
    Object.defineProperty(search, 'target', { value: document.body })
    expect(forwardReaderShortcut(search, host, READER_SHORTCUT_DEFAULTS)).toBe(true)
    expect(search.defaultPrevented).toBe(true)
    expect(received).toHaveLength(1)

    const undo = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, cancelable: true })
    Object.defineProperty(undo, 'target', { value: document.body })
    expect(forwardReaderShortcut(undo, host, READER_SHORTCUT_DEFAULTS)).toBe(false)
    expect(undo.defaultPrevented).toBe(false)
    expect(received[0]).toMatchObject({ key: 'f', ctrlKey: true })

    Object.defineProperty(frameInput, 'isContentEditable', { value: true })
    const typing = new KeyboardEvent('keydown', { key: 'p', cancelable: true })
    Object.defineProperty(typing, 'target', { value: frameInput })
    expect(forwardReaderShortcut(typing, host, READER_SHORTCUT_DEFAULTS)).toBe(false)
    expect(typing.defaultPrevented).toBe(false)
    const composing = new KeyboardEvent('keydown', { key: 'p', cancelable: true })
    Object.defineProperty(composing, 'isComposing', { value: true })
    expect(forwardReaderShortcut(composing, host, READER_SHORTCUT_DEFAULTS)).toBe(false)
    expect(received).toHaveLength(1)
  })

  it('intercepts Alt+Left in the iframe before a page-turn handler and releases cleared bindings', () => {
    const host = document.createElement('div')
    const received: KeyboardEvent[] = []
    let pageTurns = 0
    const pageTurn = () => { pageTurns++ }
    const forward = (event: Event) => forwardReaderShortcut(event as KeyboardEvent, host, READER_SHORTCUT_DEFAULTS)
    host.addEventListener('keydown', (event) => received.push(event as KeyboardEvent))
    document.addEventListener('keydown', forward, true)
    document.addEventListener('keydown', pageTurn)
    const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true })
    document.dispatchEvent(event)
    document.removeEventListener('keydown', forward, true)
    document.removeEventListener('keydown', pageTurn)

    expect(event.defaultPrevented).toBe(true)
    expect(received).toHaveLength(1)
    expect(pageTurns).toBe(0)
    expect(received[0]).toMatchObject({ key: 'ArrowLeft', altKey: true })

    const cleared = { ...READER_SHORTCUT_DEFAULTS, historyBack: null }
    const oldBinding = new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, cancelable: true })
    Object.defineProperty(oldBinding, 'target', { value: document.body })
    expect(forwardReaderShortcut(oldBinding, host, cleared)).toBe(false)
    expect(oldBinding.defaultPrevented).toBe(false)
  })

  it('forwards an active application undo from reader iframe focus once', () => {
    const receipt = { token: 'iframe-receipt' }
    publishUndoOpportunity(receipt)
    notify.success('ok', { undo: receipt })
    const host = document.createElement('div')
    const received: KeyboardEvent[] = []
    host.addEventListener('keydown', (event) => received.push(event as KeyboardEvent))
    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })
    Object.defineProperty(event, 'target', { value: document.body })

    expect(forwardReaderShortcut(event, host, READER_SHORTCUT_DEFAULTS)).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ key: 'z', ctrlKey: true })
  })
})
