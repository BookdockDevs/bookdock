import { describe, expect, it } from 'vitest'

import { personalMetadataCandidateSchema, personalMetadataFieldsSchema, personalMetadataSourceManifestSchema } from './personal-metadata-source'

const manifest = { id: 'example-books', name: 'Example', version: '1.0.0', apiVersion: 1, entry: 'dist/index.js' }

describe('personal metadata source contract', () => {
  it('accepts the minimal manifest and optional local icon', () => {
    expect(personalMetadataSourceManifestSchema.safeParse(manifest).success).toBe(true)
    expect(personalMetadataSourceManifestSchema.safeParse({ ...manifest, icon: 'assets/icon.png' }).success).toBe(true)
  })

  it('rejects escaping paths and unsupported interface versions', () => {
    for (const entry of ['../index.js', '/index.js', 'C:/index.js', 'a\\index.js', 'a/../index.js']) {
      expect(personalMetadataSourceManifestSchema.safeParse({ ...manifest, entry }).success).toBe(false)
    }
    expect(personalMetadataSourceManifestSchema.safeParse({ ...manifest, apiVersion: 2 }).success).toBe(false)
  })

  it('requires candidate identity and title but permits partial details', () => {
    expect(personalMetadataCandidateSchema.safeParse({ id: '123', title: 'Book' }).success).toBe(true)
    expect(personalMetadataCandidateSchema.safeParse({ id: '123' }).success).toBe(false)
    expect(personalMetadataFieldsSchema.parse({ description: '  text\n' })).toEqual({ description: '  text\n' })
  })
})
