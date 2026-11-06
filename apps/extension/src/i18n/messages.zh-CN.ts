/**
 * Extension-owned copy. Keys are grouped by surface, not by file: the popup, the drop
 * overlay and the upload page each own one block, everything thrown as an Error lives
 * under `error`. Adding a key here without adding it to messages.en.ts fails typecheck.
 *
 * Error copy follows the Web app's granularity, not the code's. The Web upload path shows a
 * single "Upload failed" for every server and network failure and only distinguishes what the
 * user can act on. The test here is therefore "does the user do something different after
 * reading this?" — a bad URL, a wrong token, a missing permission and an unreachable instance
 * each lead somewhere specific, so they keep their own key. Corrupt staging data, an expired
 * job, a full batch table and malformed messages all end in "try again" or "pick the file
 * again", so they share a key instead of narrating an internal state nobody can observe.
 */
export const messages = {
  app: {
    name: '书坞',
  },
  popup: {
    connected: '已连接',
    accountMissing: '连接你的书坞',
    instanceHint: '在书坞「设置」里创建访问令牌，勾选「上传书籍」。',
    urlLabel: '实例地址',
    tokenLabel: '访问令牌',
    connect: '连接到书坞',
    save: '测试并保存',
    saveTest: '测试连接',
    saveBusy: '正在测试…',
    connectOk: '连接正常',
    saved: '已保存',
    timeout: '连接超时，请确认实例可访问、地址与令牌正确后重试',
    edit: '编辑连接',
    cancelEdit: '取消编辑',
    showToken: '显示令牌',
    hideToken: '隐藏令牌',
    openInstanceTitle: '在新标签页打开书坞',
    disconnect: '断开当前连接',
    acceptDrops: '网页拖拽投送',
    acceptDropsHint: '在任意网页拖入电子书即可快速发送',
    autoOpen: '完成后打开书坞',
    autoOpenHint: '书籍上传成功后，自动在新标签页打开',
    chooseFile: '打开上传页面',
    jobsTitle: '待处理文件',
    jobReceiving: '接收中 · {{count}} 个文件',
    jobUploading: '上传中 · {{count}} 个文件',
    jobView: '查看上传 · {{count}} 个文件',
  },
  overlay: {
    idle: '拖拽文件到此处',
    active: '松开即可发送到书坞',
    sending: '正在发送…',
    waiting: '等待',
    rowSending: '发送中',
    sent: '已发送',
    limit: '单个文件上限 {{size}}',
    ignored: '仅支持 EPUB / TXT，已忽略 {{count}} 个文件',
    oversized: '文件超过 {{size}} 上限',
    progress: '已发送 {{percent}}%',
    donePartial: '已发送 {{sent}} 个文件，{{ignored}} 个被忽略',
    done: '已交给上传页，继续上传中 · 现在可以关闭此网页',
    failed: '接收失败，请通过扩展工具栏重新选择文件',
    revoked: '扩展已更新，请刷新本页面后再试',
    stalled: '扩展后台没有响应，请刷新本页面后再试',
  },
  upload: {
    title: '上传',
    intro: '拖入或选择 EPUB / TXT 文件进行解析与上传。',
    uploadingNotice: '正在向书坞同步书籍，请不要关闭此页面。',
    connectedTo: '{{name}}',
    open: '打开书坞',
    notConnected: '请先在扩展中连接书坞实例',
    receiving: '正在接收文件…',
  },
  error: {
    generic: '操作失败',
    tooManyBatches: '同时进行的上传太多了，请等它们结束后再试',
    storageUnavailable: '浏览器存储不可用，请释放空间后重试',
    fileUnsupported: '请选择有效的 EPUB 或 TXT 文件',
    fileTooLarge: '文件超过实例的上传限制（{{size}}）',
    uploadTooLarge: '服务器拒绝了这次上传，文件可能超过限制',
    urlInvalid: '请输入完整的实例根地址，例如 https://books.example.com',
    tokenFormat: '请输入书坞设置中创建的访问令牌，不是登录密码或书源令牌',
    tokenInvalid: '令牌无效或已过期，请在书坞设置中重新创建',
    tokenForbidden: '令牌或账号已停用，或没有所需权限',
    tokenScope: '令牌缺少「上传书籍」权限，请在书坞设置中勾选',
    memberBlocked: '实例已关闭成员上传，请让管理员开启「允许上传文件」',
    unreachable: '无法连接实例，请检查地址、网络和网站访问权限；HTTPS 证书必须有效',
    instanceDown: '实例暂时不可用（{{status}}）',
    instanceBadResponse: '实例响应无效，请检查地址及书坞版本',
    uploadInterrupted: '网络中断或超时，文件已保留',
    cancelled: '已取消',
    connChanged: '连接已变更，请重新选择文件',
    transferLost: '文件已失效，请重新添加',
  },
}

/** Shape of a locale table; `messages.en.ts` is typed by it, so key parity is compile-checked. */
export type Messages = typeof messages

export default messages
