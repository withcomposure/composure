import { createElement, useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect } from 'react'
import {
  Bold,
  ChevronDown,
  Code,
  Ellipsis,
  FileCode,
  Heading,
  Image,
  Italic,
  Link,
  List,
  MessageSquare,
  Minus,
  Quote,
  Sigma,
  Table,
  Underline,
  type LucideIcon,
} from 'lucide-react'
import type { EditorView } from '@codemirror/view'
import type { EditorLanguage } from './editor-completion'
import type { Snippet, SnippetGroup, ToolbarSlot } from './snippets/types'
import { getAdapter } from './snippets/adapters/registry'
import { applySnippet } from './snippets/engine'

// ── Icon lookup ──────────────────────────────────────────────────────────────

const ICON_MAP: Record<string, LucideIcon> = {
  Bold,
  Italic,
  Underline,
  Code,
  FileCode,
  Link,
  Image,
  Quote,
  Table,
  MessageSquare,
  Minus,
  Heading,
  List,
  Sigma,
}

function slotKey(slot: ToolbarSlot): string {
  return typeof slot === 'string' ? `snippet:${slot}` : `group:${slot.id}`
}

function renderIcon(iconName: string | undefined, label: string) {
  const IconComponent = iconName ? ICON_MAP[iconName] : undefined
  if (IconComponent) {
    return createElement(IconComponent, { size: 15, strokeWidth: 1.8 })
  }
  return <span className="text-[11px] font-medium">{label}</span>
}

function renderMenuIcon(iconName: string | undefined) {
  const IconComponent = iconName ? ICON_MAP[iconName] : undefined
  if (!IconComponent) {
    return null
  }
  return createElement(IconComponent, { size: 13, strokeWidth: 1.8 })
}

function snippetsForSlot(slot: ToolbarSlot, snippetMap: Map<string, Snippet>): Snippet[] {
  if (typeof slot === 'string') {
    const snippet = snippetMap.get(slot)
    return snippet ? [snippet] : []
  }

  return slot.snippetIds.map((id) => snippetMap.get(id)).filter(Boolean) as Snippet[]
}

// ── Sub-components ───────────────────────────────────────────────────────────

function ToolbarButton({
  snippet,
  disabled,
  onApply,
}: {
  snippet: Snippet
  disabled: boolean
  onApply: (snippet: Snippet) => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onApply(snippet)}
      className="flex items-center justify-center rounded p-1.5 text-pm-text-muted transition-colors hover:bg-pm-surface-hover hover:text-pm-text disabled:opacity-40 disabled:pointer-events-none"
      title={snippet.label}
      aria-label={snippet.label}
    >
      {renderIcon(snippet.icon, snippet.label)}
    </button>
  )
}

