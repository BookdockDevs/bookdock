export interface AiPromptVariables {
  selectedText: string
  selectedParagraph: string
  chapterText: string
}

export function expandAiPrompt(template: string, variables: AiPromptVariables): string {
  return template
    .replaceAll('{SELTEXT}', variables.selectedText)
    .replaceAll('{SELPARA}', variables.selectedParagraph)
    .replaceAll('{CHAPTER}', variables.chapterText)
}
