export async function loadFoliateEngine(): Promise<any> {
  const existing = (globalThis as any).FoliateReader
  if (existing) return existing
  const dynamicImport = new Function('url', 'return import(url)') as (url: string) => Promise<unknown>
  await dynamicImport('/foliate-js/reader-entry.js')
  const engine = (globalThis as any).FoliateReader
  if (!engine) throw new Error('EPUB engine did not initialize')
  return engine
}
