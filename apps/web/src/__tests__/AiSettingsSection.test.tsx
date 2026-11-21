import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import type { AiConfigRes, AiConnectionRes, AiModelEntryRes, AiPromptTemplate } from '@bookdock/shared'

import { useAuthStore } from '@/stores/auth.store'
import i18n from '../i18n/i18n'
import AiSettingsSection from '../features/settings/components/AiSettingsSection'

const hookMocks = vi.hoisted(() => ({
  config: vi.fn(),
  providers: vi.fn(),
  createConnection: vi.fn(),
  updateConnection: vi.fn(),
  deleteConnection: vi.fn(),
  createModel: vi.fn(),
  updateModel: vi.fn(),
  deleteModel: vi.fn(),
  refreshModels: vi.fn(),
  testModel: vi.fn(),
  updateConfig: vi.fn(),
  createPrompt: vi.fn(),
  updatePrompt: vi.fn(),
  deletePrompt: vi.fn(),
  reorderPrompts: vi.fn(),
  restorePrompts: vi.fn(),
}))

vi.mock('@/api/hooks/useAi', () => ({
  useAiConfig: hookMocks.config,
  useAiProviders: hookMocks.providers,
  useCreateAiConnection: hookMocks.createConnection,
  useUpdateAiConnection: hookMocks.updateConnection,
  useDeleteAiConnection: hookMocks.deleteConnection,
  useCreateAiModel: hookMocks.createModel,
  useUpdateAiModel: hookMocks.updateModel,
  useDeleteAiModel: hookMocks.deleteModel,
  useRefreshAiConnectionModels: hookMocks.refreshModels,
  useTestAiModel: hookMocks.testModel,
  useUpdateAiConfig: hookMocks.updateConfig,
  useCreateAiPrompt: hookMocks.createPrompt,
  useUpdateAiPrompt: hookMocks.updatePrompt,
  useDeleteAiPrompt: hookMocks.deletePrompt,
  useReorderAiPrompts: hookMocks.reorderPrompts,
  useRestoreAiPrompts: hookMocks.restorePrompts,
}))

const connection: AiConnectionRes = {
  id: 'connection-1',
  name: '本地配置',
  provider: 'openai',
  baseUrl: 'http://localhost:11434/v1',
  availability: 'user',
  mine: true,
  apiKeyConfigured: false,
  createdAt: 1,
  updatedAt: 1,
}

const sharedConnection: AiConnectionRes = {
  id: 'connection-shared',
  name: '共享云端',
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  availability: 'instance',
  mine: false,
  apiKeyConfigured: true,
  createdAt: 2,
  updatedAt: 2,
}

