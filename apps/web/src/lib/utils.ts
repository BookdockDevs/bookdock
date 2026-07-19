export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ')
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export function formatDate(ts: number): string {
  const d = new Date(ts)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function blendColors(hex1: string, hex2: string, ratio: number): string {
  const r1 = Number.parseInt(hex1.slice(1, 3), 16)
  const g1 = Number.parseInt(hex1.slice(3, 5), 16)
  const b1 = Number.parseInt(hex1.slice(5, 7), 16)
  const r2 = Number.parseInt(hex2.slice(1, 3), 16)
  const g2 = Number.parseInt(hex2.slice(3, 5), 16)
  const b2 = Number.parseInt(hex2.slice(5, 7), 16)
  const r = Math.round(r1 + (r2 - r1) * ratio)
  const g = Math.round(g1 + (g2 - g1) * ratio)
  const b = Math.round(b1 + (b2 - b1) * ratio)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}