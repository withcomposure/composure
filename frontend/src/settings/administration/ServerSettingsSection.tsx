import { Check, Infinity as InfinityIcon, Settings } from 'lucide-react'
import { NumberStepper } from '@/components/NumberStepper'
import { SegmentedControl } from '@/components/SegmentedControl'
import { ToggleSwitch } from '@/components/ToggleSwitch'
import type { AdminServerSettings } from './use-admin-server-settings'

const unlimitedOptionLabel = (
  <span className="inline-flex items-center justify-center" title="Unlimited">
    <InfinityIcon size={16} strokeWidth={2} className="block translate-y-0.5" aria-hidden="true" />
    <span className="sr-only">Unlimited</span>
  </span>
)

interface ServerSettingsSectionProps {
  settings: AdminServerSettings
  sectionRef: (node: HTMLElement | null) => void
}

export function ServerSettingsSection({ settings, sectionRef }: ServerSettingsSectionProps) {
  const { form, updateField, dirty, busy, error, save } = settings

  return (
    <section id="admin-section-server" ref={sectionRef} className="scroll-mt-6 rounded-xl border border-cz-border bg-cz-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Settings size={14} /> Server Settings
        </div>
        <button
          type="button"
          onClick={() => { void save() }}
          disabled={busy || !dirty}
          className={`inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs disabled:opacity-60 ${
            dirty
              ? 'border-transparent bg-cz-accent text-white hover:bg-cz-accent-hover'
              : 'border-cz-border bg-cz-bg text-cz-text-muted'
          }`}
        >
          {!dirty && <Check size={12} />}
          {busy ? 'Applying...' : dirty ? 'Apply Settings' : 'Saved'}
        </button>
      </div>
      <div className="overflow-hidden rounded-md border border-cz-border bg-cz-bg/50">
        <div className="flex items-center justify-between gap-3 px-3 py-3">
          <div className="min-w-0">
            <div className="text-sm text-cz-text">Signup mode</div>
            <div className="text-xs text-cz-text-muted">Open signups lets anyone create an account. Invite only requires a valid invite link.</div>
          </div>
          <SegmentedControl
            value={form.signupMode}
            options={[
              { value: 'open', label: 'Open' },
              { value: 'invite-only', label: 'Invite-Only' },
            ] as const}
            onChange={(value) => updateField('signupMode', value)}
            ariaLabel="Signup mode"
          />
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-cz-border px-3 py-3">
          <div className="min-w-0">
            <div className="text-sm text-cz-text">Guest access</div>
            <div className="text-xs text-cz-text-muted">Allow new visitors to continue as guest. Existing guests keep access when disabled.</div>
          </div>
          <ToggleSwitch
            checked={form.guestSignupsEnabled}
            onChange={(checked) => updateField('guestSignupsEnabled', checked)}
            ariaLabel="Guest access"
          />
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-cz-border px-3 py-3">
          <div className="min-w-0">
            <div className="text-sm text-cz-text">Invite link expiry (hours)</div>
            <div className="text-xs text-cz-text-muted">Default expiry for newly generated invite links. Default: 72.</div>
          </div>
          <NumberStepper
            value={form.inviteExpiryHours}
            min={1}
            max={8760}
            suffix="h"
            ariaLabel="Invite link expiry hours"
            onChange={(value) => updateField('inviteExpiryHours', value)}
          />
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-cz-border px-3 py-3">
          <div className="min-w-0">
            <div className="text-sm text-cz-text">Default project limits</div>
            <div className="text-xs text-cz-text-muted">Maximum projects a user can create. Can be overridden per-user. Applies to authenticated users only.</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {form.defaultProjectLimitMode === 'on' && (
              <NumberStepper
                value={form.defaultProjectLimitValue}
                min={1}
                max={10000}
                ariaLabel="Default project limit"
                onChange={(value) => updateField('defaultProjectLimitValue', value)}
              />
            )}
            <SegmentedControl
              value={form.defaultProjectLimitMode}
              options={[
                { value: 'on', label: 'On' },
                { value: 'unlimited', label: unlimitedOptionLabel },
              ] as const}
              onChange={(value) => updateField('defaultProjectLimitMode', value)}
              ariaLabel="Default project limit mode"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-cz-border px-3 py-3">
          <div className="min-w-0">
            <div className="text-sm text-cz-text">Password reset token expiry (hours)</div>
            <div className="text-xs text-cz-text-muted">Default is 24 hours. Range: 0.08 to 168 hours.</div>
          </div>
          <NumberStepper
            value={form.passwordResetExpiryHours}
            min={0.08}
            max={168}
            step={0.25}
            suffix="h"
            ariaLabel="Password reset expiry hours"
            allowDecimals
            onChange={(value) => updateField('passwordResetExpiryHours', value)}
          />
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-cz-border px-3 py-3">
          <div className="min-w-0">
            <div className="text-sm text-cz-text">Maximum concurrent jobs per compiler</div>
            <div className="text-xs text-cz-text-muted">How many compile jobs can run simultaneously on each compiler. Default: 3.</div>
          </div>
          <NumberStepper
            value={form.maxConcurrentJobs}
            min={1}
            max={50}
            ariaLabel="Maximum concurrent jobs"
            onChange={(value) => updateField('maxConcurrentJobs', value)}
          />
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-cz-border px-3 py-3">
          <div className="min-w-0">
            <div className="text-sm text-cz-text">Maximum upload file size (MB)</div>
            <div className="text-xs text-cz-text-muted">Limit for individual uploaded asset files. Default: 50 MB.</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {form.maxUploadMode === 'on' && (
              <NumberStepper
                value={form.maxUploadValue}
                min={1}
                max={500}
                suffix=" MB"
                widthClass="w-24"
                ariaLabel="Maximum upload file size MB"
                onChange={(value) => updateField('maxUploadValue', value)}
              />
            )}
            <SegmentedControl
              value={form.maxUploadMode}
              options={[
                { value: 'on', label: 'On' },
                { value: 'unlimited', label: unlimitedOptionLabel },
              ] as const}
              onChange={(value) => updateField('maxUploadMode', value)}
              ariaLabel="Upload file size limit mode"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-cz-border px-3 py-3">
          <div className="min-w-0">
            <div className="text-sm text-cz-text">Maximum text file size (MB)</div>
            <div className="text-xs text-cz-text-muted">Limit for individual text files in the editor. Default: 5 MB.</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {form.maxTextMode === 'on' && (
              <NumberStepper
                value={form.maxTextValue}
                min={1}
                max={100}
                suffix=" MB"
                widthClass="w-24"
                ariaLabel="Maximum text file size MB"
                onChange={(value) => updateField('maxTextValue', value)}
              />
            )}
            <SegmentedControl
              value={form.maxTextMode}
              options={[
                { value: 'on', label: 'On' },
                { value: 'unlimited', label: unlimitedOptionLabel },
              ] as const}
              onChange={(value) => updateField('maxTextMode', value)}
              ariaLabel="Text file size limit mode"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-cz-border px-3 py-3">
          <div className="min-w-0">
            <div className="text-sm text-cz-text">Maximum files per project</div>
            <div className="text-xs text-cz-text-muted">Limit on total files (text + assets) in a project. Default: 200.</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {form.maxFilesMode === 'on' && (
              <NumberStepper
                value={form.maxFilesValue}
                min={1}
                max={10000}
                ariaLabel="Maximum files per project"
                onChange={(value) => updateField('maxFilesValue', value)}
              />
            )}
            <SegmentedControl
              value={form.maxFilesMode}
              options={[
                { value: 'on', label: 'On' },
                { value: 'unlimited', label: unlimitedOptionLabel },
              ] as const}
              onChange={(value) => updateField('maxFilesMode', value)}
              ariaLabel="Files per project limit mode"
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-cz-border px-3 py-3">
          <div className="min-w-0">
            <div className="text-sm text-cz-text">Trash retention (days)</div>
            <div className="text-xs text-cz-text-muted">Deleted projects are permanently purged after this many days. Default: 30.</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <NumberStepper
              value={form.trashRetentionDays}
              min={1}
              max={365}
              ariaLabel="Trash retention days"
              onChange={(value) => updateField('trashRetentionDays', value)}
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-cz-border px-3 py-3">
          <div className="min-w-0">
            <div className="text-sm text-cz-text">Large file mode threshold (K chars)</div>
            <div className="text-xs text-cz-text-muted">Files above this character count open in lightweight mode with reduced editor features. Default: 500K.</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <NumberStepper
              value={form.largeFileThreshold}
              min={100}
              max={5000}
              step={100}
              suffix="K"
              ariaLabel="Large file mode threshold in thousands of characters"
              onChange={(value) => updateField('largeFileThreshold', value)}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-cz-border px-3 py-3">
          <div className="min-w-0">
            <div className="text-sm text-cz-text">Chat history retention (days)</div>
            <div className="text-xs text-cz-text-muted">Controls how long project chat messages are kept. Choose Off for session-only chat that is discarded when everyone leaves.</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {form.chatHistoryRetentionMode === 'on' && (
              <NumberStepper
                value={form.chatHistoryRetentionValue}
                min={1}
                max={3650}
                suffix="d"
                ariaLabel="Chat history retention days"
                onChange={(value) => updateField('chatHistoryRetentionValue', value)}
              />
            )}
            <SegmentedControl
              value={form.chatHistoryRetentionMode}
              options={[
                { value: 'on', label: 'On' },
                { value: 'off', label: 'Off' },
                { value: 'unlimited', label: unlimitedOptionLabel },
              ] as const}
              onChange={(value) => updateField('chatHistoryRetentionMode', value)}
              ariaLabel="Chat history retention mode"
            />
          </div>
        </div>
      </div>
      {error && <div className="mt-2 text-sm text-red-300">{error}</div>}
    </section>
  )
}
