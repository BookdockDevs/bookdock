import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { and, eq } from 'drizzle-orm'
import { decodeHTML } from 'entities'

import {
  DICTIONARY_MAX_COUNT,
  DICTIONARY_MAX_FILES,
  DICTIONARY_MAX_UPLOAD_BYTES,
  type DictionaryItem,
  type DictionaryList,
  type DictionaryLookupResult,
  type DictionaryScope,
  type DictionaryUpdateReq,
} from '@bookdock/shared'

import { getDb } from '../../db/client'
import { settings } from '../../db/schema'
import { createId } from '../../lib/id'
import { dictionaryDirectory, readDictionary, releaseDictionaryReader } from '../../lib/mdict-reader'
import { AppError } from '../../middleware/error'

interface StoredDictionary {
  id: string
  name: string
  fileNames: string[]
  size: number
  enabled: boolean
  createdAt: number
  scope: DictionaryScope
  hash: string
  mdx: string
  mdds: string[]
  cssFiles?: string[]
}

interface UserDictionaryOverride {
  enabled?: boolean
  name?: string
}

interface Manifest {
  items: StoredDictionary[]
  lastUsedId: string | null
  overrides?: Record<string, UserDictionaryOverride>
  order?: string[]
}

function manifest(userId: string): Manifest {
  const row = getDb().select().from(settings).where(and(eq(settings.userId, userId), eq(settings.key, 'dictionaries'))).get()
  return (row?.value as Manifest | undefined) ?? { items: [], lastUsedId: null }
}

function save(userId: string, value: Manifest) {
  getDb().insert(settings).values({ id: createId('setting'), userId, key: 'dictionaries', value })
    .onConflictDoUpdate({ target: [settings.userId, settings.key], set: { value } }).run()
}

function allInstanceDictionaries(): { item: StoredDictionary; ownerUserId: string }[] {
  const rows = getDb().select().from(settings).where(eq(settings.key, 'dictionaries')).all()
  const result: { item: StoredDictionary; ownerUserId: string }[] = []
  for (const row of rows) {
    const m = row.value as Manifest | null
    for (const item of m?.items ?? []) {
      if (item.scope === 'instance') {
        result.push({ item, ownerUserId: row.userId })
      }
    }
  }
  return result
}

function toView(item: StoredDictionary, mine: boolean, name = item.name, enabled = item.enabled): DictionaryItem {
  return {
    id: item.id,
    name,
    fileNames: item.fileNames,
    size: item.size,
    enabled,
    createdAt: item.createdAt,
    scope: item.scope ?? 'user',
    mine,
  }
}

function resolveDictionary(userId: string | null, id: string, enabledOnly = false): { item: StoredDictionary; directoryUserId: string } {
  if (userId) {
    const userManifest = manifest(userId)
    const personal = userManifest.items.find((entry) => entry.id === id)
    if (personal) {
      if (enabledOnly && !personal.enabled) throw new AppError('DICTIONARY_NOT_FOUND', 'Dictionary not found')
      return { item: personal, directoryUserId: userId }
    }
  }

  const instances = allInstanceDictionaries()
  const instanceEntry = instances.find((entry) => entry.item.id === id)
  if (instanceEntry) {
    if (enabledOnly) {
      let isEnabled = instanceEntry.item.enabled
      if (userId) {
        const userManifest = manifest(userId)
        if (userManifest.overrides?.[id]?.enabled !== undefined) {
          isEnabled = userManifest.overrides[id].enabled!
        }
      }
      if (!isEnabled) throw new AppError('DICTIONARY_NOT_FOUND', 'Dictionary not found')
    }
    return { item: instanceEntry.item, directoryUserId: instanceEntry.ownerUserId }
  }

  throw new AppError('DICTIONARY_NOT_FOUND', 'Dictionary not found')
}

function jobPaths(directoryUserId: string, item: StoredDictionary) {
  const directory = dictionaryDirectory(directoryUserId, item.id)
  return { mdx: path.join(directory, item.mdx), mdds: item.mdds.map((file) => path.join(directory, file)) }
}