function GroupDropdown({
  group,
  snippetMap,
  disabled,
  onApply,
}: {
  group: SnippetGroup
  snippetMap: Map<string, Snippet>
  disabled: boolean
  onApply: (snippet: Snippet) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handle = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', handle, true)
    return () => window.removeEventListener('pointerdown', handle, true)
  }, [open])

  const snippets = group.snippetIds.map((id) => snippetMap.get(id)).filter(Boolean) as Snippet[]
  if (snippets.length === 0) return null

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-0.5 rounded p-1.5 text-pm-text-muted transition-colors hover:bg-pm-surface-hover hover:text-pm-text disabled:opacity-40 disabled:pointer-events-none"
        title={group.label}
        aria-label={group.label}
        aria-expanded={open}
      >
        {renderIcon(group.icon, group.label)}
        <ChevronDown size={10} className="ml-px opacity-60" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[140px] rounded-lg border border-pm-border bg-pm-surface p-1 shadow-xl">
          {snippets.map((snippet) => {
            return (
              <button
                key={snippet.id}
                type="button"
                onClick={() => {
                  onApply(snippet)
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-pm-text-muted hover:bg-pm-surface-hover hover:text-pm-text"
              >
                {renderMenuIcon(snippet.icon)}
                {snippet.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function OverflowMenu({
  snippets,
  disabled,
  onApply,
}: {
  snippets: Snippet[]
  disabled: boolean
  onApply: (snippet: Snippet) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handle = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', handle, true)
    return () => window.removeEventListener('pointerdown', handle, true)
  }, [open])

  if (snippets.length === 0) return null

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center justify-center rounded p-1.5 text-pm-text-muted transition-colors hover:bg-pm-surface-hover hover:text-pm-text disabled:opacity-40 disabled:pointer-events-none"
        title="More actions"
        aria-label="More actions"
        aria-expanded={open}
      >
        <Ellipsis size={15} strokeWidth={1.8} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-lg border border-pm-border bg-pm-surface p-1 shadow-xl">
          {snippets.map((snippet) => {
            return (
              <button
                key={snippet.id}
                type="button"
                onClick={() => {
                  onApply(snippet)
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-pm-text-muted hover:bg-pm-surface-hover hover:text-pm-text"
              >
                {renderMenuIcon(snippet.icon)}
                {snippet.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function MeasureSlot({
  slot,
  snippetMap,
}: {
  slot: ToolbarSlot
  snippetMap: Map<string, Snippet>
}) {
  if (typeof slot === 'string') {
    const snippet = snippetMap.get(slot)
    if (!snippet) return null
    return (
      <button
        type="button"
        className="flex items-center justify-center rounded p-1.5 text-pm-text-muted"
        tabIndex={-1}
      >
        {renderIcon(snippet.icon, snippet.label)}
      </button>
    )
  }

  return (
    <button
      type="button"
      className="flex items-center gap-0.5 rounded p-1.5 text-pm-text-muted"
      tabIndex={-1}
    >
      {renderIcon(slot.icon, slot.label)}
      <ChevronDown size={10} className="ml-px opacity-60" />
    </button>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────

interface FormatToolbarProps {
  language: EditorLanguage
  editorViewRef: React.RefObject<EditorView | null>
  disabled: boolean
}

const TOOLBAR_SLOT_GAP_PX = 2
const TOOLBAR_FIT_EPSILON_PX = 1
const DEFAULT_OVERFLOW_CONTROL_WIDTH_PX = 40

export function FormatToolbar({ language, editorViewRef, disabled }: FormatToolbarProps) {
  const adapter = useMemo(() => getAdapter(language), [language])
  const containerRef = useRef<HTMLDivElement>(null)
  const overflowMeasureRef = useRef<HTMLDivElement>(null)
  const slotMeasureRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const [containerWidth, setContainerWidth] = useState(0)
  const [overflowControlWidth, setOverflowControlWidth] = useState(0)
  const [slotWidthByKey, setSlotWidthByKey] = useState<Record<string, number>>({})
  const snippetMap = useMemo(
    () => new Map(adapter.snippets.map((s) => [s.id, s])),
    [adapter],
  )
  const slotEntries = useMemo(
    () => adapter.toolbar.map((slot) => ({ key: slotKey(slot), slot })),
    [adapter],
  )

  useEffect(() => {
    const element = containerRef.current
    if (!element) return

    const updateWidth = () => {
      const styles = window.getComputedStyle(element)
      const paddingLeft = Number.parseFloat(styles.paddingLeft) || 0
      const paddingRight = Number.parseFloat(styles.paddingRight) || 0
      const contentWidth = Math.max(0, element.clientWidth - paddingLeft - paddingRight)
      setContainerWidth(contentWidth)
    }

    updateWidth()

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateWidth)
      observer.observe(element)
      return () => observer.disconnect()
    }

    window.addEventListener('resize', updateWidth)
    return () => window.removeEventListener('resize', updateWidth)
  }, [])

  useLayoutEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      const nextWidthByKey: Record<string, number> = {}
      for (const entry of slotEntries) {
        const width = slotMeasureRefs.current[entry.key]?.getBoundingClientRect().width
        if (width && Number.isFinite(width)) {
          nextWidthByKey[entry.key] = Math.ceil(width)
        }
      }

      setSlotWidthByKey((prev) => {
        const prevKeys = Object.keys(prev)
        const nextKeys = Object.keys(nextWidthByKey)
        if (prevKeys.length === nextKeys.length && prevKeys.every((key) => prev[key] === nextWidthByKey[key])) {
          return prev
        }
        return nextWidthByKey
      })

      const measuredOverflowWidth = Math.ceil(overflowMeasureRef.current?.getBoundingClientRect().width ?? 0)
      setOverflowControlWidth((prev) => (prev === measuredOverflowWidth ? prev : measuredOverflowWidth))
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [slotEntries, language])

  const handleApply = useCallback(
    (snippet: Snippet) => {
      const view = editorViewRef.current
      if (!view) return
      applySnippet(view, snippet)
    },
    [editorViewRef],
  )

  const { visibleSlots, overflowSnippets } = useMemo(() => {
    if (slotEntries.length === 0) {
      return {
        visibleSlots: [] as ToolbarSlot[],
        overflowSnippets: [] as Snippet[],
      }
    }

    const measuredSlotWidths = slotEntries.map((entry) => slotWidthByKey[entry.key]).filter((value) => typeof value === 'number')
    const hasAllMeasurements = measuredSlotWidths.length === slotEntries.length
    if (!hasAllMeasurements || containerWidth <= 0) {
      return {
        visibleSlots: slotEntries.map((entry) => entry.slot),
        overflowSnippets: [] as Snippet[],
      }
    }

    const slotWidths = slotEntries.map((entry) => slotWidthByKey[entry.key] ?? 0)
    const prefixWidths: number[] = [0]
    for (const width of slotWidths) {
      prefixWidths.push(prefixWidths[prefixWidths.length - 1] + width)
    }

    const effectiveOverflowControlWidth = overflowControlWidth > 0
      ? overflowControlWidth
      : DEFAULT_OVERFLOW_CONTROL_WIDTH_PX

    const toolbarFits = (count: number): boolean => {
      const slotBodyWidth = prefixWidths[count] + TOOLBAR_SLOT_GAP_PX * Math.max(0, count - 1)
      if (count >= slotEntries.length) {
        return slotBodyWidth <= containerWidth - TOOLBAR_FIT_EPSILON_PX
      }

      const gapBeforeOverflow = count > 0 ? TOOLBAR_SLOT_GAP_PX : 0
      const totalWidth = slotBodyWidth + gapBeforeOverflow + effectiveOverflowControlWidth
      return totalWidth <= containerWidth - TOOLBAR_FIT_EPSILON_PX
    }

    let visibleCount = 0
    for (let count = slotEntries.length; count >= 0; count -= 1) {
      if (toolbarFits(count)) {
        visibleCount = count
        break
      }
    }

    const visible = slotEntries.slice(0, visibleCount).map((entry) => entry.slot)
    const overflowSlots = slotEntries.slice(visibleCount).map((entry) => entry.slot)
    const seenSnippetIds = new Set<string>()
    const overflow = overflowSlots.flatMap((slot) => snippetsForSlot(slot, snippetMap)).filter((snippet) => {
      if (seenSnippetIds.has(snippet.id)) {
        return false
      }
      seenSnippetIds.add(snippet.id)
      return true
    })

    return {
      visibleSlots: visible,
      overflowSnippets: overflow,
    }
  }, [containerWidth, overflowControlWidth, slotEntries, slotWidthByKey, snippetMap])

  return (
    <div
      ref={containerRef}
      className="relative flex items-center gap-0.5 border-b border-pm-border bg-pm-surface px-2"
      style={{ height: 32 }}
      role="toolbar"
      aria-label="Formatting toolbar"
    >
      {visibleSlots.map((slot: ToolbarSlot) => {
        if (typeof slot === 'string') {
          const snippet = snippetMap.get(slot)
          if (!snippet) return null
          return (
            <ToolbarButton key={slot} snippet={snippet} disabled={disabled} onApply={handleApply} />
          )
        }
        return (
          <GroupDropdown
            key={slot.id}
            group={slot}
            snippetMap={snippetMap}
            disabled={disabled}
            onApply={handleApply}
          />
        )
      })}

      {overflowSnippets.length > 0 && (
        <div className="flex items-center gap-0.5">
          <div className="mx-1 h-4 w-px bg-pm-border" />
          <OverflowMenu snippets={overflowSnippets} disabled={disabled} onApply={handleApply} />
        </div>
      )}

      <div aria-hidden="true" className="pointer-events-none absolute left-0 top-0 -z-10 h-0 overflow-hidden opacity-0">
        <div className="flex items-center gap-0.5 px-2" style={{ height: 32 }}>
          {slotEntries.map((entry) => (
            <div
              key={entry.key}
              ref={(node) => {
                slotMeasureRefs.current[entry.key] = node
              }}
            >
              <MeasureSlot slot={entry.slot} snippetMap={snippetMap} />
            </div>
          ))}
          <div ref={overflowMeasureRef} className="flex items-center gap-0.5">
            <div className="mx-1 h-4 w-px bg-pm-border" />
            <button
              type="button"
              className="flex items-center justify-center rounded p-1.5 text-pm-text-muted"
              tabIndex={-1}
            >
              <Ellipsis size={15} strokeWidth={1.8} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
