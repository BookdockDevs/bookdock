const scope = globalThis as typeof globalThis & { browser?: typeof chrome; chrome?: typeof chrome }

/**
 * Chrome or Firefox entry point. `undefined` in Node (unit tests) and in any context without
 * the extension APIs — every caller is browser-only, and i18n probes it inside a try/catch.
 */
export const extension = (scope.browser ?? scope.chrome) as typeof chrome
