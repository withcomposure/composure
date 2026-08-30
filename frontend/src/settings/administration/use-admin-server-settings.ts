import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_SERVER_SETTINGS_FORM_STATE,
  toServerSettingsFormState,
  toServerSettingsPayload,
  type ServerSettings,
  type ServerSettingsFormState,
} from '../admin-utils'
import { fetchJson, getErrorMessage } from '@/utils/fetch'

export interface AdminServerSettings {
  form: ServerSettingsFormState
  updateField: <K extends keyof ServerSettingsFormState>(
    key: K,
    value: ServerSettingsFormState[K],
  ) => void
  dirty: boolean
  busy: boolean
  error: string | null
  save: () => Promise<void>
}

export function useAdminServerSettings(): AdminServerSettings {
  const [form, setForm] = useState<ServerSettingsFormState>(
    DEFAULT_SERVER_SETTINGS_FORM_STATE,
  )
  const [saved, setSaved] = useState<ServerSettingsFormState>(
    DEFAULT_SERVER_SETTINGS_FORM_STATE,
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    return fetchJson<ServerSettings>('/admin/server-settings')
      .then((response) => {
        const next = toServerSettingsFormState(response)
        setForm(next)
        setSaved(next)
      })
      .catch((err: unknown) => {
        setError(getErrorMessage(err))
      })
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const updateField = useCallback(
    <K extends keyof ServerSettingsFormState>(
      key: K,
      value: ServerSettingsFormState[K],
    ) => {
      setForm((prev) => ({ ...prev, [key]: value }))
    },
    [],
  )

  const save = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const payload = toServerSettingsPayload(form)
      const response = await fetchJson<ServerSettings>('/admin/server-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const next = toServerSettingsFormState(response)
      setForm(next)
      setSaved(next)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }, [form])

  const dirty =
    form.signupMode !== saved.signupMode ||
    form.guestSignupsEnabled !== saved.guestSignupsEnabled ||
    form.inviteExpiryHours !== saved.inviteExpiryHours ||
    form.passwordResetExpiryHours !== saved.passwordResetExpiryHours ||
    form.maxConcurrentJobs !== saved.maxConcurrentJobs ||
    form.defaultProjectLimitMode !== saved.defaultProjectLimitMode ||
    (form.defaultProjectLimitMode === 'on' &&
      form.defaultProjectLimitValue !== saved.defaultProjectLimitValue) ||
    form.maxUploadMode !== saved.maxUploadMode ||
    (form.maxUploadMode === 'on' && form.maxUploadValue !== saved.maxUploadValue) ||
    form.maxTextMode !== saved.maxTextMode ||
    (form.maxTextMode === 'on' && form.maxTextValue !== saved.maxTextValue) ||
    form.maxFilesMode !== saved.maxFilesMode ||
    (form.maxFilesMode === 'on' && form.maxFilesValue !== saved.maxFilesValue) ||
    form.trashRetentionDays !== saved.trashRetentionDays ||
    form.largeFileThreshold !== saved.largeFileThreshold ||
    form.chatHistoryRetentionMode !== saved.chatHistoryRetentionMode ||
    (form.chatHistoryRetentionMode === 'on' &&
      form.chatHistoryRetentionValue !== saved.chatHistoryRetentionValue)

  return { form, updateField, dirty, busy, error, save }
}
