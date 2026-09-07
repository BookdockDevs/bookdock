import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import type { AiPromptTemplate, AiStatusRes } from '@bookdock/shared'

import { apiGet } from '@/api/client'
import { useTranslation } from '@/hooks/useTranslation'
import { isRetiredAiPrompt, localizeAiPromptName, migrateAiPromptText } from '@/lib/ai-prompt-migrations'

export interface AiQuickCommand {
  id: string
  name: string
  prompt: string
  order?: number
}

export function useAiQuickCommands() {
  const _ = useTranslation()
  const statusQuery = useQuery({
    queryKey: ['ai-status'],
    queryFn: () => apiGet<{ data: AiStatusRes }>('/ai/status'),
  })
  const fallback = useMemo<AiQuickCommand[]>(() => [
    { id: 'explain-selection', name: _('reader.aiQuickExplain'), prompt: _('reader.aiQuickExplainPrompt'), order: 10 },
    { id: 'translate-selection', name: _('reader.aiQuickTranslate'), prompt: _('reader.aiQuickTranslatePrompt'), order: 20 },
    { id: 'summarize-selection', name: _('reader.aiQuickSummarize'), prompt: _('reader.aiQuickSummarizePrompt'), order: 30 },
    { id: 'questions-selection', name: _('reader.aiQuickQuestions'), prompt: _('reader.aiQuickQuestionsPrompt'), order: 40 },
    { id: 'summarize-chapter', name: _('reader.aiQuickChapterSummary'), prompt: _('reader.aiQuickChapterSummaryPrompt'), order: 50 },
  ], [_])
  const commands = useMemo(() => {
    const configured = statusQuery.data?.data.prompts
    const source: Array<AiPromptTemplate | AiQuickCommand> = configured ?? fallback
    const defaultPromptById = new Map(fallback.map((item) => [item.id, item.prompt]))
    const defaultNameById = new Map(fallback.map((item) => [item.id, item.name]))
    return [...source]
      .filter((item: AiPromptTemplate | AiQuickCommand) => 'enabled' in item ? item.enabled : true)
      .filter((item: AiPromptTemplate | AiQuickCommand) => !isRetiredAiPrompt(item.id))
      .sort((a: AiPromptTemplate | AiQuickCommand, b: AiPromptTemplate | AiQuickCommand) => ('order' in a ? a.order ?? 0 : 0) - ('order' in b ? b.order ?? 0 : 0) || a.id.localeCompare(b.id))
      .map(({ id, name, prompt }) => ({ id, name: localizeAiPromptName(id, name, defaultNameById.get(id)), prompt: migrateAiPromptText(id, prompt, defaultPromptById.get(id)) }))
  }, [fallback, statusQuery.data?.data.prompts])
  return { ...statusQuery, commands }
}
