import { describe, it, expect, beforeEach } from 'vitest'
import { createTestApp, createTestUser } from './helpers/setup.js'
import { getUserPreferences, updateUserPreferences } from '../src/db/preferences.js'

describe('user preferences', () => {
  let userId: string

  beforeEach(async () => {
    await createTestApp()
    const user = await createTestUser()
    userId = user.id
  })

  it('returns defaults for null userId', async () => {
    const prefs = await getUserPreferences(null)
    expect(prefs.autoSaveOnCompile).toBe(true)
    expect(prefs.autoSaveOnExport).toBe(true)
    expect(prefs.autoCompileTimeoutSeconds).toBe(2)
    expect(prefs.autoVersionIntervalMinutes).toBe(5)
    expect(prefs.editorBraceMatching).toBe(true)
    expect(prefs.editorHighlightSelectionMatches).toBe(true)
    expect(prefs.editorInEditorFind).toBe(true)
    expect(prefs.editorAutocomplete).toBe(true)
    expect(prefs.editorAutoCloseLatexBeginEnd).toBe(true)
  })

  it('returns defaults for non-existent userId', async () => {
    const prefs = await getUserPreferences(userId)
    expect(prefs.autoSaveOnCompile).toBe(true)
    expect(prefs.autoSaveOnExport).toBe(true)
    expect(prefs.autoCompileTimeoutSeconds).toBe(2)
    expect(prefs.editorBraceMatching).toBe(true)
    expect(prefs.editorHighlightSelectionMatches).toBe(true)
    expect(prefs.editorInEditorFind).toBe(true)
    expect(prefs.editorAutocomplete).toBe(true)
    expect(prefs.editorAutoCloseLatexBeginEnd).toBe(true)
  })

  describe('editor feature flags', () => {
    it('persists toggled editor preferences', async () => {
      await updateUserPreferences(userId, {
        editorBraceMatching: false,
        editorHighlightSelectionMatches: false,
        editorInEditorFind: false,
        editorAutocomplete: false,
        editorAutoCloseLatexBeginEnd: false,
      })

      const prefs = await getUserPreferences(userId)
      expect(prefs.editorBraceMatching).toBe(false)
      expect(prefs.editorHighlightSelectionMatches).toBe(false)
      expect(prefs.editorInEditorFind).toBe(false)
      expect(prefs.editorAutocomplete).toBe(false)
      expect(prefs.editorAutoCloseLatexBeginEnd).toBe(false)
    })
  })

  describe('autoSaveOnCompile', () => {
    it('persists false', async () => {
      await updateUserPreferences(userId, { autoSaveOnCompile: false })
      const prefs = await getUserPreferences(userId)
      expect(prefs.autoSaveOnCompile).toBe(false)
    })

    it('persists true', async () => {
      await updateUserPreferences(userId, { autoSaveOnCompile: false })
      await updateUserPreferences(userId, { autoSaveOnCompile: true })
      const prefs = await getUserPreferences(userId)
      expect(prefs.autoSaveOnCompile).toBe(true)
    })
  })

  describe('autoSaveOnExport', () => {
    it('persists false', async () => {
      await updateUserPreferences(userId, { autoSaveOnExport: false })
      const prefs = await getUserPreferences(userId)
      expect(prefs.autoSaveOnExport).toBe(false)
    })

    it('persists true', async () => {
      await updateUserPreferences(userId, { autoSaveOnExport: false })
      await updateUserPreferences(userId, { autoSaveOnExport: true })
      const prefs = await getUserPreferences(userId)
      expect(prefs.autoSaveOnExport).toBe(true)
    })
  })

  describe('autoCompileTimeoutSeconds', () => {
    it('persists valid value', async () => {
      await updateUserPreferences(userId, { autoCompileTimeoutSeconds: 5 })
      const prefs = await getUserPreferences(userId)
      expect(prefs.autoCompileTimeoutSeconds).toBe(5)
    })

    it('clamps to minimum of 1', async () => {
      await updateUserPreferences(userId, { autoCompileTimeoutSeconds: 0 })
      const prefs = await getUserPreferences(userId)
      expect(prefs.autoCompileTimeoutSeconds).toBe(1)
    })

    it('clamps to maximum of 30', async () => {
      await updateUserPreferences(userId, { autoCompileTimeoutSeconds: 100 })
      const prefs = await getUserPreferences(userId)
      expect(prefs.autoCompileTimeoutSeconds).toBe(30)
    })

    it('floors fractional values', async () => {
      await updateUserPreferences(userId, { autoCompileTimeoutSeconds: 3.7 })
      const prefs = await getUserPreferences(userId)
      expect(prefs.autoCompileTimeoutSeconds).toBe(3)
    })
  })

  describe('autoVersionIntervalMinutes', () => {
    it('persists 0 as disabled', async () => {
      await updateUserPreferences(userId, { autoVersionIntervalMinutes: 0 })
      const prefs = await getUserPreferences(userId)
      expect(prefs.autoVersionIntervalMinutes).toBe(0)
    })

    it('clamps to max 60', async () => {
      await updateUserPreferences(userId, { autoVersionIntervalMinutes: 120 })
      const prefs = await getUserPreferences(userId)
      expect(prefs.autoVersionIntervalMinutes).toBe(60)
    })
  })

  it('preserves unrelated fields when updating', async () => {
    await updateUserPreferences(userId, {
      autoCompileDefault: true,
      autoCompileTimeoutSeconds: 5,
      autoSaveOnCompile: false,
      autoSaveOnExport: false,
      editorBraceMatching: false,
      editorHighlightSelectionMatches: false,
      editorInEditorFind: false,
      editorAutocomplete: false,
      editorAutoCloseLatexBeginEnd: false,
    })

    // Update only one field
    await updateUserPreferences(userId, { autoCompileTimeoutSeconds: 10 })

    const prefs = await getUserPreferences(userId)
    expect(prefs.autoCompileDefault).toBe(true)
    expect(prefs.autoCompileTimeoutSeconds).toBe(10)
    expect(prefs.autoSaveOnCompile).toBe(false)
    expect(prefs.autoSaveOnExport).toBe(false)
    expect(prefs.editorBraceMatching).toBe(false)
    expect(prefs.editorHighlightSelectionMatches).toBe(false)
    expect(prefs.editorInEditorFind).toBe(false)
    expect(prefs.editorAutocomplete).toBe(false)
    expect(prefs.editorAutoCloseLatexBeginEnd).toBe(false)
  })
})
