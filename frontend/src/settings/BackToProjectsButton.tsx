import { ChevronLeft } from 'lucide-react'

interface BackToProjectsButtonProps {
  onClick: () => void
}

export function BackToProjectsButton({ onClick }: BackToProjectsButtonProps) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text"
    >
      <ChevronLeft size={14} />
      Back to projects
    </button>
  )
}