export function listDictionaries(userId: string | null): DictionaryList {
  const instances = allInstanceDictionaries()
  if (!userId) {
    return {
      items: instances.map((entry) => toView(entry.item, false)),
      lastUsedId: null,
    }
  }

  const userManifest = manifest(userId)
  const itemsMap = new Map<string, DictionaryItem>()

  for (const item of userManifest.items) {
    if (item.scope !== 'instance') {
      itemsMap.set(item.id, toView(item, true))
    }
  }

  for (const entry of instances) {
    const isMine = entry.ownerUserId === userId
    const override = userManifest.overrides?.[entry.item.id]
    const effectiveName = override?.name?.trim() || entry.item.name
    const effectiveEnabled = override?.enabled !== undefined ? override.enabled : entry.item.enabled
    itemsMap.set(entry.item.id, toView(entry.item, isMine, effectiveName, effectiveEnabled))
  }

  let items = Array.from(itemsMap.values())
  if (userManifest.order?.length) {
    const orderMap = new Map(userManifest.order.map((id, index) => [id, index]))
    items.sort((a, b) => {
      const orderA = orderMap.has(a.id) ? orderMap.get(a.id)! : 9999
      const orderB = orderMap.has(b.id) ? orderMap.get(b.id)! : 9999
      return orderA - orderB || a.createdAt - b.createdAt
    })
  }

  return { items, lastUsedId: userManifest.lastUsedId }
}

