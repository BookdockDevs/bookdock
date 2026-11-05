import { z } from 'zod'

export const TRANSLATION_MAX_CHARS = 6000
export const TRANSLATION_LANGUAGES = [
  { id: 'zh-Hans', label: '简体中文' }, { id: 'zh-Hant', label: '繁體中文' },
  { id: 'en', label: 'English' }, { id: 'ja', label: '日本語' }, { id: 'ko', label: '한국어' },
  { id: 'fr', label: 'Français' }, { id: 'de', label: 'Deutsch' }, { id: 'es', label: 'Español' },
  { id: 'ru', label: 'Русский' }, { id: 'pt', label: 'Português' },
] as const
export const translationLanguageSchema = z.enum(['zh-Hans', 'zh-Hant', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'ru', 'pt'])
export const translationChannelSchema = z.object({
  kind: z.literal('ai'),
  profileId: z.string().min(1).max(100).nullable().default(null),
  model: z.string().trim().min(1).max(200).nullable().default(null),
}).strict()
export const translationPreferencesSchema = z.object({
  targetLang: translationLanguageSchema.default('zh-Hans'),
  channel: translationChannelSchema.default({ kind: 'ai', profileId: null, model: null }),
}).strict()
export const translationRequestSchema = translationPreferencesSchema.extend({
  bookId: z.string().min(1).max(100),
  text: z.string().trim().min(1).max(TRANSLATION_MAX_CHARS),
}).strict()
export type TranslationChannel = z.infer<typeof translationChannelSchema>
export type TranslationPreferences = z.infer<typeof translationPreferencesSchema>
export type TranslationRequest = z.infer<typeof translationRequestSchema>
export type TranslationEvent =
  | { type: 'delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; code: string; message: string }
