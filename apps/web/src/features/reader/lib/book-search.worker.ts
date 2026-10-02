import { findMatches, type SearchMatchOptions } from './book-search-match'

self.onmessage = (event: MessageEvent<{ text: string; query: string; options: SearchMatchOptions }>) => {
  const { text, query, options } = event.data
  self.postMessage({ matches: findMatches(text, query, options) })
}
