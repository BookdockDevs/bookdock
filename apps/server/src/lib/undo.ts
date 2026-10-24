import { randomUUID } from 'node:crypto'

import { AppError } from '../middleware/error'

export const UNDO_RECEIPT_TTL_MS = 120_000

interface UndoReceipt {
  userId: string
  expiresAt: number
  generation: number
  restore: () => void
  running: boolean
}

const receipts = new Map<string, UndoReceipt>()
const latestByUser = new Map<string, string>()
const completed = new Map<string, { userId: string; expiresAt: number }>()
const generationByUser = new Map<string, number>()

export function issueUndoReceipt(userId: string, restore: () => void): string {
  const now = Date.now()
  for (const [key, receipt] of receipts) if (receipt.expiresAt <= now) receipts.delete(key)
  for (const [key, receipt] of completed) if (receipt.expiresAt <= now) completed.delete(key)
  const previous = latestByUser.get(userId)
  if (previous) receipts.delete(previous)
  const token = randomUUID()
  const expiresAt = Date.now() + UNDO_RECEIPT_TTL_MS
  const generation = (generationByUser.get(userId) ?? 0) + 1
  generationByUser.set(userId, generation)
  receipts.set(token, { userId, expiresAt, generation, restore, running: false })
  latestByUser.set(userId, token)
  return token
}

export function getUndoReceiptInfo(token: string): { expiresAt: number; generation: number } | undefined {
  const receipt = receipts.get(token)
  return receipt ? { expiresAt: receipt.expiresAt, generation: receipt.generation } : undefined
}

export async function executeUndoReceipt(userId: string, token: string): Promise<void> {
  const completedReceipt = completed.get(token)
  if (completedReceipt?.userId === userId && completedReceipt.expiresAt > Date.now()) return
  const receipt = receipts.get(token)
  if (!receipt || latestByUser.get(userId) !== token || receipt.userId !== userId || receipt.expiresAt <= Date.now()) {
    if (receipt?.expiresAt && receipt.expiresAt <= Date.now()) receipts.delete(token)
    throw new AppError('UNDO_UNAVAILABLE', 'This undo action has expired')
  }
  if (receipt.running) throw new AppError('UNDO_UNAVAILABLE', 'This undo action is already running')
  receipt.running = true
  try {
    receipt.restore()
    receipts.delete(token)
    latestByUser.delete(userId)
    completed.set(token, { userId, expiresAt: Date.now() + UNDO_RECEIPT_TTL_MS })
  } catch (error) {
    receipt.running = false
    if (error instanceof AppError && error.code === 'UNDO_CONFLICT') {
      receipts.delete(token)
      latestByUser.delete(userId)
    } else {
      receipt.expiresAt = Date.now() + UNDO_RECEIPT_TTL_MS
    }
    throw error
  }
}
