import { AsyncLocalStorage } from 'node:async_hooks'
import type postgres from 'postgres'

export type RequestUserRole = 'user' | 'admin' | 'guest' | 'system' | null

interface RequestContextStore {
  userId: string | null
  userRole: RequestUserRole
  tx?: postgres.TransactionSql
}

const requestContext = new AsyncLocalStorage<RequestContextStore>()

export function beginRequestContext(): void {
  requestContext.enterWith({ userId: null, userRole: null })
}

export function getRequestContext(): RequestContextStore | undefined {
  return requestContext.getStore()
}

export function setRequestIdentity(userId: string | null, userRole: RequestUserRole): void {
  const store = requestContext.getStore()
  if (!store) {
    return
  }

  store.userId = userId
  store.userRole = userRole
}

export async function runWithTransactionContext<T>(tx: postgres.TransactionSql, fn: () => Promise<T>): Promise<T> {
  const store = requestContext.getStore()
  if (!store) {
    return await fn()
  }

  return await requestContext.run({ ...store, tx }, fn)
}

export async function runWithIdentityContext<T>(
  userId: string | null,
  userRole: RequestUserRole,
  fn: () => Promise<T>,
): Promise<T> {
  const existing = requestContext.getStore()
  if (existing) {
    return await requestContext.run({ ...existing, userId, userRole }, fn)
  }

  return await requestContext.run({ userId, userRole }, fn)
}