function modelEntry(overrides: Partial<AiModelEntryRes> = {}): AiModelEntryRes {
  return {
    id: 'model-1',
    connectionId: 'connection-1',
    connectionName: '本地配置',
    provider: 'openai',
    upstreamModelId: 'qwen3:8b',
    name: 'qwen3:8b',
    enabled: true,
    mine: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

/** Mirrors what `/ai/config` returns for a user who never edited the quick commands. */
const promptFixtures: AiPromptTemplate[] = [
  { id: 'explain-selection', name: '解释这段', prompt: '请解释 {SELTEXT}', scope: 'selection', enabled: true, order: 10, builtIn: true, availability: 'user', mine: true, createdAt: 1, updatedAt: 1 },
  { id: 'translate-selection', name: '翻译这段', prompt: '请翻译 {SELTEXT}', scope: 'selection', enabled: true, order: 20, builtIn: true, availability: 'user', mine: true, createdAt: 1, updatedAt: 1 },
  { id: 'summarize-selection', name: '概括这段', prompt: '请概括 {SELTEXT}', scope: 'selection', enabled: true, order: 30, builtIn: true, availability: 'user', mine: true, createdAt: 1, updatedAt: 1 },
  { id: 'questions-selection', name: '提出问题', prompt: '请提问 {SELTEXT}', scope: 'selection', enabled: true, order: 40, builtIn: true, availability: 'user', mine: true, createdAt: 1, updatedAt: 1 },
  { id: 'summarize-chapter', name: '总结当前章节', prompt: '请总结 {CHAPTER}', scope: 'reading', enabled: true, order: 50, builtIn: true, availability: 'user', mine: true, createdAt: 1, updatedAt: 1 },
]

/** Mirrors a command another account published to the instance. */
const sharedPromptFixture: AiPromptTemplate = {
  id: 'shared-review',
  name: '共享回顾',
  prompt: '请结合已读内容列出三个关键线索。',
  scope: 'both',
  enabled: false,
  order: 60,
  builtIn: false,
  availability: 'instance',
  mine: false,
  createdAt: 2,
  updatedAt: 2,
}

let config: AiConfigRes

function setConfig(overrides: Partial<AiConfigRes> = {}) {
  config = {
    connections: [connection],
    models: [modelEntry()],
    lastUsedModels: { chat: 'model-1', translate: null },
      prompts: promptFixtures,
    promptsRestoreAvailable: true,
    modes: [],
    lastUsedConversationSettings: { readingScope: 'to_here', enabledTools: ['get_book_toc', 'get_chapter_content', 'search_book', 'list_annotations', 'search_annotations'], assistantModeId: 'assistant' },
    ...overrides,
  }
  hookMocks.config.mockReturnValue({ data: { data: config }, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() })
}

function mutateStub() {
  return { mutate: vi.fn(), isPending: false }
}

describe('AiSettingsSection', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    vi.clearAllMocks()
    useAuthStore.setState({ user: { id: 'u1', username: 'tester', role: 'member' } })
    setConfig()
    hookMocks.providers.mockReturnValue({
      data: { data: [
        { id: 'openai', name: 'OpenAI', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: null, requiresApiKey: true },
        { id: 'deepseek', name: 'DeepSeek', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-chat', requiresApiKey: true },
      ] },
    })
    for (const hook of [
      hookMocks.createConnection, hookMocks.updateConnection, hookMocks.deleteConnection,
      hookMocks.createModel, hookMocks.updateModel, hookMocks.deleteModel,
      hookMocks.refreshModels, hookMocks.testModel, hookMocks.updateConfig,
      hookMocks.createPrompt, hookMocks.updatePrompt, hookMocks.deletePrompt,
      hookMocks.reorderPrompts, hookMocks.restorePrompts,
    ]) hook.mockReturnValue(mutateStub())
  })

  it('creates a connection from the provider menu', () => {
    const mutate = vi.fn()
    hookMocks.createConnection.mockReturnValue({ mutate, isPending: false })

    render(<AiSettingsSection />)
    fireEvent.click(screen.getByRole('button', { name: '添加 AI 供应商' }))
    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek' }))
    // The required marker lives inside the wrapping <label>, so match it loosely.
    fireEvent.change(screen.getByLabelText(/^配置名称/), { target: { value: '我的 DeepSeek' } })
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(mutate).toHaveBeenCalledWith(
      { name: '我的 DeepSeek', provider: 'deepseek', baseUrl: 'https://api.deepseek.com', apiKey: 'sk-test' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    )
  })

  it('keeps member endpoint edits read-only and never lets them publish', () => {
    const mutate = vi.fn()
    hookMocks.updateConnection.mockReturnValue({ mutate, isPending: false })

    render(<AiSettingsSection />)
    fireEvent.click(screen.getByRole('button', { name: '管理模型' }))

    expect(screen.getByLabelText('接口地址')).toHaveAttribute('readonly')
    expect(screen.getByText('使用供应商默认地址，自定义地址需由实例所有者配置')).toBeInTheDocument()
    // The availability control is owner-only and hidden from members entirely.
    expect(screen.queryByText('可用范围')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '共享' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/^配置名称/), { target: { value: '改名' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(mutate).toHaveBeenCalledWith(
      { id: 'connection-1', body: { name: '改名', provider: 'openai', baseUrl: 'http://localhost:11434/v1', availability: 'user' } },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    )
  })

  it('lets the instance owner publish a connection to every user', () => {
    useAuthStore.setState({ user: { id: 'u1', username: 'tester', role: 'owner' } })
    const mutate = vi.fn()
    hookMocks.updateConnection.mockReturnValue({ mutate, isPending: false })

    render(<AiSettingsSection />)
    fireEvent.click(screen.getByRole('button', { name: '管理模型' }))
    expect(screen.getByLabelText('接口地址')).not.toHaveAttribute('readonly')
    fireEvent.click(screen.getByRole('button', { name: '共享' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(mutate).toHaveBeenCalledWith(
      { id: 'connection-1', body: expect.objectContaining({ availability: 'instance' }) },
      expect.any(Object),
    )
  })

  it('hides edit and delete actions for a shared connection but keeps its models usable', () => {
    setConfig({ connections: [sharedConnection], models: [modelEntry({ id: 'shared-model', connectionId: 'connection-shared', connectionName: '共享云端', provider: 'deepseek', mine: false })], lastUsedModels: { chat: null, translate: null } })

    render(<AiSettingsSection />)
    expect(screen.getByText('共享')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '编辑 AI 供应商' })).toBeNull()
    expect(screen.queryByRole('button', { name: '删除配置' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '管理模型' }))
    expect(screen.queryByRole('button', { name: /允许使用/ })).toBeNull()
    expect(screen.queryByRole('switch', { name: /允许使用/ })).toBeNull()
    expect(screen.queryByRole('button', { name: '手动添加模型' })).toBeNull()
  })

  it('confirms connection deletion before persisting', async () => {
    const mutateAsync = vi.fn(async () => undefined)
    hookMocks.deleteConnection.mockReturnValue({ mutateAsync, isPending: false })

    render(<AiSettingsSection />)
    fireEvent.click(screen.getByRole('button', { name: '删除配置' }))
    expect(mutateAsync).not.toHaveBeenCalled()
    expect(screen.getByText('确定要删除供应商“本地配置”吗？')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith('connection-1'))
    // The confirm stays up until the deletion settles, then closes itself.
    await waitFor(() => expect(screen.queryByText('确定要删除供应商“本地配置”吗？')).not.toBeInTheDocument())
  })

  it('keeps the delete confirm open with an inline error when deletion fails', async () => {
    const mutateAsync = vi.fn(async () => { throw new Error('boom') })
    hookMocks.deleteConnection.mockReturnValue({ mutateAsync, isPending: false })

    render(<AiSettingsSection />)
    fireEvent.click(screen.getByRole('button', { name: '删除配置' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByText('确定要删除供应商“本地配置”吗？')).toBeInTheDocument()
    expect(mutateAsync).toHaveBeenCalledTimes(1)
  })

  it('blocks the prompt-form close entries and reports saving while submission is pending', () => {
    hookMocks.createPrompt.mockReturnValue({ mutateAsync: vi.fn(async () => undefined), isPending: false })
    render(<AiSettingsSection />)
    fireEvent.click(screen.getByRole('button', { name: '新建快捷指令' }))

    // Pending arrives through a re-render, like a real mutation would.
    hookMocks.createPrompt.mockReturnValue({ mutateAsync: vi.fn(async () => undefined), isPending: true })
    fireEvent.change(screen.getByLabelText('指令名称'), { target: { value: 'x' } })

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByLabelText('指令名称')).toBeInTheDocument()
    expect(screen.getByText('保存中…')).toBeInTheDocument()
    expect(screen.getByText('取消')).toBeDisabled()
  })

  it('toggles model exposure, tests a model and removes entries from the dialog', () => {
    const updateModel = vi.fn()
    const testModel = vi.fn()
    const deleteModel = vi.fn()
    hookMocks.updateModel.mockReturnValue({ mutate: updateModel, isPending: false })
    hookMocks.testModel.mockReturnValue({ mutate: testModel, isPending: false })
    hookMocks.deleteModel.mockReturnValue({ mutate: deleteModel, isPending: false })
    setConfig({ models: [modelEntry(), modelEntry({ id: 'model-embed', upstreamModelId: 'text-embedding-3-small', name: 'text-embedding-3-small', createdAt: 2 })] })

    render(<AiSettingsSection />)
    fireEvent.click(screen.getByRole('button', { name: '管理模型' }))

    // Exposure flips are drafts: nothing is sent until 保存 commits them.
    fireEvent.click(screen.getByRole('switch', { name: '允许使用 qwen3:8b' }))
    expect(updateModel).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(updateModel).toHaveBeenCalledWith({ id: 'model-1', body: { enabled: false } }, expect.any(Object))

    fireEvent.click(screen.getByRole('button', { name: '测试可用性 qwen3:8b' }))
    expect(testModel).toHaveBeenCalledWith('model-1', expect.any(Object))

    // Embedding entries cannot be chat-tested.
    expect(screen.queryByRole('button', { name: '测试可用性 text-embedding-3-small' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '移除模型 qwen3:8b' }))
    expect(deleteModel).toHaveBeenCalledWith('model-1', expect.any(Object))
  })

  it('adds a manual model and refreshes provider models on demand', () => {
    const createModel = vi.fn()
    const refreshModels = vi.fn()
    hookMocks.createModel.mockReturnValue({ mutate: createModel, isPending: false })
    hookMocks.refreshModels.mockReturnValue({ mutate: refreshModels, isPending: false })

    render(<AiSettingsSection />)
    fireEvent.click(screen.getByRole('button', { name: '管理模型' }))

    fireEvent.click(screen.getByRole('button', { name: '拉取模型' }))
    expect(refreshModels).toHaveBeenCalledWith({ connectionId: 'connection-1' }, expect.objectContaining({ onSuccess: expect.any(Function) }))

    fireEvent.click(screen.getByRole('button', { name: '手动添加模型' }))
    fireEvent.change(screen.getByPlaceholderText('输入模型 ID 后添加'), { target: { value: 'gpt-4o-mini' } })
    const addDialog = screen.getByRole('dialog', { name: '手动添加模型' })
    fireEvent.click(within(addDialog).getByRole('button', { name: '保存' }))
    expect(createModel).toHaveBeenCalledWith(
      { connectionId: 'connection-1', body: { upstreamModelId: 'gpt-4o-mini' } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
  })

  it('explains an empty state instead of rendering an empty list', () => {
    setConfig({ connections: [], models: [], lastUsedModels: { chat: null, translate: null } })
    render(<AiSettingsSection />)
    expect(screen.getByText('暂无 AI 供应商')).toBeInTheDocument()
  })

  it('shows guests a hint instead of configuration controls', () => {
    useAuthStore.setState({ user: null })

    render(<AiSettingsSection />)

    expect(screen.getByText('登录后可配置 AI 供应商。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '编辑 AI 供应商' })).toBeNull()
  })

  it('saves a new quick command through its own endpoint', () => {
    useAuthStore.setState({ user: { id: 'u1', username: 'tester', role: 'member' } })
    const mutate = vi.fn()
    hookMocks.createPrompt.mockReturnValue({ mutate, isPending: false })

    render(<AiSettingsSection />)
    expect(screen.getByText('快捷指令')).toBeInTheDocument()
    expect(screen.getByText('· 5')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存快捷指令' })).toBeNull()
    expect(screen.queryAllByRole('button', { name: '调整快捷指令顺序' })).toHaveLength(0)
    expect(screen.queryAllByRole('button', { name: '删除快捷指令' })).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '新建快捷指令' }))
    fireEvent.change(screen.getByLabelText('指令名称'), { target: { value: '线索提取' } })
    fireEvent.change(screen.getByLabelText('提示词模板'), { target: { value: '请列出当前内容中的关键线索。' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(mutate).toHaveBeenCalledWith(
      { name: '线索提取', prompt: '请列出当前内容中的关键线索。', availability: 'user' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    )
  })

  it('shows inline validation for an empty quick command', () => {
    useAuthStore.setState({ user: { id: 'u1', username: 'tester', role: 'member' } })
    const mutate = vi.fn()
    hookMocks.createPrompt.mockReturnValue({ mutate, isPending: false })

    render(<AiSettingsSection />)
    fireEvent.click(screen.getByRole('button', { name: '新建快捷指令' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(screen.getByText('指令名称不能为空')).toBeInTheDocument()
    expect(screen.getByText('提示词模板不能为空')).toBeInTheDocument()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('hides the availability control from members in the quick-command form', () => {
    useAuthStore.setState({ user: { id: 'u1', username: 'tester', role: 'member' } })
    const mutate = vi.fn()
    hookMocks.createPrompt.mockReturnValue({ mutate, isPending: false })

    render(<AiSettingsSection />)
    fireEvent.click(screen.getByRole('button', { name: '新建快捷指令' }))

    expect(screen.queryByText('可用范围')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '共享' })).not.toBeInTheDocument()
  })

  it('lets the instance owner publish a custom quick command to every user', () => {
    useAuthStore.setState({ user: { id: 'u1', username: 'tester', role: 'owner' } })
    const mutate = vi.fn()
    hookMocks.createPrompt.mockReturnValue({ mutate, isPending: false })

    render(<AiSettingsSection />)
    fireEvent.click(screen.getByRole('button', { name: '新建快捷指令' }))
    fireEvent.change(screen.getByLabelText('指令名称'), { target: { value: '全站共读' } })
    fireEvent.change(screen.getByLabelText('提示词模板'), { target: { value: '请总结全书主线。' } })
    fireEvent.click(screen.getByRole('button', { name: '共享' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(mutate).toHaveBeenCalledWith(
      { name: '全站共读', prompt: '请总结全书主线。', availability: 'instance' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    )
  })

  it('hides the availability control when editing a built-in command', () => {
    const mutate = vi.fn()
    hookMocks.updatePrompt.mockReturnValue({ mutate, isPending: false })

    render(<AiSettingsSection />)
    fireEvent.click(screen.getByRole('button', { name: '进入编辑模式' }))
    const row = screen.getByText('解释这段').closest('li')!
    fireEvent.click(within(row).getByRole('button', { name: '编辑 AI 供应商' }))

    expect(screen.queryByText('可用范围')).toBeNull()
    fireEvent.change(screen.getByLabelText('指令名称'), { target: { value: '解释这段（改）' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(mutate).toHaveBeenCalledWith(
      { id: 'explain-selection', body: expect.objectContaining({ name: '解释这段（改）' }) },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    )
  })

  it('keeps a shared quick command read-only for its consumer', () => {
    setConfig({ prompts: [...promptFixtures, sharedPromptFixture] })
    const updateMutate = vi.fn()
    hookMocks.updatePrompt.mockReturnValue({ mutate: updateMutate, isPending: false })

    render(<AiSettingsSection />)
    expect(screen.getByText('共享')).toBeInTheDocument()

    // Consumers flip only their own switch.
    fireEvent.click(screen.getByRole('switch', { name: '共享回顾' }))
    expect(updateMutate).toHaveBeenCalledWith({ id: 'shared-review', body: { enabled: true } }, expect.objectContaining({ onError: expect.any(Function) }))
  })

  it('offers no edit or delete for a shared quick command in sorting mode', () => {
    setConfig({ prompts: [...promptFixtures, sharedPromptFixture] })

    render(<AiSettingsSection />)
    fireEvent.click(screen.getByRole('button', { name: '进入编辑模式' }))

    // Five own rows expose edit/delete; the shared row exposes neither.
    expect(screen.getAllByRole('button', { name: '删除快捷指令' })).toHaveLength(5)
    const sharedRow = screen.getByText('共享回顾').closest('li')!
    expect(within(sharedRow).queryByRole('button', { name: '编辑 AI 供应商' })).toBeNull()
    expect(within(sharedRow).queryByRole('button', { name: '删除快捷指令' })).toBeNull()
  })

  it('confirms quick command deletion before persisting', async () => {
    const mutateAsync = vi.fn(async () => undefined)
    hookMocks.deletePrompt.mockReturnValue({ mutateAsync, isPending: false })

    render(<AiSettingsSection />)
    fireEvent.click(screen.getByRole('button', { name: '进入编辑模式' }))
    fireEvent.click(screen.getAllByRole('button', { name: '删除快捷指令' })[0]!)

    expect(screen.getByText('确定要删除快捷指令“解释这段”吗？')).toBeInTheDocument()
    expect(mutateAsync).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith('explain-selection'))
    // The confirm closes only after the deletion has actually settled.
    await waitFor(() => expect(screen.queryByText('确定要删除快捷指令“解释这段”吗？')).not.toBeInTheDocument())
  })

  it('restores missing built-in commands directly without a confirmation', () => {
    const mutate = vi.fn()
    hookMocks.restorePrompts.mockReturnValue({ mutate, isPending: false })

    render(<AiSettingsSection />)
    expect(screen.queryByRole('button', { name: '恢复内置指令' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '进入编辑模式' }))
    expect(screen.queryByRole('button', { name: '新建快捷指令' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '恢复内置指令' }))

    expect(mutate).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    )
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('hides restore while every built-in command is present', () => {
    setConfig({ promptsRestoreAvailable: false })
    render(<AiSettingsSection />)
    fireEvent.click(screen.getByRole('button', { name: '进入编辑模式' }))
    expect(screen.queryByRole('button', { name: '恢复内置指令' })).not.toBeInTheDocument()
  })

  it('skips the reorder request when sorting did not change the order', () => {
    const mutate = vi.fn()
    hookMocks.reorderPrompts.mockReturnValue({ mutate, isPending: false })

    render(<AiSettingsSection />)
    fireEvent.click(screen.getByRole('button', { name: '进入编辑模式' }))
    fireEvent.click(screen.getByRole('button', { name: '退出编辑模式' }))

    expect(mutate).not.toHaveBeenCalled()
    expect(screen.queryAllByRole('button', { name: '调整快捷指令顺序' })).toHaveLength(0)
  })

  it('explains quick-command variables and inserts them at the prompt cursor', () => {
    useAuthStore.setState({ user: { id: 'u1', username: 'tester', role: 'member' } })

    render(<AiSettingsSection />)
    fireEvent.click(screen.getByRole('button', { name: '新建快捷指令' }))

    expect(screen.queryByPlaceholderText('输入指令名称')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('输入提示词模板，使用上方变量插入阅读内容…')).toBeInTheDocument()
    expect(screen.queryByText('点击变量可将其插入到提示词模板的光标位置')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '查看变量说明' }))
    expect(screen.getByRole('dialog', { name: '变量说明' })).toHaveTextContent('用户当前选中的文本内容；没有选区时为空。')
    expect(screen.getByRole('dialog', { name: '变量说明' })).toHaveTextContent('选中文本所在的完整段落；没有选区时使用当前阅读段落。')
    expect(screen.getByRole('dialog', { name: '变量说明' })).toHaveTextContent('当前正在阅读章节的完整正文；展开时受上下文长度限制。')

    const textarea = screen.getByLabelText('提示词模板')
    fireEvent.change(textarea, { target: { value: '请解释' } })
    textarea.setSelectionRange(1, 1)
    fireEvent.click(screen.getByRole('button', { name: '插入变量 {SELTEXT}' }))
    expect(textarea).toHaveValue('请{SELTEXT}解释')
  })
})
