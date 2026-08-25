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
