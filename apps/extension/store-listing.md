# Store submission materials

## Chinese listing

Name: 书坞

Short description: 快速将电子书（EPUB / TXT）推送到你的自建书坞实例，支持全网网页拖拽投送与即刻阅读。

Description:

把书拖进网页，接着在书坞阅读。

连接你自己的书坞实例后，在普通网页中拖入一个或多个 EPUB / TXT，页面中央会出现放置框，在框内松手即上传；拖到框外松手则取消。文件会上传到该账号的私人书库，单文件完成后打开阅读页，多文件完成后打开书坞首页；可在扩展弹窗中关闭自动打开。也可以从扩展工具栏同时选择多个文件。

支持接收与上传进度、失败重试、重复文件识别，以及暂停网页拖入。原网页的文件输入框保持正常。浏览器内部页和扩展商店等受限页面请使用工具栏上传。

界面语言跟随浏览器，中文环境显示中文，其它环境显示英文。

需要可访问的书坞实例，以及勾选了「上传书籍」权限的访问令牌。阅读页沿用网页登录状态。扩展不包含本地阅读器，不读取网页正文，不收集浏览历史，也不包含广告或遥测。

## English listing

Name: Bookdock

Short description: Easily send EPUB/TXT ebooks to your self-hosted Bookdock library with drag-and-drop web delivery and instant reading.

Description:

Connect your own Bookdock instance and drop EPUB/TXT files onto an ordinary web
page. A drop card appears in the centre of the page; release inside it to upload,
release outside it to cancel. A single completed file opens its Web reader; multiple
completed files open the homepage. Automatic opening can be disabled in the popup.
The multi-file toolbar picker also works when a browser-protected page cannot
receive drops.

See transfer progress, retry failed uploads, reopen an existing book when a file
is duplicated, and pause automatic page drops. Native file inputs remain usable.
The interface follows the browser language: Chinese for `zh`, English otherwise.

Requires a Bookdock
instance and a token with the "Upload books" permission. Reading uses your normal
Web login. The extension has no local reader, advertising, analytics, browsing
history collection or webpage-text extraction.

## Permission explanations

- HTTP/HTTPS host access: receive user-initiated file drops on ordinary sites and
  upload to arbitrary user-configured self-hosted instances. A click-only
  `activeTab` grant cannot provide the advertised automatic drag workflow.
- `scripting`: activate the same isolated content script on existing permitted
  tabs after connecting; users need not reload every open page.
- `alarms`: expire abandoned temporary upload files while the browser is running.
- No Cookies, history, downloads, clipboard or native-messaging permission.

## Data disclosures and submission requirements

The extension transmits user-selected book files and authentication information
to a destination the user configures. It does not send them to the developer.
Complete both stores' current data-disclosure forms consistently with this fact;
do not claim that the extension handles no user data merely because it has no
telemetry. The Firefox manifest declares `authenticationInfo` and `websiteContent`
for its explicit token/file transmission.

Both stores require a publicly accessible privacy-policy URL once an extension
handles authentication tokens or user content; host that page outside the package
if the listing is submitted. Use screenshots from the actual release candidate,
without credentials or personal library data; Chrome store screenshots should be
exported at the size required by the current store form.

The workflow produces ZIP artifacts only. Chrome publication and Firefox signing
require the owner's store accounts. Upload the source archive when reviewer
reproduction is required. Do not submit the Firefox candidate as browser-verified
until its runtime acceptance has been completed. Do not publish a Chrome artifact
under claims stronger than the recorded browser validation.
