interface ToggleSwitchProps {
  checked: boolean
  disabled?: boolean
  onChange: (nextChecked: boolean) => void
  ariaLabel: string
}

export function ToggleSwitch({ checked, disabled = false, onChange, ariaLabel }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 flex-shrink-0 rounded-full border transition-colors duration-200 ${
        checked ? 'border-transparent bg-pm-accent' : 'border-pm-accent bg-pm-bg'
      } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
    >
      <span
        className={`absolute left-0 top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-transform duration-200 ${
          checked ? 'translate-x-[18px]' : 'translate-x-[2px]'
        }`}
      />
    </button>
  )
}
