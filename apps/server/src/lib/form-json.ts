import { AppError } from '../middleware/error'

/**
 * Read a JSON-encoded field out of a multipart form body.
 *
 * Multipart bodies are flat strings, so an array field (a category path, a tag
 * list) travels as JSON text. Absent stays absent — the difference between
 * "leave it alone" and "clear it" is carried by the contract, not by this
 * helper, which only refuses text that is not the JSON it claims to be.
 */
export function parseFormJson(raw: unknown, label: string): unknown {
  if (raw === undefined || raw === null || raw === '') return undefined
  if (typeof raw !== 'string') throw new AppError('VALIDATION_ERROR', `Invalid ${label}`)
  try {
    return JSON.parse(raw)
  } catch {
    throw new AppError('VALIDATION_ERROR', `Invalid ${label}`)
  }
}
