import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

import { useActivateAiProfile, useAiConfig, useAiProviders, useCreateAiProfile, useDeleteAiProfile, useFetchAiModels, useTestAiConfigDraft, useUpdateAiConfig, useUpdateAiProfile } from '@/api/hooks/useAi'
import { useAuthStore } from '@/stores/auth.store'
import i18n from '../i18n/i18n'
import AiSettingsSection from '../features/settings/components/AiSettingsSection'

vi.mock('@/api/hooks/useAi', () => ({
  useAiConfig: vi.fn(),
  useAiProviders: vi.fn(),
  useActivateAiProfile: vi.fn(),
  useCreateAiProfile: vi.fn(),
  useDeleteAiProfile: vi.fn(),
  useFetchAiModels: vi.fn(),
  useTestAiConfigDraft: vi.fn(),
  useUpdateAiConfig: vi.fn(),
  useUpdateAiProfile: vi.fn(),
}))

describe('AiSettingsSection', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    useAuthStore.setState({ user: { id: 'u1', username: 'tester', role: 'member' } })
    vi.mocked(useAiConfig).mockReturnValue({
      data: { data: {
        provider: 'openai',
        baseUrl: 'http://localhost:11434/v1',
        model: 'qwen3:8b',
        models: [{ id: 'qwen3:8b', name: 'qwen3:8b' }],
        profiles: [{ id: 'profile-1', name: '本地配置', provider: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'qwen3:8b', models: [{ id: 'qwen3:8b', name: 'qwen3:8b' }], embeddingModel: null, embeddingModels: [], apiKeyConfigured: false, createdAt: 1, updatedAt: 1 }],
        activeProfileId: 'profile-1',
        modes: [],
        embeddingProfileId: null,
        embeddingProvider: null,
        embeddingModel: null,
        embeddingModels: [],
        embeddingConfigured: false,
        apiKeyConfigured: false,
        configuredByUser: true,
      } },
      isLoading: false,
    } as ReturnType<typeof useAiConfig>)
    vi.mocked(useAiProviders).mockReturnValue({
      data: { data: [
        { id: 'openai', name: 'OpenAI', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: null, requiresApiKey: true },
        { id: 'deepseek', name: 'DeepSeek', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-chat', requiresApiKey: true },
      ] },
    } as ReturnType<typeof useAiProviders>)
    vi.mocked(useActivateAiProfile).mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<typeof useActivateAiProfile>)
    vi.mocked(useCreateAiProfile).mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<typeof useCreateAiProfile>)
    vi.mocked(useDeleteAiProfile).mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<typeof useDeleteAiProfile>)
    vi.mocked(useFetchAiModels).mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<typeof useFetchAiModels>)
    vi.mocked(useTestAiConfigDraft).mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<typeof useTestAiConfigDraft>)
    vi.mocked(useUpdateAiProfile).mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<typeof useUpdateAiProfile>)
    vi.mocked(useUpdateAiConfig).mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<typeof useUpdateAiConfig>)
  })

  it('keeps AI configuration in the reading settings flow', () => {
    useAuthStore.setState({ user: { id: 'u1', username: 'tester', role: 'owner' } })
    const mutate = vi.fn()
    vi.mocked(useUpdateAiProfile).mockReturnValue({ mutate, isPending: false } as unknown as ReturnType<typeof useUpdateAiProfile>)

    render(<AiSettingsSection />)
    fireEvent.click(screen.getAllByRole('button', { name: '编辑 AI 供应商' })[0]!)
    fireEvent.change(screen.getByLabelText('配置名称'), { target: { value: '测试配置' } })
    fireEvent.change(screen.getByLabelText('接口地址'), { target: { value: 'https://api.example.test/v1' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(mutate).toHaveBeenCalledWith(
      {
        id: 'profile-1',
        body: {
          name: '测试配置',
          provider: 'openai',
          baseUrl: 'https://api.example.test/v1',
          model: 'qwen3:8b',
          models: [{ id: 'qwen3:8b', name: 'qwen3:8b' }],
        },
      },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    )
  })

  it('fetches provider models as candidates and only persists explicitly added models', async () => {
    useAuthStore.setState({ user: { id: 'u1', username: 'tester', role: 'owner' } })
    const fetchMutate = vi.fn()
    vi.mocked(useFetchAiModels).mockReturnValue({ mutate: fetchMutate, isPending: false } as unknown as ReturnType<typeof useFetchAiModels>)
    vi.mocked(useUpdateAiConfig).mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<typeof useUpdateAiConfig>)

    render(<AiSettingsSection />)
    fireEvent.click(screen.getAllByRole('button', { name: '编辑 AI 供应商' })[0]!)
    fireEvent.click(screen.getByRole('button', { name: '管理模型' }))
    fireEvent.click(screen.getByRole('button', { name: '拉取模型' }))

    expect(fetchMutate).toHaveBeenCalledWith(
      { profileId: 'profile-1', provider: 'openai', baseUrl: 'http://localhost:11434/v1' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    )
    const options = fetchMutate.mock.calls[0]?.[1] as { onSuccess: (value: { data: { id: string; name: string; capabilities?: { vision?: boolean; tools?: boolean; reasoning?: boolean } }[] }) => void }
    await act(async () => options.onSuccess({ data: [{ id: 'remote-model', name: 'Remote model', capabilities: { vision: true, tools: true, reasoning: true } }] }))

    expect(screen.getByText('Remote model')).toBeInTheDocument()
    expect(screen.getByText('remote-model')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加当前模型 remote-model' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '添加当前模型 remote-model' }))
    expect(screen.getAllByRole('button', { name: '移除模型 remote-model' })).toHaveLength(2)
    const cancelButtons = screen.getAllByRole('button', { name: '取消' })
    fireEvent.click(cancelButtons[cancelButtons.length - 1]!)
    expect(screen.getByText('Remote model')).toBeInTheDocument()
    expect(screen.getAllByText('视觉').length).toBeGreaterThan(0)
    expect(screen.getAllByText('工具').length).toBeGreaterThan(0)
    expect(screen.getAllByText('推理').length).toBeGreaterThan(0)
  })

  it('uses brand icons for providers and model names', async () => {
    useAuthStore.setState({ user: { id: 'u1', username: 'tester', role: 'owner' } })
    const fetchMutate = vi.fn()
    vi.mocked(useFetchAiModels).mockReturnValue({ mutate: fetchMutate, isPending: false } as unknown as ReturnType<typeof useFetchAiModels>)
    vi.mocked(useUpdateAiConfig).mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<typeof useUpdateAiConfig>)

    render(<AiSettingsSection />)
    fireEvent.click(screen.getByRole('button', { name: '添加 AI 供应商' }))
    expect(document.querySelector('img[src="/ai-icons/openai.svg"]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'OpenAI' }))
    fireEvent.click(screen.getByRole('button', { name: '管理模型' }))
    fireEvent.click(screen.getByRole('button', { name: '拉取模型' }))

    const options = fetchMutate.mock.calls[0]?.[1] as { onSuccess: (value: { data: { id: string; name: string }[] }) => void }
    await act(async () => options.onSuccess({ data: [{ id: 'doubao-seed-2.1-pro', name: 'doubao-seed-2.1-pro' }] }))

    expect(document.querySelector('img[src="/ai-icons/doubao-color.svg"]')).not.toBeNull()
  })

  it('keeps embedding candidates in the same model catalog', async () => {
    useAuthStore.setState({ user: { id: 'u1', username: 'tester', role: 'owner' } })
    const fetchMutate = vi.fn()
    vi.mocked(useFetchAiModels).mockReturnValue({ mutate: fetchMutate, isPending: false } as unknown as ReturnType<typeof useFetchAiModels>)
    vi.mocked(useUpdateAiConfig).mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<typeof useUpdateAiConfig>)

    render(<AiSettingsSection />)
    fireEvent.click(screen.getAllByRole('button', { name: '编辑 AI 供应商' })[0]!)
    fireEvent.click(screen.getByRole('button', { name: '管理模型' }))
    fireEvent.click(screen.getByRole('button', { name: '拉取模型' }))

    expect(fetchMutate).toHaveBeenCalledWith(
      { profileId: 'profile-1', provider: 'openai', baseUrl: 'http://localhost:11434/v1' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    )
    const options = fetchMutate.mock.calls[0]?.[1] as { onSuccess: (value: { data: { id: string; name: string }[] }) => void }
    await act(async () => options.onSuccess({ data: [
      { id: 'chat-model', name: 'Chat model' },
      { id: 'qwen3-embedding-8b', name: 'qwen3-embedding-8b' },
    ] }))

    fireEvent.click(screen.getByRole('button', { name: '添加当前模型 chat-model' }))
    fireEvent.click(screen.getByRole('button', { name: '添加当前模型 qwen3-embedding-8b' }))
    const cancelButtons = screen.getAllByRole('button', { name: '取消' })
    fireEvent.click(cancelButtons[cancelButtons.length - 1]!)

    expect(screen.getByText('Embedding', { exact: true })).toBeInTheDocument()
    expect(screen.queryByLabelText('Embedding 模型')).toBeNull()
  })

  it('ignores a stale model response after the draft provider changes', async () => {
    useAuthStore.setState({ user: { id: 'u1', username: 'tester', role: 'owner' } })
    const fetchMutate = vi.fn()
    vi.mocked(useFetchAiModels).mockReturnValue({ mutate: fetchMutate, isPending: false } as unknown as ReturnType<typeof useFetchAiModels>)
    vi.mocked(useUpdateAiConfig).mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<typeof useUpdateAiConfig>)

    render(<AiSettingsSection />)
    fireEvent.click(screen.getAllByRole('button', { name: '编辑 AI 供应商' })[0]!)
    fireEvent.click(screen.getByRole('button', { name: '管理模型' }))
    fireEvent.click(screen.getByRole('button', { name: '拉取模型' }))
    fireEvent.change(screen.getByLabelText('供应商'), { target: { value: 'deepseek' } })

    const options = fetchMutate.mock.calls[0]?.[1] as { onSuccess: (value: { data: { id: string; name: string }[] }) => void }
    await act(async () => options.onSuccess({ data: [{ id: 'stale-model', name: 'Stale model' }] }))

    expect(screen.getByLabelText('接口地址')).toHaveValue('https://api.deepseek.com')
    expect(screen.getByText('deepseek-chat')).toBeInTheDocument()
    expect(screen.queryByText('Stale model')).toBeNull()
  })

  it('ignores a stale model response after switching to another profile with the same endpoint', async () => {
    useAuthStore.setState({ user: { id: 'u1', username: 'tester', role: 'owner' } })
    const profiles = [
      { id: 'profile-a', name: '配置 A', provider: 'openai' as const, baseUrl: 'http://localhost:11434/v1', model: 'model-a', models: [{ id: 'model-a', name: 'model-a' }], embeddingModel: null, embeddingModels: [], apiKeyConfigured: false, createdAt: 1, updatedAt: 1 },
      { id: 'profile-b', name: '配置 B', provider: 'openai' as const, baseUrl: 'http://localhost:11434/v1', model: 'model-b', models: [{ id: 'model-b', name: 'model-b' }], embeddingModel: null, embeddingModels: [], apiKeyConfigured: false, createdAt: 2, updatedAt: 2 },
    ]
    vi.mocked(useAiConfig).mockReturnValue({
      data: { data: { provider: 'openai', baseUrl: profiles[0]!.baseUrl, model: profiles[0]!.model, models: profiles[0]!.models, profiles, activeProfileId: 'profile-a', prompts: [], modes: [], embeddingProfileId: null, embeddingProvider: null, embeddingModel: null, embeddingModels: [], embeddingConfigured: false, apiKeyConfigured: false, configuredByUser: true } },
      isLoading: false,
    } as ReturnType<typeof useAiConfig>)
    const fetchMutate = vi.fn()
    vi.mocked(useFetchAiModels).mockReturnValue({ mutate: fetchMutate, isPending: false } as unknown as ReturnType<typeof useFetchAiModels>)
    vi.mocked(useUpdateAiConfig).mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<typeof useUpdateAiConfig>)

    render(<AiSettingsSection />)
    fireEvent.click(screen.getAllByRole('button', { name: '编辑 AI 供应商' })[0]!)
    fireEvent.click(screen.getByRole('button', { name: '管理模型' }))
    fireEvent.click(screen.getByRole('button', { name: '拉取模型' }))
    const cancelButtons = screen.getAllByRole('button', { name: '取消' })
    fireEvent.click(cancelButtons[cancelButtons.length - 1]!)
    fireEvent.click(screen.getAllByRole('button', { name: '编辑 AI 供应商' })[1]!)

    const options = fetchMutate.mock.calls[0]?.[1] as { onSuccess: (value: { data: { id: string; name: string }[] }) => void }
    await act(async () => options.onSuccess({ data: [{ id: 'stale-model', name: 'Stale model' }] }))

    expect(screen.getByText('model-b')).toBeInTheDocument()
    expect(screen.queryByText('Stale model')).toBeNull()
  })

  it('switches to semantic retrieval and selects an added embedding model', () => {
    useAuthStore.setState({ user: { id: 'u1', username: 'tester', role: 'owner' } })
    const mutate = vi.fn()
    const profiles = [
      { id: 'chat-profile', name: 'Chat 服务', provider: 'openai' as const, baseUrl: 'http://chat.test/v1', model: 'chat-model', models: [{ id: 'chat-model', name: 'chat-model' }], embeddingModel: 'chat-embedding', embeddingModels: [{ id: 'chat-embedding', name: 'chat-embedding' }], apiKeyConfigured: false, createdAt: 1, updatedAt: 1 },
      { id: 'embedding-profile', name: '本地 Embedding', provider: 'ollama' as const, baseUrl: 'http://localhost:11434', model: 'llama3.2', models: [{ id: 'llama3.2', name: 'llama3.2' }], embeddingModel: 'nomic-embed-text', embeddingModels: [{ id: 'nomic-embed-text', name: 'nomic-embed-text' }], apiKeyConfigured: false, createdAt: 2, updatedAt: 2 },
    ]
    vi.mocked(useAiConfig).mockReturnValue({
      data: { data: { provider: 'openai', baseUrl: 'http://chat.test/v1', model: 'chat-model', models: profiles[0]!.models, profiles, activeProfileId: 'chat-profile', prompts: [], modes: [], embeddingProfileId: null, embeddingProvider: null, embeddingModel: null, embeddingModels: [], embeddingConfigured: false, apiKeyConfigured: false, configuredByUser: true } },
      isLoading: false,
    } as ReturnType<typeof useAiConfig>)
    vi.mocked(useUpdateAiConfig).mockReturnValue({ mutate, isPending: false } as unknown as ReturnType<typeof useUpdateAiConfig>)

    render(<AiSettingsSection />)
    const lexical = screen.getByRole('radio', { name: '词法检索' })
    expect(lexical).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByLabelText('Embedding 模型')).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: '语义检索' }))
    expect(screen.getByRole('radio', { name: '语义检索' })).toHaveAttribute('aria-checked', 'true')
    const select = screen.getByLabelText('Embedding 模型')
    fireEvent.change(select, { target: { value: 'embedding-profile::nomic-embed-text' } })

    expect(mutate).toHaveBeenCalledWith({ embeddingProfileId: 'embedding-profile', embeddingModel: 'nomic-embed-text' }, expect.objectContaining({ onError: expect.any(Function) }))
    expect(screen.getAllByText('Chat 服务').length).toBeGreaterThan(0)
  })

  it('marks hosted provider keys as required and local provider keys as optional', () => {
    useAuthStore.setState({ user: { id: 'u1', username: 'tester', role: 'owner' } })
    vi.mocked(useUpdateAiConfig).mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<typeof useUpdateAiConfig>)

    render(<AiSettingsSection />)
    fireEvent.click(screen.getByRole('button', { name: '添加 AI 供应商' }))
    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek' }))

    expect(screen.getByLabelText('API Key （必填）')).toBeRequired()

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    fireEvent.click(screen.getByRole('button', { name: '添加 AI 供应商' }))
    fireEvent.click(screen.getByRole('button', { name: 'OpenAI' }))

    expect(screen.getByLabelText('API Key （必填）')).toBeRequired()
  })

  it('tests the draft model configuration without saving it', () => {
    useAuthStore.setState({ user: { id: 'u1', username: 'tester', role: 'owner' } })
    vi.mocked(useAiConfig).mockReturnValue({
      data: { data: {
        provider: 'openai',
        baseUrl: 'http://localhost:11434/v1',
        model: 'qwen3:8b',
        models: [{ id: 'qwen3:8b', name: 'qwen3:8b' }, { id: 'llama3.2', name: 'llama3.2' }],
        profiles: [{ id: 'profile-1', name: '本地配置', provider: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'qwen3:8b', models: [{ id: 'qwen3:8b', name: 'qwen3:8b' }, { id: 'llama3.2', name: 'llama3.2' }], embeddingModel: null, embeddingModels: [], apiKeyConfigured: false, createdAt: 1, updatedAt: 1 }],
        activeProfileId: 'profile-1',
        prompts: [],
        modes: [],
        embeddingProfileId: null,
        embeddingProvider: null,
        embeddingModel: null,
        embeddingModels: [],
        embeddingConfigured: false,
        apiKeyConfigured: false,
        configuredByUser: true,
      } },
      isLoading: false,
    } as ReturnType<typeof useAiConfig>)
    const testMutate = vi.fn()
    vi.mocked(useTestAiConfigDraft).mockReturnValue({ mutate: testMutate, isPending: false } as unknown as ReturnType<typeof useTestAiConfigDraft>)
    vi.mocked(useUpdateAiConfig).mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<typeof useUpdateAiConfig>)

    render(<AiSettingsSection />)
    fireEvent.click(screen.getAllByRole('button', { name: '编辑 AI 供应商' })[0]!)
    fireEvent.click(screen.getByRole('button', { name: '测试可用性 llama3.2' }))

    expect(testMutate).toHaveBeenCalledWith(
      { profileId: 'profile-1', provider: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'llama3.2' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    )
  })

  it('does not render a separate embedding model field', () => {
    useAuthStore.setState({ user: { id: 'u1', username: 'tester', role: 'owner' } })
    vi.mocked(useUpdateAiConfig).mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<typeof useUpdateAiConfig>)

    render(<AiSettingsSection />)
    fireEvent.click(screen.getAllByRole('button', { name: '编辑 AI 供应商' })[0]!)
    expect(screen.queryByLabelText('Embedding 模型')).toBeNull()
    expect(screen.queryByRole('button', { name: '测试 Embedding' })).toBeNull()
  })

  it('hides custom endpoints from members and keeps the provider URL read-only', () => {
    vi.mocked(useUpdateAiConfig).mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<typeof useUpdateAiConfig>)

    render(<AiSettingsSection />)
    fireEvent.click(screen.getByRole('button', { name: '添加 AI 供应商' }))

    expect(screen.queryByRole('button', { name: '自定义兼容接口' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek' }))
    expect(screen.getByLabelText('接口地址')).toHaveAttribute('readonly')
    expect(screen.getByText('成员使用供应商默认地址；自定义接口地址由 Owner 管理。')).toBeInTheDocument()
  })

  it('shows guests a hint instead of configuration controls', () => {
    useAuthStore.setState({ user: { id: 'guest', username: 'guest', role: 'guest', guest: true } })

    render(<AiSettingsSection />)

    expect(screen.getByText('游客不能配置 AI 供应商；登录后可在这里添加自己的供应商。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '编辑 AI 供应商' })).toBeNull()
  })

  it('saves quick command edits immediately without a separate save button', () => {
    useAuthStore.setState({ user: { id: 'u1', username: 'tester', role: 'member' } })
    const mutate = vi.fn()
    vi.mocked(useUpdateAiConfig).mockReturnValue({ mutate, isPending: false } as unknown as ReturnType<typeof useUpdateAiConfig>)

    render(<AiSettingsSection />)
    expect(screen.getByText('快捷指令')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存快捷指令' })).toBeNull()
    expect(screen.queryByRole('button', { name: '上移' })).toBeNull()
    expect(screen.queryByRole('button', { name: '下移' })).toBeNull()
    expect(screen.getAllByRole('button', { name: '调整快捷指令顺序' })).toHaveLength(5)
    fireEvent.click(screen.getByRole('button', { name: '添加快捷指令' }))
    fireEvent.change(screen.getByLabelText('指令名称'), { target: { value: '线索提取' } })
    fireEvent.change(screen.getByLabelText('提示词模板'), { target: { value: '请列出当前内容中的关键线索。' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(mutate).toHaveBeenCalledWith(
      { prompts: expect.arrayContaining([
        expect.objectContaining({ name: '线索提取', prompt: '请列出当前内容中的关键线索。', enabled: true }),
      ]) },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    )
  })

  it('explains quick-command variables and inserts them at the prompt cursor', () => {
    useAuthStore.setState({ user: { id: 'u1', username: 'tester', role: 'member' } })
    vi.mocked(useUpdateAiConfig).mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<typeof useUpdateAiConfig>)

    render(<AiSettingsSection />)
    fireEvent.click(screen.getByRole('button', { name: '添加快捷指令' }))

    expect(screen.getByPlaceholderText('输入指令名称')).toBeInTheDocument()
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
