import { BASE_URL } from '@/api/client'

export async function downloadBook(bookId: string, title: string) {
  try {
    const res = await fetch(`${BASE_URL}/books/${bookId}/file`)
    if (!res.ok) return
    const blob = await res.blob()
    const safeName = title.replace(/[^\w　-〿＀-￯一-龥-]/g, '_')
    const ext = blob.type.includes('epub') ? 'epub' : blob.type.includes('plain') ? 'txt' : 'epub'
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${safeName}.${ext}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch {
    // download failed silently
  }
}
