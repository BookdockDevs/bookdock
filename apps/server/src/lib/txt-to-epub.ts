import JSZip from 'jszip'

export interface TxtToEpubChapter {
  id: string
  title: string
  level: number
  content: string
}

export interface TxtToEpubMetadata {
  title: string
  author?: string
  language?: string
  id?: string
}

const XML_SPECIAL_CHAR_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
}

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => XML_SPECIAL_CHAR_MAP[char] ?? char)
}

function chapterFilename(index: number): string {
  return `chapter-${String(index + 1).padStart(4, '0')}.xhtml`
}

function buildChapterXhtml(title: string, content: string): string {
  const paragraphs = content
    .split('\n\n')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => `<p>${escapeXml(p)}</p>`)
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css" />
</head>
<body>
  <h1>${escapeXml(title)}</h1>
  ${paragraphs || '<p />'}
</body>
</html>`
}

function buildContentOpf(
  metadata: TxtToEpubMetadata,
  chapterFiles: string[]
): string {
  const id = metadata.id ?? 'bookdock-unknown'
  const title = metadata.title || 'Untitled'
  const author = metadata.author || 'Unknown'
  const language = metadata.language || 'zh-CN'

  const manifestItems = chapterFiles
    .map((file) => {
      const itemId = file.replace(/\.xhtml$/, '')
      return `    <item id="${itemId}" href="${file}" media-type="application/xhtml+xml" />`
    })
    .join('\n')

  const itemRefs = chapterFiles
    .map((file) => file.replace(/\.xhtml$/, ''))
    .map((id) => `    <itemref idref="${id}" />`)
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookId">${escapeXml(id)}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:language>${escapeXml(language)}</dc:language>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />
    <item id="style" href="style.css" media-type="text/css" />
${manifestItems}
  </manifest>
  <spine toc="ncx">
${itemRefs}
  </spine>
</package>`
}

function buildTocNcx(metadata: TxtToEpubMetadata, chapters: TxtToEpubChapter[]): string {
  const id = metadata.id ?? 'bookdock-unknown'
  const title = metadata.title || 'Untitled'
  const maxLevel = Math.max(1, ...chapters.map((c) => c.level))

  const navPoints = chapters
    .map((chapter, index) => {
      const playOrder = index + 1
      return `    <navPoint id="navpoint-${playOrder}" playOrder="${playOrder}">
      <navLabel>
        <text>${escapeXml(chapter.title)}</text>
      </navLabel>
      <content src="${chapterFilename(index)}" />
    </navPoint>`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escapeXml(id)}" />
    <meta name="dtb:depth" content="${maxLevel}" />
    <meta name="dtb:totalPageCount" content="0" />
    <meta name="dtb:maxPageNumber" content="0" />
  </head>
  <docTitle>
    <text>${escapeXml(title)}</text>
  </docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>`
}

const STYLE_CSS = `body {
  margin: 0;
  padding: 1em;
  font-family: "Noto Serif SC", "Source Han Serif SC", "SimSun", serif;
  line-height: 1.8;
  color: #000;
  background: #fff;
}

h1 {
  text-align: center;
  font-size: 1.5em;
  margin: 1em 0 1.5em;
}

p {
  text-indent: 2em;
  margin: 0 0 0.5em 0;
}
`

export async function convertTxtToEpub(
  metadata: TxtToEpubMetadata,
  chapters: TxtToEpubChapter[]
): Promise<Buffer> {
  const zip = new JSZip()

  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>`)

  const chapterFiles = chapters.map((_, index) => chapterFilename(index))
  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i]
    const xhtml = buildChapterXhtml(chapter.title, chapter.content)
    zip.file(`OEBPS/${chapterFiles[i]}`, xhtml)
  }

  zip.file('OEBPS/style.css', STYLE_CSS)
  zip.file('OEBPS/content.opf', buildContentOpf(metadata, chapterFiles))
  zip.file('OEBPS/toc.ncx', buildTocNcx(metadata, chapters))

  const arrayBuffer = await zip.generateAsync({ type: 'arraybuffer' })
  return Buffer.from(arrayBuffer)
}
