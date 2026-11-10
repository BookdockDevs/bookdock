// Parsed EPUBs are engine objects and deliberately stay outside shared contracts.
export interface ReaderBookLease {
  book: any
  release(): void
}

export interface ReaderBookProvider {
  readonly cacheIdentity: string
  open(foliate: any, signal: AbortSignal): Promise<ReaderBookLease>
}

export function remoteBookProvider(cacheIdentity: string, openBook: (foliate: any) => Promise<any>): ReaderBookProvider {
  return {
    cacheIdentity,
    async open(foliate, signal) {
      signal.throwIfAborted()
      const book = await openBook(foliate)
      signal.throwIfAborted()
      return { book, release() {} }
    },
  }
}
