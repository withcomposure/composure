import { useCallback, useEffect, useState } from 'react'
import { Check, Eye, EyeOff, Lock, Mail, Send, Shield } from 'lucide-react'
import { IconDropdown } from '@/components/IconDropdown'
import { NumberStepper } from '@/components/NumberStepper'
import { fetchJson, getErrorMessage } from '@/utils/fetch'

interface SmtpSettingsMasked {
  host: string
  port: number
  username: string
  hasPassword: boolean
  senderName: string
  senderAddress: string
  encryption: 'none' | 'starttls' | 'tls'
}

type EncryptionOption = 'none' | 'starttls' | 'tls'

const encryptionOptions: Array<{ value: EncryptionOption; label: string; icon: typeof Lock }> = [
  { value: 'none', label: 'None', icon: Shield },
  { value: 'starttls', label: 'STARTTLS', icon: Lock },
  { value: 'tls', label: 'TLS/SSL', icon: Lock },
]

interface EmailSettingsSectionProps {
  sectionRef: (node: HTMLElement | null) => void
}

export function EmailSettingsSection({ sectionRef }: EmailSettingsSectionProps) {
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState(587)
  const [smtpUsername, setSmtpUsername] = useState('')
  const [smtpPassword, setSmtpPassword] = useState('')
  const [smtpHasPassword, setSmtpHasPassword] = useState(false)
  const [smtpSenderName, setSmtpSenderName] = useState('')
  const [smtpSenderAddress, setSmtpSenderAddress] = useState('')
  const [smtpEncryption, setSmtpEncryption] = useState<EncryptionOption>('starttls')
  const [smtpBusy, setSmtpBusy] = useState(false)
  const [smtpError, setSmtpError] = useState<string | null>(null)
  const [smtpShowPassword, setSmtpShowPassword] = useState(false)
  const [smtpSaved, setSmtpSaved] = useState({ host: '', port: 587, username: '', senderName: '', senderAddress: '', encryption: 'starttls' as EncryptionOption })
  const [testEmailTo, setTestEmailTo] = useState('')
  const [testEmailBusy, setTestEmailBusy] = useState(false)
  const [testEmailResult, setTestEmailResult] = useState<{ ok: boolean; message: string } | null>(null)

  const loadSmtpSettings = useCallback(() => {
    return fetchJson<SmtpSettingsMasked>('/admin/smtp')
      .then((response) => {
        setSmtpHost(response.host)
        setSmtpPort(response.port)
        setSmtpUsername(response.username)
        setSmtpHasPassword(response.hasPassword)
        setSmtpSenderName(response.senderName)
        setSmtpSenderAddress(response.senderAddress)
        setSmtpEncryption(response.encryption)
        setSmtpSaved({ host: response.host, port: response.port, username: response.username, senderName: response.senderName, senderAddress: response.senderAddress, encryption: response.encryption })
      })
      .catch((err: unknown) => {
        setSmtpError(getErrorMessage(err))
      })
  }, [])

  useEffect(() => {
    void loadSmtpSettings()
  }, [loadSmtpSettings])

  const saveSmtpSettings = useCallback(async () => {
    setSmtpBusy(true)
    setSmtpError(null)
    try {
      const response = await fetchJson<SmtpSettingsMasked>('/admin/smtp', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: smtpHost,
          port: smtpPort,
          username: smtpUsername,
          password: smtpPassword || undefined,
          senderName: smtpSenderName,
          senderAddress: smtpSenderAddress,
          encryption: smtpEncryption,
        }),
      })
      setSmtpHost(response.host)
      setSmtpPort(response.port)
      setSmtpUsername(response.username)
      setSmtpHasPassword(response.hasPassword)
      setSmtpSenderName(response.senderName)
      setSmtpSenderAddress(response.senderAddress)
      setSmtpEncryption(response.encryption)
      setSmtpPassword('')
      setSmtpSaved({ host: response.host, port: response.port, username: response.username, senderName: response.senderName, senderAddress: response.senderAddress, encryption: response.encryption })
    } catch (err) {
      setSmtpError(getErrorMessage(err))
    } finally {
      setSmtpBusy(false)
    }
  }, [smtpHost, smtpPort, smtpUsername, smtpPassword, smtpSenderName, smtpSenderAddress, smtpEncryption])

  const sendTestEmail = useCallback(async () => {
    setTestEmailBusy(true)
    setTestEmailResult(null)
    try {
      await fetchJson<{ ok: boolean }>('/admin/smtp/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testEmailTo.trim().toLowerCase() }),
      })
      setTestEmailResult({ ok: true, message: 'Test email sent successfully.' })
    } catch (err) {
      setTestEmailResult({ ok: false, message: getErrorMessage(err) })
    } finally {
      setTestEmailBusy(false)
    }
  }, [testEmailTo])

  const smtpDirty = smtpHost !== smtpSaved.host || smtpPort !== smtpSaved.port || smtpUsername !== smtpSaved.username || smtpSenderName !== smtpSaved.senderName || smtpSenderAddress !== smtpSaved.senderAddress || smtpEncryption !== smtpSaved.encryption || smtpPassword !== ''
  const smtpAllFilled = smtpHost.trim() !== '' && smtpPort > 0 && smtpUsername.trim() !== '' && smtpSenderName.trim() !== '' && smtpSenderAddress.trim() !== '' && (smtpHasPassword || smtpPassword.trim() !== '')

  return (
    <section id="admin-section-email" ref={sectionRef} className="scroll-mt-6 rounded-xl border border-cz-border bg-cz-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Mail size={14} /> Email (SMTP)
        </div>
        <button
          type="button"
          onClick={() => { void saveSmtpSettings() }}
          disabled={smtpBusy || !smtpDirty}
          className={`inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs disabled:opacity-60 ${
            smtpDirty
              ? 'border-transparent bg-cz-accent text-white hover:bg-cz-accent-hover'
              : 'border-cz-border bg-cz-bg text-cz-text-muted'
          }`}
        >
          {!smtpDirty && <Check size={12} />}
          {smtpBusy ? 'Applying...' : smtpDirty ? 'Apply Settings' : 'Saved'}
        </button>
      </div>

      <div className="overflow-hidden rounded-md border border-cz-border bg-cz-bg/50">
        {/* Host + Port */}
        <div className="flex items-center gap-3 px-3 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-cz-text">Host</div>
            <div className="text-xs text-cz-text-muted">SMTP server hostname</div>
          </div>
          <input
            type="text"
            value={smtpHost}
            onChange={(e) => setSmtpHost(e.target.value)}
            placeholder="smtp.example.com"
            className="h-8 w-42 shrink-0 rounded-md border border-cz-border bg-cz-bg px-3 text-sm text-cz-text outline-none focus:border-cz-accent"
          />
          <NumberStepper
            value={smtpPort}
            min={1}
            max={65535}
            ariaLabel="SMTP port"
            onChange={setSmtpPort}
          />
        </div>

        {/* Encryption */}
        <div className="flex items-center justify-between gap-3 border-t border-cz-border px-3 py-3">
          <div className="min-w-0">
            <div className="text-xs font-medium text-cz-text">Encryption</div>
            <div className="text-xs text-cz-text-muted">
              It is recommended to use the best encryption method supported by your SMTP server.{' '}
              <strong>STARTTLS</strong> (e.g., port 587) upgrades to TLS after connecting.{' '}
              <strong>TLS/SSL</strong> (e.g., port 465) is encrypted from the start.
            </div>
          </div>
          <IconDropdown value={smtpEncryption} options={encryptionOptions} onChange={setSmtpEncryption} />
        </div>

        {/* Username */}
        <div className="flex items-center justify-between gap-3 border-t border-cz-border px-3 py-3">
          <div className="min-w-0">
            <div className="text-xs font-medium text-cz-text">Username</div>
            <div className="text-xs text-cz-text-muted">Authentication username (often your email)</div>
          </div>
          <input
            type="text"
            value={smtpUsername}
            onChange={(e) => setSmtpUsername(e.target.value)}
            placeholder="user@example.com"
            className="h-8 w-69 shrink-0 rounded-md border border-cz-border bg-cz-bg px-3 text-sm text-cz-text outline-none focus:border-cz-accent"
          />
        </div>

        {/* Password */}
        <div className="flex items-center justify-between gap-3 border-t border-cz-border px-3 py-3">
          <div className="min-w-0">
            <div className="text-xs font-medium text-cz-text">Password</div>
            <div className="text-xs text-cz-text-muted">
              {smtpHasPassword ? 'A password is saved. Leave blank to keep it unchanged.' : 'No password set.'}
            </div>
          </div>
          <div className="relative shrink-0">
            <input
              type={smtpShowPassword ? 'text' : 'password'}
              value={smtpPassword}
              onChange={(e) => setSmtpPassword(e.target.value)}
              placeholder={smtpHasPassword ? '••••••••' : 'Enter password'}
              className="h-8 w-69 rounded-md border border-cz-border bg-cz-bg px-3 pr-9 text-sm text-cz-text outline-none focus:border-cz-accent"
            />
            <button
              type="button"
              onClick={() => setSmtpShowPassword((prev) => !prev)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-cz-text-muted hover:text-cz-text"
              tabIndex={-1}
            >
              {smtpShowPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        {/* Sender Name + Sender Address */}
        <div className="flex items-center gap-3 border-t border-cz-border px-3 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-cz-text">Sender Name &amp; Address</div>
            <div className="text-xs text-cz-text-muted">Display name for outgoing emails</div>
          </div>
          <input
            type="text"
            value={smtpSenderName}
            onChange={(e) => setSmtpSenderName(e.target.value)}
            placeholder="Composure"
            className="h-8 w-28 shrink-0 rounded-md border border-cz-border bg-cz-bg px-3 text-sm text-cz-text outline-none focus:border-cz-accent"
          />
          <input
            type="text"
            value={smtpSenderAddress}
            onChange={(e) => setSmtpSenderAddress(e.target.value)}
            placeholder="noreply@example.com"
            className="h-8 w-48 shrink-0 rounded-md border border-cz-border bg-cz-bg px-3 text-sm text-cz-text outline-none focus:border-cz-accent"
          />
        </div>

        {/* Test Email */}
        <div className="flex items-center gap-3 border-t border-cz-border px-3 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-cz-text">Test Email</div>
            <div className="text-xs text-cz-text-muted">Once you've saved your settings, you can send a test email.</div>
          </div>
          <input
            type="text"
            value={testEmailTo}
            onChange={(e) => setTestEmailTo(e.target.value)}
            placeholder="recipient@example.com"
            className="h-8 w-48 shrink-0 rounded-md border border-cz-border bg-cz-bg px-3 text-sm text-cz-text outline-none focus:border-cz-accent"
          />
          <button
            type="button"
            onClick={() => { void sendTestEmail() }}
            disabled={testEmailBusy || !testEmailTo.trim() || smtpDirty || !smtpAllFilled}
            className="inline-flex h-8 shrink-0 items-center gap-2 rounded-md bg-cz-accent px-3 text-sm text-white hover:bg-cz-accent-hover disabled:opacity-60"
          >
            <Send size={14} />
            {testEmailBusy ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>

      {smtpError && <div className="mt-2 text-sm text-red-300">{smtpError}</div>}
      {testEmailResult && (
        <div className={`mt-2 text-sm ${testEmailResult.ok ? 'text-green-400' : 'text-red-300'}`}>
          {testEmailResult.message}
        </div>
      )}
    </section>
  )
}
