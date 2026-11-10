import { describe, expect, it } from 'vitest'
import { clientBookKey, clientFractionSchema, clientLocatorSchema } from '@bookdock/shared'
import type { ClientBookRef } from '@bookdock/shared'

const book: ClientBookRef = { scope: { kind: 'local', vaultId: 'vault' }, bookId: 'book' }

describe('portable reading contracts', () => {
  it('isolates identical book IDs across vaults, accounts, instances and guests', () => {
    const scopes: ClientBookRef['scope'][] = [book.scope,
      { kind: 'local', vaultId: 'other' },
      { kind: 'remote', connectionId: 'one', accountId: 'a' },
      { kind: 'remote', connectionId: 'two', accountId: 'a' },
      { kind: 'remote', connectionId: 'one', accountId: 'b' },
      { kind: 'remote-guest', connectionId: 'one', guestScopeId: 'a' },
    ]
    expect(new Set(scopes.map((scope) => JSON.stringify(clientBookKey({ scope, bookId: 'book' })))) .size).toBe(scopes.length)
  })

  it('rejects invalid fractions and untagged layout coordinates', () => {
    for (const value of [NaN, Infinity, -0.1, 1.1]) expect(clientFractionSchema.safeParse(value).success).toBe(false)
    expect(clientLocatorSchema.safeParse({ content: { book, contentId: 'c' }, schemaVersion: 1, kind: 'epub-cfi', value: 'scroll:0.5' }).success).toBe(false)
  })
})
