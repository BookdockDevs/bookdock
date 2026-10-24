import { randomUUID } from 'node:crypto'

import type { TtsEdgeSpeechReq, TtsWordBoundary } from '@bookdock/shared'
import WebSocket from 'ws'

import { AppError } from '../../middleware/error'
import { generateEdgeSecMsGec } from './edge-sec-ms-gec'

const EDGE_API_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const EDGE_SPEECH_URL = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1'
const EDGE_CHROMIUM_VERSION = '143.0.3650.75'
const EDGE_CHROMIUM_MAJOR_VERSION = EDGE_CHROMIUM_VERSION.split('.')[0]
const EDGE_REQUEST_TIMEOUT_MS = 20_000

const DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural'

function edgeLanguage(voice: string) {
  const parts = voice.split('-')
  return parts.length >= 2 ? `${parts[0]}-${parts[1]}` : 'zh-CN'
}

function escapeXml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function edgeSsml(text: string, voice: string, rate: number) {
  const relativeRate = `${rate >= 1 ? '+' : ''}${Math.round((rate - 1) * 100)}%`
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${edgeLanguage(voice)}"><voice name="${voice}"><prosody rate="${relativeRate}" pitch="0Hz">${escapeXml(text)}</prosody></voice></speak>`
}

function edgeFrame(headers: Record<string, string>, body: string) {
  const headerText = Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')
  return `${headerText}\r\n\r\n${body}`
}

function edgeHeaders(message: string) {
  const separator = message.search(/\r?\n\r?\n/)
  const headerPart = separator >= 0 ? message.slice(0, separator) : message
  const headers: Record<string, string> = {}
  for (const line of headerPart.split(/\r?\n/)) {
    const index = line.indexOf(':')
    if (index > 0) headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim()
  }
  return headers
}

export function parseEdgeTextFrame(message: string) {
  const separator = message.search(/\r?\n\r?\n/)
  const headerEnd = separator >= 0 ? separator : message.length
  return { path: edgeHeaders(message).path, body: separator >= 0 ? message.slice(headerEnd).replace(/^\r?\n\r?\n/, '') : '' }
}

export function parseEdgeBinaryFrame(data: Buffer) {
  if (data.length < 2) return null
  const headerLength = data.readUInt16BE(0)
  const bodyStart = headerLength + 2
  if (bodyStart > data.length) throw new Error('Edge TTS returned an invalid audio frame')
  const path = edgeHeaders(data.subarray(2, bodyStart).toString('utf8')).path
  return { path, body: data.subarray(bodyStart) }
}

export function parseEdgeWordBoundaries(body: string): TtsWordBoundary[] {
  try {
    const metadata = JSON.parse(body) as { Metadata?: Array<{ Type?: unknown; Data?: { Offset?: unknown; Duration?: unknown; text?: { Text?: unknown } } }> }
    return (metadata.Metadata ?? []).flatMap((item) => {
      const { Offset: offset, Duration: duration, text } = item.Data ?? {}
      if (item.Type !== 'WordBoundary' || typeof offset !== 'number' || !Number.isFinite(offset) || offset < 0 || typeof text?.Text !== 'string' || !text.Text) return []
      return [{ offset, duration: typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : 0, text: text.Text }]
    })
  } catch {
    return []
  }
}

