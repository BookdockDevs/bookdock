import { z } from 'zod'

export const TRANSLATION_MAX_CHARS = 20_000
export const TRANSLATION_LANGUAGES = [
  { id: 'zh-Hans', label: '简体中文' }, { id: 'zh-Hant', label: '繁體中文' },
  { id: 'en', label: 'English' }, { id: 'ja', label: '日本語' }, { id: 'ko', label: '한국어' },
  { id: 'fr', label: 'Français' }, { id: 'de', label: 'Deutsch' }, { id: 'es', label: 'Español' },
  { id: 'ru', label: 'Русский' }, { id: 'pt', label: 'Português' },
] as const
export const translationLanguageSchema = z.enum(['zh-Hans', 'zh-Hant', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'ru', 'pt'])
/**
 * `modelId` is the internal AI model id, not an upstream model name, so the
 * remembered choice survives credential and discovery changes. Null follows
 * the account default.
 */
export const translationChannelSchema = z.object({
  kind: z.literal('ai'),
  modelId: z.string().min(1).max(200).nullable().default(null),
}).strict()
export const translationPreferencesSchema = z.object({
  targetLang: translationLanguageSchema.default('zh-Hans'),
  channel: translationChannelSchema.default({ kind: 'ai', modelId: null }),
}).strict()
export const selectedTextTranslationRequestSchema = translationPreferencesSchema.extend({
  text: z.string().trim().min(1).max(TRANSLATION_MAX_CHARS),
}).strict()
export const translationRequestSchema = selectedTextTranslationRequestSchema.extend({
  bookId: z.string().min(1).max(100),
}).strict()
export type TranslationChannel = z.infer<typeof translationChannelSchema>
export type TranslationPreferences = z.infer<typeof translationPreferencesSchema>
export type TranslationRequest = z.infer<typeof translationRequestSchema>
export type SelectedTextTranslationRequest = z.infer<typeof selectedTextTranslationRequestSchema>
export type TranslationEvent =
  | { type: 'delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; code: string; message: string }
