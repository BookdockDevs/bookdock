const LEGACY_DEFAULT_AI_PROMPT_TEXT: Readonly<Record<string, readonly string[]>> = {
  'explain-selection': ['请解释这段内容。', '请解释下列内容，并结合所在段落说明语境、关键概念和隐含信息。\n\n重点内容：\n{SELTEXT}\n\n所在段落：\n{SELPARA}'],
  'translate-selection': ['请翻译这段内容，并结合上下文说明关键表达。', '请翻译下列内容；结合所在段落处理指代、语气和专有名词，并保留原文含义，不要擅自补充信息。\n\n待翻译内容：\n{SELTEXT}\n\n所在段落：\n{SELPARA}'],
  'summarize-selection': ['请概括这段内容。', '请概括下列内容，提炼主要信息和关键细节；只根据提供的内容回答，不要补充未出现的事实。\n\n内容：\n{SELTEXT}\n\n所在段落：\n{SELPARA}'],
  'questions-selection': ['请围绕这段内容提出几个思考问题。', '请围绕下列内容提出 3—5 个有助于理解和思考的问题，并简要说明每个问题关注的文本线索。\n\n内容：\n{SELTEXT}\n\n所在段落：\n{SELPARA}'],
  'summarize-chapter': ['请总结当前章节，只根据我已经读到的内容回答，并列出主要情节、人物和关键线索。'],
}

const LEGACY_DEFAULT_AI_PROMPT_NAMES: Readonly<Record<string, readonly string[]>> = {
  'explain-selection': ['解释这段'],
  'translate-selection': ['翻译这段'],
  'summarize-selection': ['概括这段'],
  'questions-selection': ['提出问题'],
  'summarize-chapter': ['总结当前章节'],
}

export function isRetiredAiPrompt(id: string) {
  return id === 'review-to-here'
}

export function migrateAiPromptText(id: string, prompt: string, currentDefault: string | undefined) {
  return currentDefault && LEGACY_DEFAULT_AI_PROMPT_TEXT[id]?.includes(prompt) ? currentDefault : prompt
}

export function localizeAiPromptName(id: string, name: string, currentDefault: string | undefined) {
  return currentDefault && LEGACY_DEFAULT_AI_PROMPT_NAMES[id]?.includes(name) ? currentDefault : name
}
