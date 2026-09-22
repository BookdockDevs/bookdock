import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { SystemInfoRes, SystemUpdateCheckRes, UpdateStatusRes } from '@bookdock/shared'

import AboutSettingsSection from '@/features/settings/components/AboutSettingsSection'
import i18n from '@/i18n/i18n'
import '@/index.css'

const currentVersion = '0.3.2'
const targetVersion = '0.4.0'
const walkthrough: UpdateStatusRes[] = [
  { phase: 'snapshot', currentVersion, targetVersion },
  { phase: 'download', currentVersion, targetVersion },
  { phase: 'verify', currentVersion, targetVersion },
  { phase: 'extract', currentVersion, targetVersion },
  { phase: 'promote', currentVersion, targetVersion },
  { phase: 'restarting', currentVersion, targetVersion },
  { phase: 'idle', currentVersion: targetVersion, targetVersion },
]
const scenarios: Record<string, UpdateStatusRes> = {
  snapshot: walkthrough[0],
  download: walkthrough[1],
  verify: walkthrough[2],
  extract: walkthrough[3],
  promote: walkthrough[4],
  restarting: walkthrough[5],
  applied: walkthrough[6],
  reverted: { phase: 'idle', currentVersion, targetVersion },
  failed: { phase: 'failed', currentVersion, targetVersion, error: { code: 'UPDATE_FAILED', message: 'Demo failure' } },
}

let selectedScenario = new URLSearchParams(window.location.search).get('scenario') ?? 'walkthrough'
let walkthroughIndex = 0
const realFetch = window.fetch.bind(window)
window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.origin)
  const method = init?.method ?? 'GET'
  if (url.pathname === '/api/v1/system/update' && method === 'POST') {
    walkthroughIndex = 0
    return Response.json({ data: selectedScenario === 'walkthrough' ? walkthrough[walkthroughIndex] : scenarios[selectedScenario] })
  }
  if (url.pathname === '/api/v1/system/update/status') {
    if (selectedScenario === 'walkthrough') walkthroughIndex = Math.min(walkthroughIndex + 1, walkthrough.length - 1)
    return Response.json({ data: selectedScenario === 'walkthrough' ? walkthrough[walkthroughIndex] : scenarios[selectedScenario] })
  }
  return realFetch(input, init)
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
queryClient.setQueryData(['system', 'info'], {
  data: { version: currentVersion, repositoryUrl: 'https://github.com/BookdockDevs/bookdock', releasesUrl: 'https://github.com/BookdockDevs/bookdock/releases' } satisfies SystemInfoRes,
})
queryClient.setQueryData(['system', 'update-check'], {
  data: {
    status: 'update-available',
    currentVersion,
    latestVersion: targetVersion,
    latestTag: `v${targetVersion}`,
    releaseUrl: 'https://github.com/BookdockDevs/bookdock/releases',
  } satisfies SystemUpdateCheckRes,
})

export function Preview() {
  const [scenario, setScenario] = useState(selectedScenario)
  const changeScenario = (value: string) => {
    selectedScenario = value
    setScenario(value)
  }

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-8 text-stone-800 dark:bg-stone-950 dark:text-stone-100">
      <div className="mx-auto max-w-3xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100">
          <div>
            <strong>本地界面演示</strong>
            <span className="ml-2">只模拟接口响应，不会下载文件、改版本或重启服务。</span>
          </div>
          <label className="flex items-center gap-2">
            <span>打开更新窗口并确认后模拟</span>
            <select
              aria-label="模拟更新结果"
              className="rounded-md border border-amber-400 bg-white px-2 py-1 text-stone-900 dark:bg-stone-900 dark:text-stone-100"
              value={scenario}
              onChange={(event) => changeScenario(event.target.value)}
            >
              <option value="walkthrough">完整进度演示</option>
              <option value="snapshot">停留在备份</option>
              <option value="download">停留在下载</option>
              <option value="verify">停留在校验</option>
              <option value="extract">停留在解压</option>
              <option value="promote">停留在切换</option>
              <option value="restarting">停留在重启</option>
              <option value="applied">更新成功</option>
              <option value="reverted">自动回滚</option>
              <option value="failed">更新失败</option>
            </select>
          </label>
          <button
            type="button"
            className="rounded-md border border-amber-400 bg-white px-2 py-1 text-stone-900 dark:bg-stone-900 dark:text-stone-100"
            onClick={() => { window.location.search = `?scenario=${scenario}` }}
          >
            重置演示
          </button>
        </div>
        <QueryClientProvider client={queryClient}>
          <AboutSettingsSection />
        </QueryClientProvider>
      </div>
    </main>
  )
}

await i18n.changeLanguage('zh-CN')
createRoot(document.getElementById('root')!).render(<Preview />)
