import type { AiProvider, AiProviderRes } from '@bookdock/shared'

import { AppError } from '../../middleware/error'

export const AI_PROVIDERS: readonly AiProviderRes[] = [
  { id: 'openai', name: 'OpenAI', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: null, requiresApiKey: true },
  { id: 'anthropic', name: 'Claude', protocol: 'anthropic', defaultBaseUrl: 'https://api.anthropic.com', defaultModel: 'claude-sonnet-5', requiresApiKey: true },
  { id: 'gemini', name: 'Gemini', protocol: 'gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com', defaultModel: 'gemini-3.8-flash', requiresApiKey: true },
  { id: 'ollama', name: 'Ollama', protocol: 'ollama', defaultBaseUrl: 'http://localhost:11434', defaultModel: 'llama3.2', requiresApiKey: false },
  { id: 'lmstudio', name: 'LM Studio', protocol: 'openai-compatible', defaultBaseUrl: 'http://localhost:1234/v1', defaultModel: null, requiresApiKey: false },
  { id: 'deepseek', name: 'DeepSeek', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-flash', requiresApiKey: true },
  { id: 'qwen', name: '通义千问', protocol: 'openai-compatible', defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-plus', requiresApiKey: true },
  { id: 'glm', name: '智谱 GLM', protocol: 'openai-compatible', defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-5.3', requiresApiKey: true },
  { id: 'moonshot', name: 'Kimi', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'kimi-k3.1-pro', requiresApiKey: true },
  { id: 'openrouter', name: 'OpenRouter', protocol: 'openai-compatible', defaultBaseUrl: 'https://openrouter.ai/api/v1', defaultModel: null, requiresApiKey: true },
  { id: 'siliconflow', name: 'SiliconFlow', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.siliconflow.cn/v1', defaultModel: null, requiresApiKey: true },
  { id: 'minimax', name: 'MiniMax', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.minimaxi.com/v1', defaultModel: 'MiniMax-M3.1-Flash', requiresApiKey: true },
  { id: 'mimo', name: 'MiMo', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.xiaomimimo.com/v1', defaultModel: 'mimo-v2.6-flash', requiresApiKey: true },
]

export const AI_PROVIDER_MAP = new Map(AI_PROVIDERS.map((provider) => [provider.id, provider]))

export function normalizeProvider(value: unknown): AiProvider {
  return typeof value === 'string' && AI_PROVIDER_MAP.has(value as AiProvider)
    ? value as AiProvider
    : 'openai'
}

export function canonicalBaseUrl(value: string) {
  return value.replace(/\/+$/, '').toLowerCase()
}

export function memberBaseUrlAllowed(provider: AiProvider, baseUrl: string | null | undefined) {
  const defaultBaseUrl = AI_PROVIDER_MAP.get(provider)?.defaultBaseUrl
  if (!defaultBaseUrl || !baseUrl) return false
  const normalized = canonicalBaseUrl(baseUrl)
  const normalizedDefault = canonicalBaseUrl(defaultBaseUrl)
  return normalized === normalizedDefault || (provider === 'deepseek' && normalized === `${normalizedDefault}/v1`)
}

/** Members may only reach the provider's own endpoint; owners may self-host. */
export function assertDraftBaseUrlAllowed(role: string, provider: AiProvider, baseUrl: string | null | undefined) {
  if (role !== 'member' || !baseUrl || memberBaseUrlAllowed(provider, baseUrl)) return
  throw new AppError('AI_NOT_ALLOWED', 'Members can only use the default provider endpoint')
}

export function requiresApiKey(provider: AiProvider, baseUrl: string | null | undefined) {
  const catalog = AI_PROVIDER_MAP.get(provider)
  if (!catalog?.requiresApiKey) return false
  if (provider !== 'openai') return true
  const normalized = baseUrl?.replace(/\/+$/, '').toLowerCase()
  return !normalized || normalized === 'https://api.openai.com/v1'
}
