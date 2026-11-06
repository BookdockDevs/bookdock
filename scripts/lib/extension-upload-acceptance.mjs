import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

export async function verifyUploads({ browser, cdp, targets, options, configure, openPage, until, wait, scratch, baseUrl, extensionId, token, requests, failNames, controls, JSZip }) {
  const extensionBase = `chrome-extension://${extensionId}`
  const proxy = 'http://127.0.0.1:19425'
  const results = []
  let hoverCaptured = false
  let sendingCaptured = false
  const content = (name) => Buffer.from(`第1章 ${name}\n这是 ${name} 的多文件上传验收正文。\n`)
  const fixture = async (name, bytes = content(name)) => { const file = path.join(scratch, name); await writeFile(file, bytes); return file }
  const click = (page, label) => page.evaluate(`(() => {const button=[...document.querySelectorAll('button')].find(node=>node.textContent.trim()===${JSON.stringify(label)});if(!button)throw new Error('Button absent');button.click()})()`)
  const rows = (page) => page.evaluate('[...document.querySelectorAll("li")].map(node=>node.textContent)')
  const readJobs = (page) => page.evaluate(`new Promise((resolve,reject)=>{const open=indexedDB.open('bookdock-extension',1);open.onsuccess=()=>{const db=open.result;const tx=db.transaction('jobs');const request=tx.objectStore('jobs').getAll();tx.oncomplete=()=>{db.close();resolve(request.result)};tx.onerror=()=>reject(tx.error)}})`)
  async function size(page) {
    // Background tabs never advance CSS transitions, so wake the target before measuring a dialog.
    if (page.targetId) await browser.send('Target.activateTarget', { targetId: page.targetId }).catch(() => {})
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
    await page.evaluate('document.documentElement.classList.remove("dark");document.fonts.ready')
    await wait(300)
  }
  async function screenshot(page, name) {
    await size(page)
    const image = await page.send('Page.captureScreenshot', { format: 'png' })
    await writeFile(path.join(scratch, name), Buffer.from(image.data, 'base64'))
  }
  async function select(page, files) {
    const document = await page.send('DOM.getDocument', { depth: -1 })
    const input = await page.send('DOM.querySelector', { nodeId: document.root.nodeId, selector: 'input[type="file"]' })
    assert.ok(input.nodeId, 'Shared file picker must exist')
    await page.send('DOM.setFileInputFiles', { nodeId: input.nodeId, files })
  }
  async function uploadPage() {
    const opened = await openPage(`${extensionBase}/upload.html`)
    await opened.page.send('Runtime.enable')
    await opened.page.send('Page.enable')
    await opened.page.send('Page.reload')
    try { await until(() => opened.page.evaluate('!!document.querySelector(".group.h-80")'), 'extension upload page') }
    catch (error) { console.log('Upload errors:', opened.page.errors); throw error }
    return opened
  }
  async function setAuto(value, target = proxy) {
    const checked = await options.evaluate('document.getElementById("auto-open").checked')
    if (checked !== value) {
      await options.evaluate('document.getElementById("auto-open").click()')
      assert.equal(await options.evaluate('document.getElementById("auto-open").checked'), value, 'Automatic-opening switch must toggle on click')
    }
    await configure(target, token)
  }
  async function drop(files) {
    const source = await openPage(`http://localhost:19425/drop-target/${Date.now()}`)
    await size(source.page)
    await wait(400)
    const before = new Set((await targets()).map((entry) => entry.id))
    // Files must land inside the centred drop card; dropping anywhere else cancels by design.
    const point = await source.page.evaluate('({ x: Math.round(innerWidth / 2), y: Math.round(innerHeight / 2) })')
    for (const type of ['dragEnter', 'dragOver']) await source.page.send('Input.dispatchDragEvent', { type, x: point.x, y: point.y, data: { items: [], files, dragOperationsMask: 1 } })
    if (!hoverCaptured) { hoverCaptured = true; await screenshot(source.page, 'extension-drop-hover.png') }
    await source.page.send('Input.dispatchDragEvent', { type: 'drop', x: point.x, y: point.y, data: { items: [], files, dragOperationsMask: 1 } })
    if (!sendingCaptured) { sendingCaptured = true; await wait(150); await screenshot(source.page, 'extension-drop-sending.png') }
    const uploadTarget = await until(async () => (await targets()).find((entry) => entry.type === 'page' && !before.has(entry.id)), 'one batch upload page')
    const page = await cdp(uploadTarget.webSocketDebuggerUrl)
    assert.equal(await source.page.evaluate('window.siteDrops'), 0)
    // The manifest injects content.js at document_start and the popup's refresh injects it again;
    // the installer guard must keep that at one overlay, or two cards stack and the dim doubles.
    assert.equal(await source.page.evaluate('document.querySelectorAll("[data-bookdock-drop]").length'), 1, 'one overlay per page')
    return { page, targetId: uploadTarget.id, sourceId: source.targetId }
  }
  async function dismiss(opened) {
    // A removed manifest surface (options page, dialogs) only shows up as a rejected promise,
    // so the run fails on any uncaught error instead of leaving it to the extension error list.
    assert.deepEqual(opened.page.errors, [], `Upload page must not raise uncaught errors: ${opened.page.errors.join(' | ')}`)
    // The upload page has no dialog to close; clearing the job store is the same end state
    // the old close affordance produced (settled rows removed, temporary chunks dropped).
    await opened.page.evaluate(`new Promise((resolve,reject)=>{const open=indexedDB.open('bookdock-extension',1);open.onsuccess=()=>{const db=open.result;const tx=db.transaction(['jobs','chunks'],'readwrite');tx.objectStore('jobs').clear();tx.objectStore('chunks').clear();tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>reject(tx.error)}})`)
    await until(async () => (await readJobs(opened.page)).length === 0, 'dismissal clears batch metadata')
    await browser.send('Target.closeTarget', { targetId: opened.targetId })
    if (opened.sourceId) await browser.send('Target.closeTarget', { targetId: opened.sourceId })
  }
  // The two surfaces sit in different shells — a full standalone page versus a `max-w-2xl` modal
  // whose body carries its own padding — so absolute widths are shell properties, not component
  // ones. What the shared panel must match is that it stretches to the full content width of
  // whatever shell holds it; everything else (classes, rows, controls, height, type, radius) is
  // owned by the component and must be byte-identical.
  async function assertSurface(actualPage, webPage, message) {
    const actual = await metrics(actualPage)
    const expected = await metrics(webPage)
    for (const [name, surface] of [['extension', actual], ['Web', expected]]) {
      const slack = Math.abs(surface.drop.width - surface.drop.content)
      assert.ok(slack <= 1, `${message}: ${name} dropzone must fill its shell (${surface.drop.width}px in ${surface.drop.content}px)`)
    }
    const shape = (surface) => ({ ...surface, drop: { ...surface.drop, width: undefined, content: undefined } })
    assert.deepEqual(shape(actual), shape(expected), message)
  }
  const metrics = (page) => page.evaluate(`(() => {
    const drop=document.querySelector('.group.h-80');const list=document.querySelector('ul');
    const content=node=>{const parent=node.parentElement,style=getComputedStyle(parent);return parent.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)};
    const shape=node=>{const rect=node.getBoundingClientRect(),style=getComputedStyle(node);return {width:rect.width,content:content(node),height:rect.height,font:style.fontFamily,fontSize:style.fontSize,borderRadius:style.borderRadius}};
    return {drop:shape(drop),dropClass:drop.className,listClass:list?.className,rows:[...document.querySelectorAll('li')].map(node=>({className:node.className,text:node.textContent})),buttons:[...document.querySelectorAll('[data-upload-actions] button')].map(node=>({className:node.className,text:node.textContent}))};
  })()`)

  await setAuto(false, baseUrl)
  const web = await openPage(`${baseUrl}/`)
  await until(() => web.page.evaluate('[...document.querySelectorAll("button")].some(node=>node.textContent.trim()==="上传")'), 'Web library upload entry')
  await click(web.page, '上传')
  await until(() => web.page.evaluate('!!document.querySelector("[role=dialog] .h-80")'), 'Web upload dialog')
  const comparison = await uploadPage()
  await size(web.page); await size(comparison.page)
  await assertSurface(comparison.page, web.page, 'Shared empty upload surface must match Web')
  const staged = [await fixture('staged-one.txt'), await fixture('staged-two.txt')]
  await select(web.page, staged); await select(comparison.page, staged)
  await until(async () => { const values = await rows(comparison.page); return values.length === 2 && values.every(value=>value.includes('待上传')) }, 'multiple picker files stage before upload')
  await assertSurface(comparison.page, web.page, 'Staged rows, controls, classes and sizes must match Web')
  await screenshot(web.page, 'web-upload-staged.png')
  await screenshot(comparison.page, 'extension-upload-staged.png')
  await dismiss(comparison)
  const webFiles = [await fixture('web-native-one.txt'), await fixture('web-native-two.txt')]
  const beforeWebDrop = new Set((await targets()).map(entry=>entry.id))
  for (const type of ['dragEnter', 'dragOver', 'drop']) await web.page.send('Input.dispatchDragEvent', { type, x: 640, y: 400, data: { items: [], files: webFiles, dragOperationsMask: 1 } })
  await until(async () => {const values=await rows(web.page);return values.length===4 && values.every(row=>row.includes('完成'))}, 'instance page keeps its native Web multi-drop and starts staged files')
  assert.ok(!(await targets()).some(entry=>!beforeWebDrop.has(entry.id) && entry.url.startsWith(extensionBase+'/upload.html')))
  await browser.send('Target.closeTarget', { targetId: web.targetId })
  results.push('Web and extension empty/staged surfaces match; picker stages multiple files')

  await setAuto(false)
  const seedBytes = content('existing-book')
  const seed = await drop([await fixture('seed.txt', seedBytes)])
  await until(async () => (await rows(seed.page)).some(row=>row.includes('seed.txt') && row.includes('完成')), 'seed book upload')
  await dismiss(seed)

  await setAuto(true)
  controls.delay = 1200
  failNames.add('retry-one.txt'); failNames.add('retry-two.txt')
  const mixed = await drop([
    await fixture('batch-good.txt'), await fixture('batch-duplicate.txt', seedBytes),
    await fixture('retry-one.txt'), await fixture('retry-two.txt'),
  ])
  await until(async () => (await rows(mixed.page)).some(row=>row.includes('处理中')), 'processing status before server completion')
  await screenshot(mixed.page, 'extension-upload-processing.png')
  await until(async () => { const values=await rows(mixed.page);return values.length===4 && values.filter(row=>row.includes('重试')).length===2 && values.some(row=>row.includes('已存在')) && values.some(row=>row.includes('完成')) }, 'independent success/duplicate/failure rows')
  assert.ok((await mixed.page.evaluate('location.href')).startsWith(extensionBase))
  await until(() => mixed.page.evaluate('document.body.innerText.includes("1 本成功，1 本已存在，2 本失败")'), 'Web summary notification for partial success')
  // The action row is only a toast obstacle inside a modal footer; on a full page it scrolls with
  // the document, so the toast must stay pinned to the real viewport corner.
  const toastBox = await mixed.page.evaluate(`(() => {const node=document.querySelector('[role=status]');const rect=node.getBoundingClientRect();return {bottom:Math.round(innerHeight-rect.bottom),right:Math.round(innerWidth-rect.right)}})()`)
  assert.ok(toastBox.bottom >= 0 && toastBox.bottom <= 40, `Toast must sit at the viewport bottom (${toastBox.bottom}px gap)`)
  assert.ok(toastBox.right >= 0 && toastBox.right <= 40, `Toast must hug the right edge (${toastBox.right}px gap)`)
  await screenshot(mixed.page, 'extension-upload-mixed.png')
  await mixed.page.evaluate('[...document.querySelectorAll("li")].find(node=>node.textContent.includes("retry-one.txt")).querySelector("button").click()')
  await until(async () => (await rows(mixed.page)).some(row=>row.includes('retry-one.txt') && row.includes('完成')), 'individual failed-file retry')
  assert.equal(requests.get('batch-good.txt'), 1)
  assert.equal(requests.get('batch-duplicate.txt'), 1)
  assert.equal(requests.get('retry-one.txt'), 2)
  assert.equal(requests.get('retry-two.txt'), 1)
  await click(mixed.page, '重试全部')
  await until(() => mixed.page.evaluate(`location.href===${JSON.stringify(proxy + '/')}`), 'multi-file completion opens homepage')
  assert.equal(requests.get('retry-one.txt'), 2, 'Retry all must not resend the previously recovered file')
  assert.equal(requests.get('retry-two.txt'), 2)
  assert.equal(requests.get('batch-good.txt'), 1)
  assert.equal(requests.get('batch-duplicate.txt'), 1)
  await browser.send('Target.closeTarget', { targetId: mixed.targetId })
  await browser.send('Target.closeTarget', { targetId: mixed.sourceId })
  results.push('Web-page multi-drop; mixed results and toast; single retry and retry-all send only failed files; batch opens homepage')

  controls.delay = 0
  const single = await drop([await fixture('auto-single.txt')])
  await until(() => single.page.evaluate('location.pathname.startsWith("/books/") && new URLSearchParams(location.search).has("account")'), 'single file opens reader')
  await browser.send('Target.closeTarget', { targetId: single.targetId })
  await browser.send('Target.closeTarget', { targetId: single.sourceId })
  results.push('Single file automatically opens its reader')

  await setAuto(false)
  const picker = await uploadPage()
  const selected = [await fixture('picker-one.txt'), await fixture('picker-two.txt')]
  await select(picker.page, selected)
  await until(async () => {const values=await rows(picker.page);return values.length===2 && values.every(row=>row.includes('待上传'))}, 'picker pending state')
  assert.equal(requests.has('picker-one.txt'), false)
  assert.equal(requests.has('picker-two.txt'), false)
  await click(picker.page, '上传')
  await until(async () => {const values=await rows(picker.page);return values.length===2 && values.every(row=>row.includes('完成'))}, 'picker uploads both files')
  assert.ok((await picker.page.evaluate('location.href')).startsWith(extensionBase), 'Disabled automatic opening must keep results')
  const beforeOpen = new Set((await targets()).map(entry=>entry.id))
  await click(picker.page, '打开书坞')
  const home = await until(async () => (await targets()).find(entry=>!beforeOpen.has(entry.id) && entry.url===proxy+'/'), 'manual Open Bookdock goes to homepage for multiple files')
  await browser.send('Target.closeTarget', { targetId: home.id })
  await dismiss(picker)
  results.push('Multiple picker upload requires confirmation; automatic opening can be disabled; manual Open Bookdock opens homepage')

  const extensionDrop = await uploadPage()
  const dropFiles = [await fixture('page-one.txt'), await fixture('page-two.txt')]
  await size(extensionDrop.page)
  for (const type of ['dragEnter', 'dragOver', 'drop']) await extensionDrop.page.send('Input.dispatchDragEvent', { type, x: 640, y: 400, data: { items: [], files: dropFiles, dragOperationsMask: 1 } })
  await until(async () => {const values=await rows(extensionDrop.page);return values.length===2 && values.every(row=>row.includes('完成'))}, 'extension-page multiple drop')
  await click(extensionDrop.page, '完成')
  await until(async () => !(await targets()).some((entry) => entry.id === extensionDrop.targetId), 'completion closes the upload page')
  results.push('Extension upload page accepts a simultaneous multi-file drop and closes itself on completion')

  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip')
  zip.file('META-INF/container.xml', '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
  zip.file('content.opf', '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">multi-epub</dc:identifier><dc:title>Mixed EPUB</dc:title><dc:language>zh</dc:language></metadata><manifest><item id="text" href="text.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="text"/></spine></package>')
  zip.file('text.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Mixed EPUB</title></head><body><p>EPUB 与 TXT 同批上传验收。</p></body></html>')
  const formats = await drop([await fixture('mixed-format.epub', await zip.generateAsync({ type: 'nodebuffer' })), await fixture('mixed-format.txt')])
  await until(async () => {const values=await rows(formats.page);return values.length===2 && values.every(row=>row.includes('完成'))}, 'EPUB and TXT in the same batch')
  await dismiss(formats)
  const invalid = await drop([await fixture('damaged.epub', Buffer.from('invalid EPUB')), await fixture('survives-damage.txt')])
  await until(async () => {const values=await rows(invalid.page);return values.length===2 && values.some(row=>row.includes('重试')) && values.some(row=>row.includes('完成'))}, 'damaged file does not fail a valid sibling')
  await click(invalid.page, '重试全部')
  await until(() => Promise.resolve(requests.get('damaged.epub') === 2), 'retry only the damaged file')
  await until(async () => (await rows(invalid.page)).some(row=>row.includes('重试')), 'damaged retry retains its own error')
  assert.equal(requests.get('survives-damage.txt'), 1)
  await dismiss(invalid)
  results.push('Mixed EPUB/TXT formats succeed; a real damaged EPUB fails independently and retries without resending the valid sibling')

  // A retry re-sends the bytes banked during the drop, never the file on disk, so a transfer
  // that died mid-way has nothing left to send. Seed the two failure shapes the reader can
  // actually meet - one half-received, one fully received - and confirm the row only offers
  // 重试 where a retry can change the outcome.
  const retryView = await uploadPage()
  const batch = `probe-retry-${Date.now()}`
  await retryView.page.evaluate(`new Promise((resolve,reject)=>{
    const open=indexedDB.open('bookdock-extension',1)
    open.onerror=()=>reject(open.error)
    open.onsuccess=()=>{
      const db=open.result
      const tx=db.transaction(['settings','jobs','chunks'],'readwrite')
      const read=tx.objectStore('settings').get('connection')
      read.onsuccess=()=>{
        const now=Date.now()
        const base={batchId:${JSON.stringify(batch)},connectionId:read.result?.id??'none',sourceTabId:null,sourceFrameId:0,createdAt:now,updatedAt:now,autoStart:true}
        tx.objectStore('jobs').put({...base,id:'probe-lost',order:0,name:'lost-halfway.epub',size:9,received:4,chunkCount:1,state:'failed',error:'文件已失效，请重新添加'})
        tx.objectStore('jobs').put({...base,id:'probe-kept',order:1,name:'kept-bytes.txt',size:4,received:4,chunkCount:1,state:'failed',error:'实例暂时不可用（503）'})
        tx.objectStore('chunks').put({jobId:'probe-kept',index:0,blob:new Blob(['test'])})
      }
      tx.oncomplete=()=>{db.close();resolve(true)}
      tx.onerror=()=>reject(tx.error)
    }
  })`)
  await retryView.page.send('Page.navigate', { url: `${extensionBase}/upload.html?batch=${batch}` })
  await until(async () => (await rows(retryView.page)).length === 2, 'seeded retry rows')
  await wait(600)
  await screenshot(retryView.page, 'extension-retry-rows.png')
  const rowButtons = (name) => retryView.page.evaluate(`(()=>{const row=[...document.querySelectorAll('li')].find(node=>node.textContent.includes(${JSON.stringify(name)}));return row?[...row.querySelectorAll('button')].map(node=>node.textContent.trim()):null})()`)
  assert.deepEqual(await rowButtons('lost-halfway.epub'), [], 'A file whose bytes are gone must not offer a retry that cannot run')
  assert.match(await retryView.page.evaluate(`[...document.querySelectorAll('li')].find(node=>node.textContent.includes('lost-halfway.epub')).textContent`), /文件已失效，请重新添加/, 'The lost row must still say what to do instead')
  assert.deepEqual(await rowButtons('kept-bytes.txt'), ['重试'], 'A fully received file must keep its retry')
  assert.ok(await retryView.page.evaluate(`[...document.querySelectorAll('[data-upload-actions] button')].some(node=>node.textContent.trim()==='重试全部')`), 'One retryable failure keeps retry-all available')
  await dismiss(retryView)
  results.push('A failed row offers 重试 only when its bytes survived; a lost transfer points at re-adding instead')

  const cancel = await openPage(`http://localhost:19425/drop-target/${Date.now()}`)
  await size(cancel.page)
  await wait(400)
  const beforeCancel = new Set((await targets()).map((entry) => entry.id))
  const outside = [await fixture('cancel-outside.txt')]
  for (const type of ['dragEnter', 'dragOver', 'drop']) await cancel.page.send('Input.dispatchDragEvent', { type, x: 16, y: 16, data: { items: [], files: outside, dragOperationsMask: 1 } })
  await wait(1500)
  assert.ok(!(await targets()).some((entry) => !beforeCancel.has(entry.id) && entry.url.startsWith(`${extensionBase}/upload.html`)), 'Dropping outside the card must not start an upload')
  assert.equal(await cancel.page.evaluate('window.siteDrops'), 0, 'Cancelled drop must not leak to the page either')
  assert.equal(requests.has('cancel-outside.txt'), false)
  await browser.send('Target.closeTarget', { targetId: cancel.targetId })
  results.push('Dropping outside the drop card cancels the transfer')

  const manualSingle = await drop([await fixture('manual-single.txt')])
  await until(async () => (await rows(manualSingle.page)).some(row=>row.includes('完成')), 'single completion with automatic opening disabled')
  const beforeSingle = new Set((await targets()).map(entry=>entry.id))
  await click(manualSingle.page, '打开书坞')
  const reader = await until(async () => (await targets()).find(entry=>!beforeSingle.has(entry.id) && new URL(entry.url).pathname.startsWith('/books/')), 'manual single-file Open Bookdock opens reader')
  await browser.send('Target.closeTarget', { targetId: reader.id })
  await dismiss(manualSingle)
  results.push('Manual Open Bookdock opens the reader for a successful single file')
  await writeFile(path.join(scratch, 'upload-acceptance.json'), JSON.stringify({ results, requests: Object.fromEntries(requests) }, null, 2))
  for (const result of results) console.log(`PASS: ${result}`)
}
