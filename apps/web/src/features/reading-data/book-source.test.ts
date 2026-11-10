import { describe, expect, it } from 'vitest'

import type { ClientBookRef } from '@bookdock/shared'

import { bookStore, deviceScope, isDeviceBook, partitionByStore } from './book-source'

const device: ClientBookRef = { scope: { kind: 'local', vaultId: 'device' }, bookId: 'a' }
const server: ClientBookRef = { scope: { kind: 'remote', connectionId: 'conn', accountId: 'acct' }, bookId: 'b' }

describe('book source', () => {
  it('reads the store from the book, not from its neighbours', () => {
    expect(bookStore(device)).toBe('device')
    expect(bookStore(server)).toBe('server')
    expect(isDeviceBook(device)).toBe(true)
    expect(isDeviceBook(server)).toBe(false)
  })

  it('treats a missing ref as a server book', () => {
    expect(bookStore(undefined)).toBe('server')
    expect(bookStore(null)).toBe('server')
    expect(deviceScope(null)).toBeNull()
  })

  it('exposes the vault scope only for device books', () => {
    expect(deviceScope(device)).toEqual({ kind: 'local', vaultId: 'device' })
    expect(deviceScope(server)).toBeNull()
  })

  it('partitions a mixed selection without dropping or reordering rows', () => {
    const rows = [
      { id: '1', ref: device },
      { id: '2', ref: server },
      { id: '3', ref: device },
      { id: '4' },
    ]
    const { device: local, server: remote } = partitionByStore(rows, (row) => row.ref)
    expect(local.map((row) => row.id)).toEqual(['1', '3'])
    expect(remote.map((row) => row.id)).toEqual(['2', '4'])
    expect(local.length + remote.length).toBe(rows.length)
  })
})