function edgeRequest(input: TtsEdgeSpeechReq, signal: AbortSignal): Promise<{ audio: Buffer; boundaries: TtsWordBoundary[] }> {
  if (signal.aborted) return Promise.reject(new Error('Edge TTS request was cancelled'))
  const voice = input.voice || DEFAULT_VOICE
  const rate = Math.min(2, Math.max(0.5, input.rate ?? 1))
  const connectionId = randomUUID().replaceAll('-', '')
  const params = new URLSearchParams({
    ConnectionId: connectionId,
    TrustedClientToken: EDGE_API_TOKEN,
    'Sec-MS-GEC': generateEdgeSecMsGec(),
    'Sec-MS-GEC-Version': `2-${EDGE_CHROMIUM_VERSION}`,
  })
  const date = new Date().toString()
  const config = edgeFrame({
    'Content-Type': 'application/json; charset=utf-8',
    Path: 'speech.config',
    'X-Timestamp': date,
  }, JSON.stringify({
    context: {
      synthesis: {
        audio: {
          metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: true },
          outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
        },
      },
    },
  }))
  const content = edgeFrame({
    'Content-Type': 'application/ssml+xml',
    Path: 'ssml',
    'X-RequestId': connectionId,
    'X-Timestamp': date,
  }, edgeSsml(input.text, voice, rate))

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const boundaries: TtsWordBoundary[] = []
    let pendingBinary: Promise<void> = Promise.resolve()
    let turnEnded = false
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const socket = new WebSocket(`${EDGE_SPEECH_URL}?${params.toString()}`, {
      headers: {
        Accept: '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        Pragma: 'no-cache',
        Cookie: `muid=${randomUUID().replaceAll('-', '').toUpperCase()};`,
        'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${EDGE_CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${EDGE_CHROMIUM_MAJOR_VERSION}.0.0.0`,
      },
    })

    const cleanup = () => {
      signal.removeEventListener('abort', abort)
      if (timer) clearTimeout(timer)
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close()
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const finish = () => {
      if (settled) return
      settled = true
      cleanup()
      if (!chunks.length) {
        reject(new Error('Edge TTS returned no audio'))
        return
      }
      resolve({ audio: Buffer.concat(chunks), boundaries })
    }
    const finishAfterBinary = () => {
      void pendingBinary.then(finish).catch(() => fail(new Error('Edge TTS returned an invalid audio frame')))
    }
    const abort = () => {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.terminate()
      fail(new Error('Edge TTS request was cancelled'))
    }

    signal.addEventListener('abort', abort, { once: true })
    timer = setTimeout(() => fail(new Error('Edge TTS request timed out')), EDGE_REQUEST_TIMEOUT_MS)
    socket.on('open', () => {
      socket.send(config)
      socket.send(content)
    })
    socket.on('message', (data, isBinary) => {
      try {
        if (!isBinary) {
          const parsed = parseEdgeTextFrame(data.toString('utf8'))
          if (parsed.path === 'audio.metadata') boundaries.push(...parseEdgeWordBoundaries(parsed.body))
          if (parsed.path === 'turn.end') {
            turnEnded = true
            finishAfterBinary()
          }
          return
        }
        const read = async () => {
          const frame = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data)
          const parsed = parseEdgeBinaryFrame(frame)
          if (parsed?.path === 'audio' && parsed.body.length) chunks.push(parsed.body)
          else if (parsed?.path === 'audio.metadata') boundaries.push(...parseEdgeWordBoundaries(parsed.body.toString('utf8')))
        }
        pendingBinary = pendingBinary.then(read)
        void pendingBinary.catch(() => fail(new Error('Edge TTS returned an invalid audio frame')))
      } catch (error) {
        fail(error instanceof Error ? error : new Error('Edge TTS returned an invalid response'))
      }
    })
    socket.on('error', () => fail(new Error('Edge TTS connection failed')))
    socket.on('close', () => {
      if (settled) return
      if (turnEnded) finishAfterBinary()
      else fail(new Error('Edge TTS connection closed before audio completed'))
    })
  })
}

export async function synthesizeEdgeSpeech(input: TtsEdgeSpeechReq, signal: AbortSignal) {
  try {
    const result = await edgeRequest(input, signal)
    return { audio: result.audio, audioBase64: result.audio.toString('base64'), boundaries: result.boundaries }
  } catch (error) {
    if (signal.aborted) throw new AppError('TTS_PROVIDER_ERROR', 'TTS request was cancelled')
    throw new AppError('TTS_PROVIDER_ERROR', error instanceof Error ? error.message : 'Edge TTS request failed')
  }
}
