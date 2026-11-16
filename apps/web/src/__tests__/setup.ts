import '@testing-library/jest-dom'

// jsdom has no matchMedia; components relying on it (e.g. useIsTouch) get a
// non-touch stub — individual tests may still replace window.matchMedia.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

// jsdom leaves `Element.prototype.scrollIntoView` undefined. Components that
// scroll a located row into view from a timer (LibrarySidebar after a category
// change) would then throw from that callback, which Vitest reports as an
// uncaught exception and fails the file even though every assertion passed.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}
