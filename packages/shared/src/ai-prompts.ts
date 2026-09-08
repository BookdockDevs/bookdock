export type AiPromptVariable = 'SELTEXT' | 'SELPARA' | 'CHAPTER'

export interface AiPromptValues {
  selectedText?: string
  selectedParagraph?: string
  chapterText?: string
}

export function getAiPromptVariables(template: string): AiPromptVariable[] {
  return (['SELTEXT', 'SELPARA', 'CHAPTER'] as const).filter((variable) => template.includes(`{${variable}}`))
}

export function expandAiPrompt(template: string, values: AiPromptValues): string {
  return template.replace(/\{(SELTEXT|SELPARA|CHAPTER)\}/g, (placeholder, variable: AiPromptVariable) => {
    const value = variable === 'SELTEXT'
      ? values.selectedText
      : variable === 'SELPARA'
        ? values.selectedParagraph
        : values.chapterText
    return value?.trim() || placeholder
  })
}
