import { beforeEach, describe, expect, it } from 'vitest'

import type { ClientBookRef } from '@bookdock/shared'

import { useAuthStore } from '@/stores/auth.store'
import { useDownloadStore } from '@/stores/download.store'

const deviceRef = (id: string): ClientBookRef => ({ scope: { kind: 'local', vaultId: 'vault' }, bookId: id })
const serverRef = (id: string): ClientBookRef => ({ scope: { kind: 'remote', connectionId: 'conn', accountId: 'reader' }, bookId: id })
const target = (id: string, ref: ClientBookRef) => ({ id, ref, title: id, format: 'epub' as const })

function signedIn() {
  useAuthStore.setState({ user: { id: 'reader', username: 'Reader', role: 'owner' } })
}

describe('download target ownership', () => {
  beforeEach(() => {
    useDownloadStore.getState().close()
    useAuthStore.setState({ user: null })
  })

  it('opens a mixed batch for a signed-in reader', () => {
    signedIn()
    useDownloadStore.getState().open([target('a', deviceRef('a')), target('b', serverRef('b'))])
    expect(useDownloadStore.getState().target?.map((item) => item.id)).toEqual(['a', 'b'])
    expect(useDownloadStore.getState().userId).toBe('reader')
  })

  it('opens a device-only batch without an account', () => {
    useDownloadStore.getState().open([target('a', deviceRef('a'))])
    expect(useDownloadStore.getState().target).toHaveLength(1)
    expect(useDownloadStore.getState().userId).toBeNull()
  })

  it('keeps only the device rows of a mixed batch when signed out', () => {
    // A silent no-op is what this used to be; the device half is still readable.
    useDownloadStore.getState().open([target('a', deviceRef('a')), target('b', serverRef('b'))])
    expect(useDownloadStore.getState().target?.map((item) => item.id)).toEqual(['a'])
    expect(useDownloadStore.getState().userId).toBeNull()
  })

  it('ignores a server-only batch when signed out', () => {
    useDownloadStore.getState().open([target('b', serverRef('b'))])
    expect(useDownloadStore.getState().target).toBeNull()
  })
})
