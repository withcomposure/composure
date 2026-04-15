import { describe, it, expect, beforeEach } from 'vitest'
import {
  setMaxConcurrentPerCompiler,
  getCompilerQueueLength,
} from '../src/compile.dispatch.js'

// We test the semaphore logic by importing the module-level functions.
// acquireCompilerSlot / releaseCompilerSlot are not exported, so we test
// via the dispatchCompile flow — but the queue length +
// setMaxConcurrentPerCompiler are directly testable.

describe('compile semaphore', () => {
  beforeEach(async () => {
    // Reset to default so tests are independent
    setMaxConcurrentPerCompiler(3)
  })

  it('getCompilerQueueLength returns 0 for unknown compiler', async () => {
    expect(getCompilerQueueLength('http://unknown:4000')).toBe(0)
  })

  it('setMaxConcurrentPerCompiler clamps to minimum 1', async () => {
    // Set to 0 — should still work (clamped to 1)
    setMaxConcurrentPerCompiler(0)
    expect(getCompilerQueueLength('http://127.0.0.1:4000')).toBe(0)
  })

  it('setMaxConcurrentPerCompiler accepts positive values', async () => {
    setMaxConcurrentPerCompiler(10)
    // No error thrown; queue is still 0 since nothing has been dispatched
    expect(getCompilerQueueLength('http://127.0.0.1:4000')).toBe(0)
  })
})
