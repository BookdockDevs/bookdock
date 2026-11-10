// Node 21+ exposes navigator.language from the OS locale (for example en-US on Linux CI runners).
// Clear it before importing modules so extension tests deterministically use the source locale ('zh-CN').
if (typeof globalThis.navigator !== 'undefined') {
  Object.defineProperty(globalThis.navigator, 'language', {
    value: '',
    configurable: true,
  })
}
