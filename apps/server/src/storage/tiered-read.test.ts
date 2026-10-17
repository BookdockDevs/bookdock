import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { config } from '../config'
import { readRemoteRange, type RemoteTierClient } from '../lib/remote-client'
import { TieredStorageDriver } from './tiered'

vi.mock('../config', () => ({ config: { dataDir: '' } }))
vi.mock('../db/client', () => ({ getDb: () => { throw new Error('No production database in storage tests') } }))

async function bytes(stream: Readable) {
  const parts: Buffer[] = []
  for await (const part of stream) parts.push(Buffer.from(part))
  return Buffer.concat(parts)
}

describe('remote Range verification', () => {
  it('accepts only matching 206 ranges with complete payloads', async () => {
    const range = { start: 3, end: 5 }
    expect(await readRemoteRange(new Response('abc', { status: 206, headers: { 'Content-Range': 'bytes 3-5/10' } }), range))
      .toEqual({ data: Buffer.from('abc'), size: 10 })
    for (const [status, header, body] of [[200, '', 'whole'], [206, 'bytes 0-2/10', 'abc'], [206, 'bytes 3-5/10', 'ab'], [206, 'bytes 3-5/10', 'abcd']] as const) {
      expect(await readRemoteRange(new Response(body, { status, headers: { 'Content-Range': header } }), range)).toBeNull()
    }
  })

  it('cancels ignored Range responses without downloading the whole file', async () => {
    const cancel = vi.fn()
    const response = new Response(new ReadableStream({ cancel }))
    expect(await readRemoteRange(response, { start: 0, end: 0 })).toBeNull()
    expect(cancel).toHaveBeenCalledOnce()
  })
})

describe('tiered reads', () => {
  let root: string
  let remote: RemoteTierClient
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookdock-tiered-'))
    Object.assign(config, { dataDir: root })
    remote = {
      mkdir: vi.fn(), upload: vi.fn(), delete: vi.fn(), exists: vi.fn().mockResolvedValue(true),
      size: vi.fn().mockResolvedValue(6), getStream: vi.fn().mockImplementation(async () => Readable.from(['abcdef'])),
      getRange: vi.fn().mockResolvedValue(null),
    }
  })
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

  it('uses real local size and bytes without consulting historical metadata or remote storage', async () => {
    await fs.mkdir(path.join(root, 'files/blobs'), { recursive: true })
    await fs.writeFile(path.join(root, 'files/blobs/book.epub'), 'actual length')
    const driver = new TieredStorageDriver(remote, '/storage', 1024)
    expect(await driver.size('blobs/book.epub')).toBe(13)
    expect(await bytes(await driver.get('blobs/book.epub', { start: 7, end: 12 }))).toEqual(Buffer.from('length'))
    expect(remote.size).not.toHaveBeenCalled()
  })

  it('serves verified partial data without fetching or publishing the full cache', async () => {
    vi.mocked(remote.getRange!).mockResolvedValue({ data: Buffer.from('bc'), size: 6 })
    const driver = new TieredStorageDriver(remote, '/storage', 1024)
    expect(await bytes(await driver.get('blobs/book.epub', { start: 1, end: 2 }))).toEqual(Buffer.from('bc'))
    expect(remote.getStream).not.toHaveBeenCalled()
    await expect(fs.access(path.join(root, 'files/blobs/book.epub'))).rejects.toThrow()
  })

  it('merges unsupported concurrent ranges into one full cache fill', async () => {
    const driver = new TieredStorageDriver(remote, '/storage', 1024)
    const reads = await Promise.all([driver.get('blobs/book.epub', { start: 0, end: 1 }), driver.get('blobs/book.epub', { start: 4, end: 5 })])
    expect(await bytes(reads[0])).toEqual(Buffer.from('ab'))
    expect(await bytes(reads[1])).toEqual(Buffer.from('ef'))
    expect(remote.getStream).toHaveBeenCalledOnce()
    expect(await driver.size('blobs/book.epub')).toBe(6)
  })

  it('avoids repeated high-latency tiny ranges for files small enough to cache whole', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(100000)
    vi.mocked(remote.getRange!).mockImplementation(async () => {
      vi.setSystemTime(102000)
      return { data: Buffer.from('a'), size: 6 }
    })
    try {
      const driver = new TieredStorageDriver(remote, '/storage', 1024)
      expect(await bytes(await driver.get('blobs/book.epub', { start: 0, end: 0 }))).toEqual(Buffer.from('a'))
      expect(remote.getStream).toHaveBeenCalledOnce()
      expect(await bytes(await driver.get('blobs/book.epub', { start: 1, end: 2 }))).toEqual(Buffer.from('bc'))
      expect(remote.getRange).toHaveBeenCalledOnce()
    } finally { vi.useRealTimers() }
  })

  it('rejects incomplete cache fills, removes temporary data, and retries on the next read', async () => {
    vi.mocked(remote.getStream).mockImplementationOnce(async () => Readable.from(['short']))
    const driver = new TieredStorageDriver(remote, '/storage', 1024)
    await driver.size('blobs/book.epub')
    await expect(driver.get('blobs/book.epub')).rejects.toThrow('unexpected size')
    expect(await fs.readdir(path.join(root, 'files/blobs'))).toEqual([])
    expect(await bytes(await driver.get('blobs/book.epub'))).toEqual(Buffer.from('abcdef'))
    expect(remote.getStream).toHaveBeenCalledTimes(2)
  })

  it('falls back to a shared download when remote metadata is unavailable', async () => {
    vi.mocked(remote.size).mockRejectedValue(new Error('HEAD unavailable'))
    const driver = new TieredStorageDriver(remote, '/storage', 1024)
    expect(await Promise.all([driver.size('blobs/book.epub'), driver.size('blobs/book.epub')])).toEqual([6, 6])
    expect(remote.getStream).toHaveBeenCalledOnce()
    expect(await bytes(await driver.get('blobs/book.epub'))).toEqual(Buffer.from('abcdef'))
    const metadataCalls = vi.mocked(remote.size).mock.calls.length
    expect(await driver.size('blobs/another.epub')).toBe(6)
    expect(remote.size).toHaveBeenCalledTimes(metadataCalls)
  })
})
