import { Ghost } from 'lucide-react'

interface AvatarProps {
  name: string
  imageUrl?: string | null
  isGuest?: boolean
  size?: number
  className?: string
  title?: string
}

function initialsFromName(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (parts.length === 0) return '??'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
}

function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

function avatarPalette(seed: string): { bg: string; fg: string } {
  const hash = hashString(seed || 'composure')
  const hue = hash % 360
  const bg = `hsl(${hue} 58% 28%)`
  const fg = `hsl(${hue} 94% 82%)`
  return { bg, fg }
}

export function Avatar({ name, imageUrl, isGuest = false, size = 34, className = '', title }: AvatarProps) {
  const tooltipText = title ?? name

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={name}
        title={tooltipText}
        width={size}
        height={size}
        className={`rounded-full border border-cz-border object-cover ${className}`.trim()}
      />
    )
  }

  if (isGuest) {
    return (
      <div
        aria-label={name}
        title={tooltipText}
        className={`inline-flex select-none items-center justify-center rounded-full border border-cz-border bg-cz-surface text-cz-text-muted ${className}`.trim()}
        style={{
          width: size,
          height: size,
        }}
      >
        <Ghost size={Math.max(12, Math.floor(size * 0.5))} />
      </div>
    )
  }

  const initials = initialsFromName(name)
  const palette = avatarPalette(name)

  return (
    <div
      aria-label={name}
      title={tooltipText}
      className={`inline-flex select-none items-center justify-center rounded-full border border-cz-border text-xs font-semibold ${className}`.trim()}
      style={{
        width: size,
        height: size,
        background: palette.bg,
        color: palette.fg,
        fontSize: size * 0.4,
      }}
    >
      {initials}
    </div>
  )
}
