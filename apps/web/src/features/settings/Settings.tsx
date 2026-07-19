import { useUiStore, type UiTheme, getEffectiveTheme } from '@/stores/ui.store'

export default function Settings() {
  const { uiTheme, setUiTheme } = useUiStore()

  const options: { value: UiTheme; label: string; icon: string }[] = [
    { value: 'system', label: '跟随系统', icon: '💻' },
    { value: 'light', label: '日间', icon: '☀' },
    { value: 'dark', label: '夜间', icon: '🌙' },
  ]

  const effectiveTheme = getEffectiveTheme(uiTheme)

  return (
    <div className="mx-auto max-w-md p-6">
      <h1 className="mb-6 text-2xl font-bold">设置</h1>
      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
        <div>
          <label className="mb-2 block text-sm font-medium">界面主题</label>
          <div className="flex items-center gap-3">
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setUiTheme(opt.value)}
                className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-sm transition-colors ${
                  uiTheme === opt.value
                    ? 'border-stone-900 bg-stone-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900'
                    : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800'
                }`}
              >
                <span>{opt.icon}</span>
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-stone-500">
            当前生效：{effectiveTheme === 'dark' ? '夜间' : '日间'}
          </p>
        </div>
      </div>
    </div>
  )
}
