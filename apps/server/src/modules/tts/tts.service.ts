import crypto from 'node:crypto'

import type {
  TtsProvider,
  TtsProviderRes,
  TtsServiceCreateReq,
  TtsServiceRes,
  TtsServiceUpdateReq,
  TtsSpeechReq,
  TtsVoiceRes,
} from '@bookdock/shared'
import { and, desc, eq } from 'drizzle-orm'

import { config } from '../../config'
import { getDb } from '../../db/client'
import { ttsServices } from '../../db/schema'
import { AppError } from '../../middleware/error'
import { createId } from '../../lib/id'

const MAX_AUDIO_BYTES = 10 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 30_000

type TtsServiceRow = typeof ttsServices.$inferSelect
type ProviderConfig = {
  provider: TtsProvider
  baseUrl: string | null
  model: string | null
  defaultVoice: string | null
  options: Record<string, string | number | boolean>
  secrets: Record<string, string>
}
type AudioResult = { audio: Buffer; contentType: string }

const PROVIDERS: readonly TtsProviderRes[] = [
  { id: 'openai', kind: 'openai-compatible', defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: null },
  { id: 'azure', kind: 'native', defaultBaseUrl: null, defaultModel: null },
  { id: 'aliyun', kind: 'native', defaultBaseUrl: 'https://nls-gateway.aliyuncs.com/stream/v1/tts', defaultModel: null },
  { id: 'dashscope', kind: 'native', defaultBaseUrl: 'https://dashscope.aliyuncs.com', defaultModel: 'qwen3-tts-instruct-flash' },
  { id: 'minimax', kind: 'native', defaultBaseUrl: 'https://api.minimaxi.com', defaultModel: 'speech-2.8-turbo' },
  { id: 'mimo', kind: 'native', defaultBaseUrl: 'https://api.xiaomimimo.com/v1', defaultModel: 'mimo-v2.5-tts' },
  { id: 'volcengine', kind: 'native', defaultBaseUrl: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional', defaultModel: 'seed-tts-2.0' },
]

const PROVIDER_IDS = new Set<TtsProvider>(PROVIDERS.map((provider) => provider.id))

const OPENAI_VOICES: TtsVoiceRes[] = [
  { id: 'alloy', name: 'Alloy', lang: 'en-US' },
  { id: 'ash', name: 'Ash', lang: 'en-US' },
  { id: 'coral', name: 'Coral', lang: 'en-US' },
  { id: 'echo', name: 'Echo', lang: 'en-US' },
  { id: 'fable', name: 'Fable', lang: 'en-US' },
  { id: 'nova', name: 'Nova', lang: 'en-US' },
  { id: 'onyx', name: 'Onyx', lang: 'en-US' },
  { id: 'sage', name: 'Sage', lang: 'en-US' },
  { id: 'shimmer', name: 'Shimmer', lang: 'en-US' },
]

const DASHSCOPE_VOICES: TtsVoiceRes[] = [
  { id: 'Cherry', name: 'Cherry', lang: 'zh-CN' },
  { id: 'Ethan', name: 'Ethan', lang: 'en-US' },
  { id: 'Serena', name: 'Serena', lang: 'en-US' },
  { id: 'Moon', name: 'Moon', lang: 'zh-CN' },
  { id: 'Eldric Sage', name: 'Eldric Sage', lang: 'en-US' },
]

const MIMO_VOICES: TtsVoiceRes[] = [
  { id: '冰糖', name: '冰糖', lang: 'zh-CN' },
  { id: '苏打', name: '苏打', lang: 'zh-CN' },
  { id: '茉莉', name: '茉莉', lang: 'zh-CN' },
  { id: '小宇', name: '小宇', lang: 'zh-CN' },
]

const VOLCENGINE_VOICES: TtsVoiceRes[] = [
  { id: 'zh_male_ruyaqingnian_uranus_bigtts', name: '儒雅青年', lang: 'zh-CN' },
  { id: 'zh_male_linjiananhai_uranus_bigtts', name: '邻家男孩', lang: 'zh-CN' },
  { id: 'zh_male_huolixiaoge_uranus_bigtts', name: '活力小哥', lang: 'zh-CN' },
  { id: 'zh_female_meilinvyou_uranus_bigtts', name: '美丽女友', lang: 'zh-CN' },
]

const ALIYUN_VOICES: TtsVoiceRes[] = [
  { id: 'xiaoyun', name: '小云', lang: 'zh-CN' },
  { id: 'xiaogang', name: '小刚', lang: 'zh-CN' },
  { id: 'ruoxi', name: '若兮', lang: 'zh-CN' },
  { id: 'siqi', name: '思琪', lang: 'zh-CN' },
  { id: 'sijia', name: '思佳', lang: 'zh-CN' },
]

function providerCatalog(provider: TtsProvider) {
  const canonicalProvider = provider === 'openai-compatible' ? 'openai' : provider
  return PROVIDERS.find((item) => item.id === canonicalProvider)
}

function encryptionKey() {
  return crypto.createHash('sha256').update(config.jwtSecret).digest()
}

function encryptSecrets(secrets: Record<string, string>): string | null {
  const entries = Object.entries(secrets).filter(([, value]) => value.trim())
  if (entries.length === 0) return null
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(Object.fromEntries(entries)), 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.')
}

function decryptSecrets(value: string | null): Record<string, string> {
  if (!value) return {}
  try {
    const [ivEncoded, tagEncoded, ciphertextEncoded] = value.split('.')
    if (!ivEncoded || !tagEncoded || !ciphertextEncoded) return {}
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivEncoded, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'))
    const plain = Buffer.concat([
      decipher.update(Buffer.from(ciphertextEncoded, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
    const parsed = JSON.parse(plain) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  } catch {
    return {}
  }
}

function serviceConfig(row: TtsServiceRow): ProviderConfig {
  return {
    provider: row.provider === 'openai-compatible' ? 'openai' : row.provider,
    baseUrl: row.baseUrl,
    model: row.model,
    defaultVoice: row.defaultVoice,
    options: row.options ?? {},
    secrets: decryptSecrets(row.encryptedSecrets),
  }
}

function toServiceRes(row: TtsServiceRow): TtsServiceRes {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider === 'openai-compatible' ? 'openai' : row.provider,
    baseUrl: row.baseUrl,
    model: row.model,
    defaultVoice: row.defaultVoice,
    options: row.options ?? {},
    credentialsConfigured: Object.values(decryptSecrets(row.encryptedSecrets)).some((value) => value.trim()),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function getServiceRow(userId: string, serviceId: string) {
  const row = getDb().select().from(ttsServices).where(and(eq(ttsServices.id, serviceId), eq(ttsServices.userId, userId))).get()
  if (!row) throw new AppError('TTS_SERVICE_NOT_FOUND', 'TTS service not found')
  return row
}

function validateProvider(provider: TtsProvider) {
  const canonicalProvider = provider === 'openai-compatible' ? 'openai' : provider
  if (!PROVIDER_IDS.has(canonicalProvider)) throw new AppError('TTS_PROVIDER_NOT_SUPPORTED', 'TTS provider is not supported')
  return canonicalProvider
}

function mergeSecrets(existing: Record<string, string>, patch: Record<string, string | null> | undefined) {
  const next = { ...existing }
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === null || !value.trim()) delete next[key]
    else next[key] = value.trim()
  }
  return next
}

function requiredSecrets(provider: TtsProvider) {
  if (provider === 'aliyun') return ['appKey', 'accessKeyId', 'accessKeySecret']
  return ['apiKey']
}

function assertConfigured(provider: TtsProvider, row: { baseUrl: string | null; model: string | null; options: Record<string, string | number | boolean>; secrets: Record<string, string> }) {
  if (!requiredSecrets(provider).every((key) => Boolean(row.secrets[key]?.trim()))) {
    throw new AppError('TTS_NOT_CONFIGURED', 'TTS service credentials are incomplete')
  }
  if (provider === 'azure' && !String(row.options.region ?? '').trim()) {
    throw new AppError('TTS_NOT_CONFIGURED', 'Azure TTS requires a region')
  }
  if ((provider === 'openai' || provider === 'dashscope' || provider === 'minimax' || provider === 'mimo') && !row.model) {
    throw new AppError('TTS_NOT_CONFIGURED', 'TTS service requires a model')
  }
}

export function listTtsProviders(): readonly TtsProviderRes[] {
  return PROVIDERS
}

export function listTtsServices(userId: string, role: string): TtsServiceRes[] {
  if (role === 'guest') return []
  return getDb().select().from(ttsServices).where(eq(ttsServices.userId, userId)).orderBy(desc(ttsServices.updatedAt)).all().map(toServiceRes)
}

export function createTtsService(userId: string, role: string, input: TtsServiceCreateReq): TtsServiceRes {
  if (role === 'guest') throw new AppError('TTS_NOT_ALLOWED', 'Guest users cannot configure AI TTS')
  const provider = validateProvider(input.provider)
  const secrets = Object.fromEntries(Object.entries(input.secrets ?? {}).map(([key, value]) => [key, value.trim()]))
  const baseUrl = input.baseUrl ?? providerCatalog(provider)?.defaultBaseUrl ?? null
  const model = input.model ?? providerCatalog(provider)?.defaultModel ?? null
  const options = input.options ?? {}
  assertConfigured(provider, { baseUrl, model, options, secrets })
  const now = Date.now()
  const row = {
    id: createId('tts'),
    userId,
    name: input.name.trim(),
    provider,
    baseUrl,
    model,
    defaultVoice: input.defaultVoice?.trim() || null,
    options,
    encryptedSecrets: encryptSecrets(secrets),
    createdAt: now,
    updatedAt: now,
  }
  try {
    getDb().insert(ttsServices).values(row).run()
  } catch (error) {
    if (error instanceof Error && /unique/i.test(error.message)) throw new AppError('VALIDATION_ERROR', 'A TTS service with this name already exists')
    throw error
  }
  return toServiceRes(getServiceRow(userId, row.id))
}

export function updateTtsService(userId: string, role: string, serviceId: string, input: TtsServiceUpdateReq): TtsServiceRes {
  if (role === 'guest') throw new AppError('TTS_NOT_ALLOWED', 'Guest users cannot configure AI TTS')
  const existing = getServiceRow(userId, serviceId)
  const provider = validateProvider(input.provider ?? existing.provider)
  const secrets = mergeSecrets(decryptSecrets(existing.encryptedSecrets), input.secrets)
  const next = {
    baseUrl: input.baseUrl === undefined ? existing.baseUrl : input.baseUrl,
    model: input.model === undefined ? existing.model : input.model,
    options: input.options === undefined ? (existing.options ?? {}) : input.options,
    secrets,
  }
  assertConfigured(provider, next)
  try {
    getDb().update(ttsServices).set({
      name: input.name?.trim() ?? existing.name,
      provider,
      baseUrl: next.baseUrl,
      model: next.model,
      defaultVoice: input.defaultVoice === undefined ? existing.defaultVoice : input.defaultVoice?.trim() || null,
      options: next.options,
      encryptedSecrets: encryptSecrets(secrets),
      updatedAt: Date.now(),
    }).where(and(eq(ttsServices.id, serviceId), eq(ttsServices.userId, userId))).run()
  } catch (error) {
    if (error instanceof Error && /unique/i.test(error.message)) throw new AppError('VALIDATION_ERROR', 'A TTS service with this name already exists')
    throw error
  }
  return toServiceRes(getServiceRow(userId, serviceId))
}

export function deleteTtsService(userId: string, role: string, serviceId: string) {
  if (role === 'guest') throw new AppError('TTS_NOT_ALLOWED', 'Guest users cannot configure AI TTS')
  getServiceRow(userId, serviceId)
  getDb().delete(ttsServices).where(and(eq(ttsServices.id, serviceId), eq(ttsServices.userId, userId))).run()
}

async function fetchUpstream(url: string, init: RequestInit, signal: AbortSignal) {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  return fetch(url, { ...init, signal: AbortSignal.any([signal, timeoutSignal]) })
}

async function readAudio(response: Response, fallbackType: string): Promise<AudioResult> {
  if (!response.ok) throw new Error(`provider returned HTTP ${response.status}`)
  const contentType = (response.headers.get('content-type') ?? '').split(';', 1)[0].toLowerCase() || fallbackType
  const audio = Buffer.from(await response.arrayBuffer())
  if (audio.length === 0 || audio.length > MAX_AUDIO_BYTES) throw new Error('provider returned invalid audio')
  return { audio, contentType }
}

function joinUrl(baseUrl: string, suffix: string) {
  const normalized = baseUrl.replace(/\/+$/, '')
  return normalized.toLowerCase().endsWith(suffix.toLowerCase()) ? normalized : `${normalized}${suffix}`
}

function xmlEscape(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function ratePercent(rate: number) {
  return `${rate >= 1 ? '+' : ''}${Math.round((rate - 1) * 100)}%`
}

function pcmToWav(pcm: Buffer, sampleRate: number, channels = 1) {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * channels * 2, 28)
  header.writeUInt16LE(channels * 2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

async function synthesizeOpenAi(input: ProviderConfig, speech: TtsSpeechReq, signal: AbortSignal): Promise<AudioResult> {
  const base = input.baseUrl ?? providerCatalog(input.provider)?.defaultBaseUrl
  if (!base || !input.model || !input.secrets.apiKey) throw new Error('OpenAI TTS configuration is incomplete')
  const body: Record<string, unknown> = {
    model: input.model,
    input: speech.text,
    voice: speech.voice ?? input.defaultVoice ?? 'alloy',
    response_format: 'mp3',
  }
  if (speech.rate !== undefined) body.speed = speech.rate
  if (typeof input.options.instructions === 'string' && input.options.instructions.trim()) body.instructions = input.options.instructions.trim()
  const response = await fetchUpstream(joinUrl(base, '/audio/speech'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${input.secrets.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, signal)
  return readAudio(response, 'audio/mpeg')
}

async function synthesizeAzure(input: ProviderConfig, speech: TtsSpeechReq, signal: AbortSignal): Promise<AudioResult> {
  const region = String(input.options.region ?? '').trim()
  if (!region || !input.secrets.apiKey) throw new Error('Azure TTS configuration is incomplete')
  const url = input.baseUrl ?? `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`
  const voice = speech.voice ?? input.defaultVoice ?? 'zh-CN-XiaoxiaoNeural'
  const body = `<speak version="1.0" xml:lang="zh-CN"><voice name="${xmlEscape(voice)}"><prosody rate="${ratePercent(speech.rate ?? 1)}">${xmlEscape(speech.text)}</prosody></voice></speak>`
  const response = await fetchUpstream(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': input.secrets.apiKey,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'Bookdock',
    },
    body,
  }, signal)
  return readAudio(response, 'audio/mpeg')
}

function percentEncode(value: string) {
  return encodeURIComponent(value).replace(/!/g, '%21').replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\*/g, '%2A').replace(/%7E/g, '~')
}

async function aliyunToken(accessKeyId: string, accessKeySecret: string, signal: AbortSignal) {
  const now = new Date()
  const two = (value: number) => String(value).padStart(2, '0')
  const timestamp = `${now.getUTCFullYear()}-${two(now.getUTCMonth() + 1)}-${two(now.getUTCDate())}T${two(now.getUTCHours())}:${two(now.getUTCMinutes())}:${two(now.getUTCSeconds())}Z`
  const params: Record<string, string> = {
    AccessKeyId: accessKeyId,
    Action: 'CreateToken',
    Format: 'JSON',
    RegionId: 'cn-shanghai',
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: crypto.randomUUID(),
    SignatureVersion: '1.0',
    Timestamp: timestamp,
    Version: '2019-02-28',
  }
  const query = Object.keys(params).sort().map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`).join('&')
  const stringToSign = `GET&%2F&${percentEncode(query)}`
  const signature = crypto.createHmac('sha1', `${accessKeySecret}&`).update(stringToSign).digest('base64')
  const url = `https://nls-meta.cn-shanghai.aliyuncs.com/?Signature=${percentEncode(signature)}&${query}`
  const response = await fetchUpstream(url, { headers: { Accept: 'application/json' } }, signal)
  if (!response.ok) throw new Error(`Aliyun token returned HTTP ${response.status}`)
  const body = await response.json() as { Token?: { Id?: string } }
  if (!body.Token?.Id) throw new Error('Aliyun token response is invalid')
  return body.Token.Id
}

async function synthesizeAliyun(input: ProviderConfig, speech: TtsSpeechReq, signal: AbortSignal): Promise<AudioResult> {
  const appKey = input.secrets.appKey
  const accessKeyId = input.secrets.accessKeyId
  const accessKeySecret = input.secrets.accessKeySecret
  if (!appKey || !accessKeyId || !accessKeySecret) throw new Error('Aliyun TTS configuration is incomplete')
  const token = await aliyunToken(accessKeyId, accessKeySecret, signal)
  const response = await fetchUpstream(input.baseUrl ?? 'https://nls-gateway.aliyuncs.com/stream/v1/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appkey: appKey, token, text: speech.text, format: 'mp3', sample_rate: 16000, voice: speech.voice ?? input.defaultVoice ?? 'xiaoyun', speech_rate: Math.max(-500, Math.min(500, Math.round(((speech.rate ?? 1) - 1) * 500))), pitch_rate: 0 }),
  }, signal)
  return readAudio(response, 'audio/mpeg')
}

async function synthesizeDashscope(input: ProviderConfig, speech: TtsSpeechReq, signal: AbortSignal): Promise<AudioResult> {
  if (!input.model || !input.secrets.apiKey) throw new Error('DashScope TTS configuration is incomplete')
  const base = input.baseUrl ?? 'https://dashscope.aliyuncs.com'
  const response = await fetchUpstream(joinUrl(base, '/api/v1/services/aigc/multimodal-generation/generation'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${input.secrets.apiKey}`, 'Content-Type': 'application/json', 'X-DashScope-SSE': 'enable' },
    body: JSON.stringify({ model: input.model, input: { text: speech.text, voice: speech.voice ?? input.defaultVoice ?? 'Cherry' } }),
  }, signal)
  if (!response.ok) throw new Error(`DashScope returned HTTP ${response.status}`)
  const raw = await response.text()
  const chunks: Buffer[] = []
  for (const line of raw.split(/\r?\n/)) {
    const json = line.startsWith('data:') ? line.slice(5).trim() : line.trim()
    if (!json || json === '[DONE]') continue
    try {
      const event = JSON.parse(json) as { output?: { audio?: { data?: string } } }
      if (event.output?.audio?.data) chunks.push(Buffer.from(event.output.audio.data, 'base64'))
    } catch {
      // Ignore keep-alive and non-JSON SSE lines.
    }
  }
  const pcm = Buffer.concat(chunks)
  if (!pcm.length) throw new Error('DashScope returned no audio')
  return { audio: pcmToWav(pcm, 24000), contentType: 'audio/wav' }
}

function parseMiniMaxAudio(body: unknown) {
  if (!body || typeof body !== 'object') return null
  const root = body as Record<string, unknown>
  const data = root.data as Record<string, unknown> | undefined
  const value = typeof data?.audio === 'string' ? data.audio : typeof root.audio === 'string' ? root.audio : null
  if (!value) return null
  return /^[0-9a-f]+$/i.test(value) && value.length % 2 === 0 ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64')
}

async function synthesizeMinimax(input: ProviderConfig, speech: TtsSpeechReq, signal: AbortSignal): Promise<AudioResult> {
  if (!input.model || !input.secrets.apiKey) throw new Error('MiniMax TTS configuration is incomplete')
  const response = await fetchUpstream(joinUrl(input.baseUrl ?? 'https://api.minimaxi.com', '/v1/t2a_v2'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${input.secrets.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: input.model, text: speech.text, stream: false, voice_setting: { voice_id: speech.voice ?? input.defaultVoice ?? 'Chinese (Mandarin)_Male_Announcer', speed: Math.max(0.5, Math.min(2, speech.rate ?? 1)), vol: 1, pitch: 0 }, audio_setting: { sample_rate: 32000, format: 'mp3' } }),
  }, signal)
  if (!response.ok) throw new Error(`MiniMax returned HTTP ${response.status}`)
  const audio = parseMiniMaxAudio(await response.json())
  if (!audio?.length) throw new Error('MiniMax returned no audio')
  return { audio, contentType: 'audio/mpeg' }
}

async function synthesizeMimo(input: ProviderConfig, speech: TtsSpeechReq, signal: AbortSignal): Promise<AudioResult> {
  if (!input.model || !input.secrets.apiKey) throw new Error('MiMo TTS configuration is incomplete')
  const response = await fetchUpstream(joinUrl(input.baseUrl ?? 'https://api.xiaomimimo.com/v1', '/chat/completions'), {
    method: 'POST',
    headers: { 'api-key': input.secrets.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: input.model, messages: [{ role: 'assistant', content: speech.text }], audio: { format: 'wav', voice: speech.voice ?? input.defaultVoice ?? '冰糖' } }),
  }, signal)
  if (!response.ok) throw new Error(`MiMo returned HTTP ${response.status}`)
  const body = await response.json() as { choices?: Array<{ message?: { audio?: { data?: string } } }>; error?: { message?: string } }
  if (body.error?.message) throw new Error(body.error.message)
  const encoded = body.choices?.[0]?.message?.audio?.data
  if (!encoded) throw new Error('MiMo returned no audio')
  return { audio: Buffer.from(encoded, 'base64'), contentType: 'audio/wav' }
}

async function synthesizeVolcengine(input: ProviderConfig, speech: TtsSpeechReq, signal: AbortSignal): Promise<AudioResult> {
  if (!input.secrets.apiKey) throw new Error('Volcengine TTS configuration is incomplete')
  const response = await fetchUpstream(input.baseUrl ?? 'https://openspeech.bytedance.com/api/v3/tts/unidirectional', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': input.secrets.apiKey, 'X-Api-Resource-Id': String(input.options.resourceId ?? 'seed-tts-2.0'), 'X-Api-Request-Id': crypto.randomUUID() },
    body: JSON.stringify({ req_params: { text: speech.text, speaker: speech.voice ?? input.defaultVoice ?? 'zh_male_ruyaqingnian_uranus_bigtts', audio_params: { format: 'pcm', sample_rate: 24000, speech_rate: Math.round((speech.rate ?? 1) * 100) } } }),
  }, signal)
  if (!response.ok) throw new Error(`Volcengine returned HTTP ${response.status}`)
  const raw = await response.text()
  const chunks: Buffer[] = []
  let completed = false
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue
    const event = JSON.parse(line) as { code?: number; data?: string; message?: string }
    if (event.code === 20000000) { completed = true; break }
    if (event.code !== 0) throw new Error(event.message || `Volcengine error ${event.code ?? 'unknown'}`)
    if (event.data) chunks.push(Buffer.from(event.data, 'base64'))
  }
  const pcm = Buffer.concat(chunks)
  if (!completed || !pcm.length) throw new Error('Volcengine returned no audio')
  return { audio: pcmToWav(pcm, 24000), contentType: 'audio/wav' }
}

async function synthesizeProvider(input: ProviderConfig, speech: TtsSpeechReq, signal: AbortSignal): Promise<AudioResult> {
  switch (input.provider) {
    case 'openai': return synthesizeOpenAi(input, speech, signal)
    case 'openai-compatible': return synthesizeOpenAi(input, speech, signal)
    case 'azure': return synthesizeAzure(input, speech, signal)
    case 'aliyun': return synthesizeAliyun(input, speech, signal)
    case 'dashscope': return synthesizeDashscope(input, speech, signal)
    case 'minimax': return synthesizeMinimax(input, speech, signal)
    case 'mimo': return synthesizeMimo(input, speech, signal)
    case 'volcengine': return synthesizeVolcengine(input, speech, signal)
  }
}

export async function synthesizeSpeech(userId: string, role: string, input: TtsSpeechReq, signal: AbortSignal) {
  if (role === 'guest') throw new AppError('TTS_NOT_ALLOWED', 'Guest users cannot use AI TTS')
  const row = getServiceRow(userId, input.serviceId)
  const service = serviceConfig(row)
  assertConfigured(service.provider, service)
  try {
    return await synthesizeProvider(service, input, signal)
  } catch (error) {
    if (signal.aborted) throw new AppError('TTS_PROVIDER_ERROR', 'TTS request was cancelled')
    throw new AppError('TTS_PROVIDER_ERROR', error instanceof Error ? error.message : 'TTS provider request failed')
  }
}

async function listAzureVoices(service: ProviderConfig, signal: AbortSignal): Promise<TtsVoiceRes[]> {
  const region = String(service.options.region ?? '').trim()
  if (!region || !service.secrets.apiKey) return []
  const url = service.baseUrl?.replace(/\/cognitiveservices\/v1$/i, '/cognitiveservices/voices/list') ?? `https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`
  const response = await fetchUpstream(url, { headers: { 'Ocp-Apim-Subscription-Key': service.secrets.apiKey } }, signal)
  if (!response.ok) throw new Error(`Azure voices returned HTTP ${response.status}`)
  const body = await response.json() as Array<{ ShortName?: string; LocalName?: string; Name?: string; Locale?: string; Gender?: string }>
  return body.filter((voice) => voice.ShortName).map((voice) => ({ id: voice.ShortName!, name: voice.LocalName ?? voice.Name ?? voice.ShortName!, lang: voice.Locale ?? '', gender: voice.Gender }))
}

async function listMinimaxVoices(service: ProviderConfig, signal: AbortSignal): Promise<TtsVoiceRes[]> {
  if (!service.secrets.apiKey) return []
  const response = await fetchUpstream(joinUrl(service.baseUrl ?? 'https://api.minimaxi.com', '/v1/get_voice'), { method: 'POST', headers: { Authorization: `Bearer ${service.secrets.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ voice_type: 'all' }) }, signal)
  if (!response.ok) throw new Error(`MiniMax voices returned HTTP ${response.status}`)
  const body = await response.json() as { system_voice?: Array<{ voice_id?: string; voice_name?: string }> }
  return (body.system_voice ?? []).filter((voice) => voice.voice_id).map((voice) => ({ id: voice.voice_id!, name: voice.voice_name ?? voice.voice_id!, lang: '' }))
}

export async function listTtsVoices(userId: string, role: string, serviceId: string, signal: AbortSignal): Promise<TtsVoiceRes[]> {
  if (role === 'guest') throw new AppError('TTS_NOT_ALLOWED', 'Guest users cannot use AI TTS')
  const service = serviceConfig(getServiceRow(userId, serviceId))
  try {
    if (service.provider === 'azure') return await listAzureVoices(service, signal)
    if (service.provider === 'minimax') return await listMinimaxVoices(service, signal)
  } catch (error) {
    throw new AppError('TTS_PROVIDER_ERROR', error instanceof Error ? error.message : 'Could not load TTS voices')
  }
  if (service.provider === 'aliyun') return ALIYUN_VOICES
  if (service.provider === 'dashscope') return DASHSCOPE_VOICES
  if (service.provider === 'mimo') return MIMO_VOICES
  if (service.provider === 'volcengine') return VOLCENGINE_VOICES
  return OPENAI_VOICES
}

export async function testTtsService(userId: string, role: string, serviceId: string, signal: AbortSignal) {
  await synthesizeSpeech(userId, role, { serviceId, text: '这是一段测试语音。', rate: 1 }, signal)
  return { ok: true as const }
}

export async function testTtsServiceDraft(role: string, input: TtsServiceCreateReq, signal: AbortSignal) {
  if (role === 'guest') throw new AppError('TTS_NOT_ALLOWED', 'Guest users cannot use AI TTS')
  const provider = validateProvider(input.provider)
  const service: ProviderConfig = {
    provider,
    baseUrl: input.baseUrl ?? providerCatalog(provider)?.defaultBaseUrl ?? null,
    model: input.model ?? providerCatalog(provider)?.defaultModel ?? null,
    defaultVoice: input.defaultVoice?.trim() || null,
    options: input.options ?? {},
    secrets: Object.fromEntries(Object.entries(input.secrets ?? {}).map(([key, value]) => [key, value.trim()])),
  }
  assertConfigured(service.provider, service)
  try {
    await synthesizeProvider(service, { serviceId: 'draft', text: '这是一段测试语音。', voice: service.defaultVoice ?? undefined, rate: 1 }, signal)
  } catch (error) {
    if (signal.aborted) throw new AppError('TTS_PROVIDER_ERROR', 'TTS request was cancelled')
    throw new AppError('TTS_PROVIDER_ERROR', error instanceof Error ? error.message : 'TTS provider request failed')
  }
  return { ok: true as const }
}
