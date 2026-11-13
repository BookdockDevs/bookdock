/** Registry of the builtin CDN fonts, shared by the web reader (which renders
 *  them) and the server (which proxies their bytes and locks the upstream
 *  paths it is willing to fetch). The web layer composes the final CSS stack
 *  and absolute proxy URLs; this module only states the upstream facts. */
export interface BuiltinFont {
  id: string
  name: string
  /** Unquoted CSS family name as declared by the upstream stylesheet */
  familyName: string
  /** npm package published on the upstream CDN */
  upstreamPackage: string
  /** Pinned package version; part of every proxy URL so a version bump
   *  changes the address instead of mutating content under a stable URL */
  version: string
  /** CSS entry path inside the package */
  upstreamCssPath: string
  /** Generic family the upstream face ends its stack with */
  generic: 'serif' | 'sans-serif'
  license: { name: string; url: string }
  /** Latin-first entries pair with a CJK companion instead of covering CJK */
  latin?: boolean
}

export const BUILTIN_FONTS: BuiltinFont[] = [
  {
    id: 'lxgw-wenkai',
    name: '霞鹜文楷',
    familyName: 'LXGW WenKai',
    upstreamPackage: 'lxgw-wenkai-webfont',
    version: '1.7.0',
    upstreamCssPath: 'style.css',
    generic: 'serif',
    license: { name: 'OFL-1.1', url: 'https://github.com/lxgw/LxgwWenKai/blob/main/LICENSE' },
  },
  {
    id: 'noto-serif-sc',
    name: '思源宋体',
    // Variable package: fontsource's static index.css ships weight 400 only,
    // so the reader's fontWeight would synthesize faux bold
    familyName: 'Noto Serif SC Variable',
    upstreamPackage: '@fontsource-variable/noto-serif-sc',
    version: '5.3.0',
    upstreamCssPath: 'index.css',
    generic: 'serif',
    license: { name: 'OFL-1.1', url: 'https://fonts.google.com/noto/specimen/Noto+Serif+SC/license' },
  },
  {
    id: 'noto-sans-sc',
    name: '思源黑体',
    familyName: 'Noto Sans SC Variable',
    upstreamPackage: '@fontsource-variable/noto-sans-sc',
    version: '5.3.0',
    upstreamCssPath: 'index.css',
    generic: 'sans-serif',
    license: { name: 'OFL-1.1', url: 'https://fonts.google.com/noto/specimen/Noto+Sans+SC/license' },
  },
  {
    id: 'literata',
    name: 'Literata',
    latin: true,
    familyName: 'Literata Variable',
    upstreamPackage: '@fontsource-variable/literata',
    version: '5.3.0',
    upstreamCssPath: 'index.css',
    generic: 'serif',
    license: { name: 'OFL-1.1', url: 'https://fonts.google.com/specimen/Literata/license' },
  },
]

export function findBuiltinFont(id: string, version: string): BuiltinFont | undefined {
  return BUILTIN_FONTS.find((font) => font.id === id && font.version === version)
}
