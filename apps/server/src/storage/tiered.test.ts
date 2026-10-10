import { describe, expect, it } from 'vitest'

import { S3Client } from '../lib/s3'
import { WebDavClient } from '../lib/webdav'
import type { RemoteTierClient } from '../lib/remote-client'
import { buildRemoteClientForConnection, TieredStorageDriver } from './tiered'

describe('tiered remote client factory', () => {
  it('builds a WebDavClient for webdav connections', () => {
    const client = buildRemoteClientForConnection({
      provider: 'webdav',
      endpoint: 'https://dav.example.com',
      username: 'user',
      encryptedPassword: null,
      region: '',
      bucket: '',
    })
    expect(client).toBeInstanceOf(WebDavClient)
  })

  it('builds an S3Client for s3 connections', () => {
    const client = buildRemoteClientForConnection({
      provider: 's3',
      endpoint: 'http://localhost:9000',
      username: 'minioadmin',
      encryptedPassword: null,
      region: 'us-east-1',
      bucket: 'bookdock',
    })
    expect(client).toBeInstanceOf(S3Client)
  })

  it('accepts any RemoteTierClient implementation', () => {
    const calls: string[] = []
    const fake: RemoteTierClient = {
      async mkdir(dir) { calls.push(`mkdir:${dir}`) },
      async upload(file) { calls.push(`upload:${file}`) },
      async delete(file) { calls.push(`delete:${file}`) },
      async exists() { return false },
      async size() { return 0 },
      async getStream() { throw new Error('not implemented') },
    }
    const driver = new TieredStorageDriver(fake, '/Bookdock/storage', 2048)
    expect(driver).toBeInstanceOf(TieredStorageDriver)
  })
})