export async function importDictionary(userId: string, files: File[]): Promise<DictionaryItem> {
  const mdxs = files.filter((file) => /\.mdx$/i.test(file.name))
  if (mdxs.length !== 1 || files.length > DICTIONARY_MAX_FILES || files.some((file) => file.name.length > 255 || !/\.(mdx|mdd|css)$/i.test(file.name)) || files.some((file) => !file.size)) {
    throw new AppError('DICTIONARY_INVALID', 'Select one MDX and its optional MDD or CSS files')
  }
  const size = files.reduce((sum, file) => sum + file.size, 0)
  if (size > DICTIONARY_MAX_UPLOAD_BYTES) throw new AppError('UPLOAD_TOO_LARGE')
  const stem = mdxs[0]!.name.slice(0, -4).toLowerCase()
  const mdds = files.filter((file) => /\.mdd$/i.test(file.name)).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  if (mdds.some((file) => { const name = file.name.slice(0, -4).toLowerCase(); return name !== stem && !(name.startsWith(stem) && /^[ ._-]\d+$/.test(name.slice(stem.length))) })) {
    throw new AppError('DICTIONARY_INVALID', 'MDD filenames must match the MDX name')
  }
  if (manifest(userId).items.length >= DICTIONARY_MAX_COUNT) throw new AppError('DICTIONARY_INVALID', 'Dictionary limit reached')
  const header = Buffer.from(await mdxs[0]!.slice(0, 1_048_580).arrayBuffer())
  const headerSize = header.length >= 4 ? header.readUInt32BE(0) : 0
  if (!headerSize || headerSize > 1_048_576 || header.length < headerSize + 4 || headerSize % 2) throw new AppError('DICTIONARY_INVALID', 'Invalid MDX header')
  const xml = header.subarray(4, 4 + headerSize).toString('utf16le')
  if (!/<Dictionary\b/i.test(xml) || !/GeneratedByEngineVersion\s*=\s*["'](?:1\.[0-9]+|2\.[0-9]+)["']/i.test(xml)) throw new AppError('DICTIONARY_INVALID', 'Unsupported MDX version')
  const encrypted = xml.match(/Encrypted\s*=\s*["']([^"']+)/i)?.[1] ?? '0'
  if (/yes/i.test(encrypted) || (Number(encrypted) & 1)) throw new AppError('DICTIONARY_INVALID', 'Password-protected dictionaries are unsupported')
  const title = xml.match(/Title\s*=\s*"([^"]*)"/i)?.[1]
  const name = (title ? decodeHTML(title).replace(/<[^>]*>/g, '').trim() : '') || mdxs[0]!.name.slice(0, -4)
  const id = createId('dict')
  const directory = dictionaryDirectory(userId, id)
  await fs.mkdir(directory, { recursive: true })
  const hash = createHash('sha256')
  const cssFiles = files.filter((file) => /\.css$/i.test(file.name))
  const storedFiles = [mdxs[0]!, ...mdds, ...cssFiles]
  try {
    for (let index = 0; index < storedFiles.length; index++) {
      const file = storedFiles[index]!
      const bytes = Buffer.from(await file.arrayBuffer())
      hash.update(path.basename(file.name) + ':' + String(bytes.length) + ':').update(bytes)
      let filename: string
      if (index === 0) {
        filename = 'dictionary.mdx'
      } else if (index <= mdds.length) {
        filename = `${index}.mdd`
      } else {
        filename = path.basename(file.name)
      }
      await fs.writeFile(path.join(directory, filename), bytes)
    }
    const item: StoredDictionary = {
      id,
      name: name.slice(0, 200),
      size,
      enabled: true,
      scope: 'user',
      createdAt: Date.now(),
      fileNames: storedFiles.map((file) => path.basename(file.name)),
      hash: hash.digest('hex'),
      mdx: 'dictionary.mdx',
      mdds: mdds.map((_file, index) => `${index + 1}.mdd`),
      cssFiles: cssFiles.map((file) => path.basename(file.name)),
    }
    const duplicate = manifest(userId).items.find((entry) => entry.hash === item.hash)
    if (duplicate) {
      await fs.rm(directory, { recursive: true, force: true })
      return toView(duplicate, true)
    }
    await readDictionary({ ...jobPaths(userId, item), kind: 'validate' })
    const current = manifest(userId)
    const existing = current.items.find((entry) => entry.hash === item.hash)
    if (existing) {
      await releaseDictionaryReader(directory)
      await fs.rm(directory, { recursive: true, force: true })
      return toView(existing, true)
    }
    if (current.items.length >= DICTIONARY_MAX_COUNT) throw new AppError('DICTIONARY_INVALID', 'Dictionary limit reached')
    save(userId, { ...current, items: [...current.items, item] })
    return toView(item, true)
  } catch (error) {
    await releaseDictionaryReader(directory)
    await fs.rm(directory, { recursive: true, force: true })
    throw error
  }
}

export function updateDictionary(
  userId: string,
  userRoleOrId: string,
  idOrInput: string | boolean | DictionaryUpdateReq,
  maybeInput?: DictionaryUpdateReq,
): DictionaryList {
  const userRole = maybeInput !== undefined ? userRoleOrId : 'member'
  const id = (maybeInput !== undefined ? idOrInput : userRoleOrId) as string
  const rawInput = maybeInput !== undefined ? maybeInput : idOrInput
  const input: DictionaryUpdateReq = typeof rawInput === 'boolean' ? { enabled: rawInput } : (rawInput as DictionaryUpdateReq)

  const userManifest = manifest(userId)
  const personal = userManifest.items.find((item) => item.id === id)

  if (personal) {
    if (input.scope !== undefined && input.scope !== personal.scope) {
      if (userRole !== 'owner') throw new AppError('FORBIDDEN', 'Owner only')
      personal.scope = input.scope
    }
    if (input.name !== undefined) {
      const trimmed = input.name.trim().slice(0, 100)
      if (!trimmed) throw new AppError('VALIDATION_ERROR', 'Name cannot be empty')
      personal.name = trimmed
    }
    if (input.enabled !== undefined) {
      personal.enabled = input.enabled
    }
    save(userId, userManifest)
    return listDictionaries(userId)
  }

  const instances = allInstanceDictionaries()
  const instanceEntry = instances.find((entry) => entry.item.id === id)
  if (!instanceEntry) throw new AppError('DICTIONARY_NOT_FOUND', 'Dictionary not found')

  if (input.scope !== undefined && input.scope !== instanceEntry.item.scope) {
    if (userRole !== 'owner') throw new AppError('FORBIDDEN', 'Owner only')
    const ownerManifest = manifest(instanceEntry.ownerUserId)
    const ownerItem = ownerManifest.items.find((item) => item.id === id)
    if (ownerItem) {
      ownerItem.scope = input.scope
      save(instanceEntry.ownerUserId, ownerManifest)
    }
  }

  if (instanceEntry.ownerUserId === userId && input.name !== undefined) {
    const trimmed = input.name.trim().slice(0, 100)
    if (!trimmed) throw new AppError('VALIDATION_ERROR', 'Name cannot be empty')
    instanceEntry.item.name = trimmed
    const ownerManifest = manifest(userId)
    const ownerItem = ownerManifest.items.find((item) => item.id === id)
    if (ownerItem) {
      ownerItem.name = trimmed
      save(userId, ownerManifest)
    }
  } else if (input.name !== undefined || input.enabled !== undefined) {
    const prev = userManifest.overrides?.[id] ?? {}
    const updated: UserDictionaryOverride = { ...prev }
    if (input.name !== undefined) {
      const trimmed = input.name.trim().slice(0, 100)
      if (!trimmed) throw new AppError('VALIDATION_ERROR', 'Name cannot be empty')
      updated.name = trimmed
    }
    if (input.enabled !== undefined) {
      updated.enabled = input.enabled
    }
    userManifest.overrides = { ...userManifest.overrides, [id]: updated }
    save(userId, userManifest)
  }

  return listDictionaries(userId)
}

export function reorderDictionaries(userId: string, ids: string[]): DictionaryList {
  const currentList = listDictionaries(userId)
  const currentIds = currentList.items.map((item) => item.id)
  if (
    ids.length !== currentIds.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !currentIds.includes(id))
  ) {
    throw new AppError('VALIDATION_ERROR', 'Invalid dictionary order')
  }
  const userManifest = manifest(userId)
  save(userId, { ...userManifest, order: ids })
  return listDictionaries(userId)
}

export async function deleteDictionary(
  userId: string,
  userRoleOrId: string,
  maybeId?: string,
): Promise<void> {
  const userRole = maybeId !== undefined ? userRoleOrId : 'member'
  const id = maybeId !== undefined ? maybeId : userRoleOrId

  const userManifest = manifest(userId)
  const personal = userManifest.items.find((item) => item.id === id)

  if (personal) {
    userManifest.items = userManifest.items.filter((item) => item.id !== id)
    if (userManifest.lastUsedId === id) userManifest.lastUsedId = null
    save(userId, userManifest)
    const directory = dictionaryDirectory(userId, id)
    await releaseDictionaryReader(directory)
    await fs.rm(directory, { recursive: true, force: true })
    return
  }

  const instances = allInstanceDictionaries()
  const instanceEntry = instances.find((entry) => entry.item.id === id)
  if (!instanceEntry) throw new AppError('DICTIONARY_NOT_FOUND', 'Dictionary not found')

  if (instanceEntry.ownerUserId !== userId && userRole !== 'owner') {
    throw new AppError('FORBIDDEN', 'Only the uploader or an owner can delete this dictionary')
  }

  const ownerManifest = manifest(instanceEntry.ownerUserId)
  ownerManifest.items = ownerManifest.items.filter((item) => item.id !== id)
  if (ownerManifest.lastUsedId === id) ownerManifest.lastUsedId = null
  save(instanceEntry.ownerUserId, ownerManifest)

  const directory = dictionaryDirectory(instanceEntry.ownerUserId, id)
  await releaseDictionaryReader(directory)
  await fs.rm(directory, { recursive: true, force: true })
}

export function dictionaryCandidates(value: string) {
  const word = value.trim().replace(/\s+/g, ' ').replace(/^[\s.,!?;:"“”‘’()[\]{}，。！？；：「」『』《》]+|[\s.,!?;:"“”‘’()[\]{}，。！？；：「」『』《》]+$/g, '')
  const candidates = [word, word.toLowerCase(), word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(), word.toUpperCase()]
  if (/^[a-z]+(?:'s)?$/i.test(word)) {
    const lower = word.toLowerCase().replace(/'s$/, '')
    const irregular: Record<string, string> = { went: 'go', gone: 'go', was: 'be', were: 'be', been: 'be', children: 'child', men: 'man', women: 'woman', feet: 'foot', teeth: 'tooth', mice: 'mouse', better: 'good', best: 'good', worse: 'bad', worst: 'bad', did: 'do', done: 'do', had: 'have', saw: 'see', seen: 'see', took: 'take', taken: 'take', bought: 'buy', thought: 'think', brought: 'bring', wrote: 'write', written: 'write' }
    candidates.push(lower, irregular[lower] ?? '')
    if (lower.endsWith('ies')) candidates.push(lower.slice(0, -3) + 'y')
    if (lower.endsWith('s')) candidates.push(lower.slice(0, -1), lower.slice(0, -2))
    for (const suffix of ['ing', 'ed', 'er', 'est']) if (lower.endsWith(suffix) && lower.length > suffix.length + 2) {
      const base = lower.slice(0, -suffix.length)
      candidates.push(base, base + 'e')
      if (/(.)\1$/.test(base)) candidates.push(base.slice(0, -1))
      if (base.endsWith('i')) candidates.push(base.slice(0, -1) + 'y')
    }
  }
  return [...new Set(candidates.filter(Boolean))].slice(0, 24)
}

export async function lookupDictionary(userId: string | null, id: string, word: string): Promise<DictionaryLookupResult> {
  const { item, directoryUserId } = resolveDictionary(userId, id, true)
  const result = await readDictionary({ ...jobPaths(directoryUserId, item), kind: 'lookup', candidates: dictionaryCandidates(word) })
  if (userId) {
    const current = manifest(userId)
    save(userId, { ...current, lastUsedId: id })
  }
  let html = result.html ?? ''
  if (html && item.cssFiles && item.cssFiles.length > 0) {
    const unlinked = item.cssFiles.filter((css) => !html.toLowerCase().includes(css.toLowerCase()))
    if (unlinked.length > 0) {
      const links = unlinked.map((css) => `<link rel="stylesheet" href="${encodeURI(css)}">`).join('')
      html = links + html
    }
  }
  return { query: word, headword: result.headword ?? null, html }
}

export async function dictionaryResource(userId: string | null, id: string, key: string) {
  const { item, directoryUserId } = resolveDictionary(userId, id, true)
  if (!key || key.length > 1024 || [...key].some((char) => char.charCodeAt(0) < 32) || /(^|[\\/])\.\.([\\/]|$)/.test(key) || /^[a-z][a-z\d+.-]*:/i.test(key)) throw new AppError('DICTIONARY_NOT_FOUND')
  const types: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.css': 'text/css', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' }
  const type = types[path.extname(key).toLowerCase()]
  if (!type) throw new AppError('DICTIONARY_NOT_FOUND')
  const ext = path.extname(key).toLowerCase()
  const reply = await readDictionary({ ...jobPaths(directoryUserId, item), kind: 'resource', key })
  if (reply.data) return { bytes: Buffer.from(reply.data, 'base64'), type }
  if (ext === '.css' && item.cssFiles && item.cssFiles.length > 0) {
    const directory = dictionaryDirectory(directoryUserId, item.id)
    const baseName = path.basename(key.replaceAll('/', path.sep))
    const matched = item.cssFiles.find((f) => f.toLowerCase() === baseName.toLowerCase())
    if (matched) {
      const filePath = path.join(directory, matched)
      if (existsSync(filePath)) {
        const bytes = await fs.readFile(filePath)
        return { bytes, type }
      }
    }
  }
  throw new AppError('DICTIONARY_NOT_FOUND')
}
