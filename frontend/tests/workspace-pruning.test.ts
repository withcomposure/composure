import { describe, expect, it } from 'vitest'
import {
  shouldEnableWorkspaceStatePersistence,
  shouldReconcileWorkspaceFromFileMap,
  shouldResetWorkspaceForProjectChange,
} from '../src/editor/workspace-state'

describe('workspace pruning guards', () => {
  it('only resets workspace defaults on true project changes', () => {
    expect(shouldResetWorkspaceForProjectChange('project-1', 'project-1')).toBe(false)
    expect(shouldResetWorkspaceForProjectChange('project-1', 'project-2')).toBe(true)
  })

  it('only reconciles tabs when initial sync is complete and connection is live', () => {
    expect(shouldReconcileWorkspaceFromFileMap(false, 'connected')).toBe(false)
    expect(shouldReconcileWorkspaceFromFileMap(true, 'connecting')).toBe(false)
    expect(shouldReconcileWorkspaceFromFileMap(true, 'disconnected')).toBe(false)
    expect(shouldReconcileWorkspaceFromFileMap(true, 'connected')).toBe(true)
  })

  it('only enables persistence after a successful non-cancelled load', () => {
    expect(shouldEnableWorkspaceStatePersistence(false, false)).toBe(false)
    expect(shouldEnableWorkspaceStatePersistence(true, true)).toBe(false)
    expect(shouldEnableWorkspaceStatePersistence(true, false)).toBe(true)
  })
})
