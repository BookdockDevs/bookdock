// Minimal hex color helpers — hand-rolled to avoid a runtime dependency.

export function parseHex(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const num = Number.parseInt(h, 16)
  if (Number.isNaN(num) || h.length !== 6) throw new Error(`invalid hex color: ${hex}`)
  return [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff]
}

export function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = parseHex(hex).map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return { h: h * 60, s, l }
}

export function hslToHex(h: number, s: number, l: number): string {
  const hue = (((h % 360) + 360) % 360) / 60
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((hue % 2) - 1))
  const m = l - c / 2
  let rgb: [number, number, number]
  if (hue < 1) rgb = [c, x, 0]
  else if (hue < 2) rgb = [x, c, 0]
  else if (hue < 3) rgb = [0, c, x]
  else if (hue < 4) rgb = [0, x, c]
  else if (hue < 5) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  return toHex((rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255)
}

// weight = share of hexB in the result (0 → hexA, 1 → hexB)
export function mix(hexA: string, hexB: string, weight: number): string {
  const [r1, g1, b1] = parseHex(hexA)
  const [r2, g2, b2] = parseHex(hexB)
  const w = Math.max(0, Math.min(1, weight))
  return toHex(r1 + (r2 - r1) * w, g1 + (g2 - g1) * w, b1 + (b2 - b1) * w)
}

// percent: 0–100
export function lighten(hex: string, percent: number): string {
  return mix(hex, '#ffffff', percent / 100)
}

export function darken(hex: string, percent: number): string {
  return mix(hex, '#000000', percent / 100)
}

// WCAG relative luminance (0–1)
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function isDark(hex: string): boolean {
  return relativeLuminance(hex) < 0.5
}
