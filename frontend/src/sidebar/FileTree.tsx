import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Map as YMap, Doc as YDoc } from 'yjs'
import {
  ChevronRight,
  FileCode2,
  FilePlus,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Upload,
  type LucideIcon,
} from 'lucide-react'
import { PopupDialog } from '../components/PopupDialog'
import { ContextMenu, type ContextMenuItem } from '../components/ContextMenu'
import {
  normalizeWorkspacePath,
  parseFileMetadata,
  serializeFileMetadata,
  withFileId,
  type FileMetadata,
  type NodeType,
} from '../utils/file-metadata'
import {
  hasDataTransferType,
  readComposureDragData,
  TREE_MULTI_PATHS_MIME,
  TREE_SINGLE_PATH_MIME,
  writeComposureDragPayload,
} from '../utils/drag-data'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileTreeProps {
  fileMap: YMap<string>
  ydoc: YDoc
  projectId: string
  shareHeaders: Record<string, string>
  activeFile: string
  isDocumentLoading: boolean
  onSelect: (path: string) => void
  onSelectPersistent: (path: string) => void
  onRename: (path: string, nextPath: string) => boolean
  onDelete: (path: string) => boolean
}

interface TreeNode {
  name: string
  path: string
  isDir: boolean
  nodeType: NodeType
  storageKey?: string
  children: TreeNode[]
}

type FilePopupState =
  | { kind: 'delete'; path: string; nodeType: NodeType; childCount?: number }
  | { kind: 'multi-delete'; paths: string[] }
  | { kind: 'alert'; title: string; message: string }
  | { kind: 'rename'; path: string; nodeType: NodeType; input: string }

type RenameState = {
  path: string
  nodeType: NodeType
  value: string
} | null

type ActiveMenu = {
  kind: 'row-action' | 'context' | 'new-button' | 'empty-space'
  path?: string
  position: { x: number; y: number }
} | null

type InlineInput = {
  kind: 'file' | 'folder'
  folder: string | null
} | null

// ---------------------------------------------------------------------------
// Tree building
// ---------------------------------------------------------------------------

function buildTree(entries: Array<{ path: string; meta: FileMetadata }>): TreeNode[] {
  const root: TreeNode[] = []

  // Collect explicit folder paths
  const explicitFolders = new Set<string>()
  for (const { path: p, meta } of entries) {
    if (meta.type === 'folder') explicitFolders.add(p)
  }

  for (const { path: p, meta } of entries) {
    // Folder sentinel entries are consumed by the tree structure below
    if (meta.type === 'folder') {
      // Ensure the folder node exists in the tree
      const parts = p.split('/')
      let current = root
      for (let i = 0; i < parts.length; i++) {
        const name = parts[i]
        const fullPath = parts.slice(0, i + 1).join('/')
        let node = current.find((n) => n.name === name)
        if (!node) {
          node = { name, path: fullPath, isDir: true, nodeType: 'folder', children: [] }
          current.push(node)
        } else if (!node.isDir) {
          node.isDir = true
        }
        current = node.children
      }
      continue
    }

    const parts = p.split('/')
    let current = root

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]
      const fullPath = parts.slice(0, i + 1).join('/')
      const isLeaf = i === parts.length - 1

      if (isLeaf) {
        let existing = current.find((n) => n.name === name)
        if (!existing) {
          existing = {
            name,
            path: fullPath,
            isDir: false,
            nodeType: meta.type,
            storageKey: meta.storageKey,
            children: [],
          }
          current.push(existing)
        }
      } else {
        let node = current.find((n) => n.name === name)
        if (!node) {
          node = { name, path: fullPath, isDir: true, nodeType: 'folder', children: [] }
          current.push(node)
        }
        current = node.children
      }
    }
  }

  return root
}

function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

function flattenTree(nodes: TreeNode[], expandedFolders: Set<string>): string[] {
  const result: string[] = []
  for (const node of sortNodes(nodes)) {
    result.push(node.path)
    if (node.isDir && expandedFolders.has(node.path)) {
      result.push(...flattenTree(node.children, expandedFolders))
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function FileIcon({ name, nodeType }: { name: string; nodeType: NodeType }) {
  if (nodeType === 'asset') {
    const ext = name.split('.').pop()?.toLowerCase()
    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico']
    if (ext && imageExts.includes(ext)) return <FileImage size={13} className="mr-2 text-cz-text-muted" />
    return <FileCode2 size={13} className="mr-2 text-cz-text-muted" />
  }
  const ext = name.split('.').pop()?.toLowerCase()
  const iconMap: Record<string, LucideIcon> = {
    tex: FileText,
    typ: FileText,
    bib: FileText,
    png: FileImage,
    jpg: FileImage,
    jpeg: FileImage,
    pdf: FileText,
    svg: FileImage,
    csv: FileSpreadsheet,
    json: FileJson,
  }
  const Icon = iconMap[ext ?? ''] ?? FileCode2
  return <Icon size={13} className="mr-2 text-cz-text-muted" />
}

// ---------------------------------------------------------------------------
// Upload helper
// ---------------------------------------------------------------------------

interface UploadedAsset {
  kind: 'asset'
  originalName: string
  storageKey: string
  size: number
  mimeType: string
}

interface UploadedText {
  kind: 'text'
  originalName: string
  content: string
  size: number
}

type UploadedFile = UploadedText | UploadedAsset

function inferUploadNodeType(file: File): NodeType {
  if (file.type.startsWith('text/')) {
    return 'text'
  }
  const textExtensions = new Set(['txt', 'md', 'tex', 'typ', 'bib', 'csv', 'json', 'yaml', 'yml', 'xml'])
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  return textExtensions.has(extension) ? 'text' : 'asset'
}

async function uploadSingleFile(
  projectId: string,
  file: File,
  shareHeaders: Record<string, string>,
  onProgress: (progress: number) => void,
): Promise<{ file?: UploadedFile; error?: string }> {
  return await new Promise((resolve) => {
    const xhr = new XMLHttpRequest()
  const formData = new FormData()
    formData.append('file', file)

    xhr.open('POST', `/api/upload/${encodeURIComponent(projectId)}`)
    xhr.withCredentials = true
    for (const [headerName, headerValue] of Object.entries(shareHeaders)) {
      xhr.setRequestHeader(headerName, headerValue)
    }

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) {
        return
      }
      const next = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)))
      onProgress(next)
    }

    xhr.onerror = () => {
      resolve({ error: `Upload failed: ${file.name}` })
    }

    xhr.onabort = () => {
      resolve({ error: `Upload cancelled: ${file.name}` })
    }

    xhr.onload = () => {
      let parsed: { uploaded?: UploadedFile[]; error?: string } = {}
      if (xhr.responseText) {
        try {
          const body = JSON.parse(xhr.responseText) as unknown
          if (body && typeof body === 'object') {
            parsed = body as { uploaded?: UploadedFile[]; error?: string }
          }
        } catch {
          parsed = {}
        }
      }

      if (xhr.status < 200 || xhr.status >= 300) {
        resolve({ error: parsed.error ?? `Upload failed: ${file.name}` })
        return
      }

      const uploaded = parsed.uploaded?.[0]
      if (!uploaded) {
        resolve({ error: `Upload failed: ${file.name}` })
        return
      }

      onProgress(100)
      resolve({ file: uploaded })
    }

    xhr.send(formData)
  })
}

async function deleteAssetFromServer(
  projectId: string,
  storageKey: string,
  shareHeaders: Record<string, string>,
): Promise<void> {
  await fetch(`/api/upload/${encodeURIComponent(projectId)}/${encodeURIComponent(storageKey)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { ...shareHeaders },
  })
}

// ---------------------------------------------------------------------------
// InlineInputRow — appears as a tree row with icon + textbox
// ---------------------------------------------------------------------------

function InlineInputRow({
  kind,
  depth,
  value,
  onChange,
  onConfirm,
  onCancel,
  error,
}: {
  kind: 'file' | 'folder'
  depth: number
  value: string
  onChange: (v: string) => void
  onConfirm: () => void
  onCancel: () => void
  error: string | null
}) {
  return (
    <div style={{ paddingLeft: `${depth * 12 + 8}px` }} className="pr-2">
      <div
        className={`relative z-10 flex items-center px-2 py-1 text-xs rounded bg-cz-surface ${
          error ? 'border border-red-500' : 'border border-cz-accent'
        }`}
      >
        {kind === 'folder' ? (
          <>
            <ChevronRight size={12} className="mr-1.5 text-cz-text-muted" />
            <Folder size={13} className="mr-1.5 text-cz-text-muted" />
          </>
        ) : (
          <FileCode2 size={13} className="mr-2 text-cz-text-muted" />
        )}
        <input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); onConfirm() }
            if (e.key === 'Escape') { e.preventDefault(); onCancel() }
          }}
          onBlur={onConfirm}
          placeholder={kind === 'file' ? 'filename' : 'folder name'}
          className="flex-1 min-w-0 bg-transparent text-cz-text placeholder:text-cz-text-muted focus:outline-none"
        />
      </div>
      {error && (
        <div className="px-2 pb-1 pt-1.5 text-[11px] text-white border-x border-b border-red-500 bg-red-500 rounded-b -mt-1">
          {error}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// TreeItem
// ---------------------------------------------------------------------------

function TreeItem({
  node,
  activeFile,
  selectedPaths,
  uploadProgressByPath,
  onItemClick,
  onSelect,
  onSelectPersistent,
  onOpenMenu,
  onDragStart,
  onDragOverItem,
  onDragLeaveItem,
  onDropOnItem,
  dropTarget,
  depth,
  expandedFolders,
  toggleFolder,
  inlineInput,
  inlineValue,
  inlineError,
  onInlineChange,
  onInlineConfirm,
  onInlineCancel,
  renaming,
  renameError,
  onRenameChange,
  onRenameConfirm,
  onRenameCancel,
}: {
  node: TreeNode
  activeFile: string
  selectedPaths: Set<string>
  uploadProgressByPath: ReadonlyMap<string, number>
  onItemClick: (path: string, e: React.MouseEvent) => void
  onSelect: (path: string) => void
  onSelectPersistent: (path: string) => void
  onOpenMenu: (kind: 'row-action' | 'context', path: string, position: { x: number; y: number }) => void
  onDragStart: (path: string) => void
  onDragOverItem: (e: React.DragEvent, path: string) => void
  onDragLeaveItem: (path: string) => void
  onDropOnItem: (e: React.DragEvent, path: string) => void
  dropTarget: string | null
  depth: number
  expandedFolders: Set<string>
  toggleFolder: (path: string) => void
  inlineInput: InlineInput
  inlineValue: string
  inlineError: string | null
  onInlineChange: (v: string) => void
  onInlineConfirm: () => void
  onInlineCancel: () => void
  renaming: RenameState
  renameError: string | null
  onRenameChange: (v: string) => void
  onRenameConfirm: () => void
  onRenameCancel: () => void
}) {
  const expanded = expandedFolders.has(node.path)
  const canSelect = !node.isDir
  const uploadProgress = canSelect ? uploadProgressByPath.get(node.path) : undefined
  const isUploading = typeof uploadProgress === 'number'
  const isActive = canSelect && node.path === activeFile
  const isSelected = selectedPaths.has(node.path)
  const isDropTarget = node.isDir && node.path === dropTarget
  const isRenaming = renaming?.path === node.path && !isUploading

  if (node.isDir) {
    if (isRenaming) {
      return (
        <div>
          <div style={{ paddingLeft: `${depth * 12 + 8}px` }} className="pr-2">
            <div
              className={`relative z-10 flex items-center px-2 py-1 text-xs rounded bg-cz-surface ${
                renameError ? 'border border-red-500' : 'border border-cz-accent'
              }`}
            >
              <ChevronRight
                size={12}
                className="mr-1.5 text-cz-text-muted"
                style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
              />
              <Folder size={13} className="mr-1.5 text-cz-text-muted" />
              <input
                autoFocus
                value={renaming.value}
                onChange={(e) => onRenameChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); onRenameConfirm() }
                  if (e.key === 'Escape') { e.preventDefault(); onRenameCancel() }
                }}
                onBlur={onRenameConfirm}
                className="flex-1 min-w-0 bg-transparent text-cz-text focus:outline-none"
              />
            </div>
            {renameError && (
              <div className="px-2 pb-1 pt-1.5 text-[11px] text-white border-x border-b border-red-500 bg-red-500 rounded-b -mt-1">
                {renameError}
              </div>
            )}
          </div>
          {expanded && (
            <div>
              {sortNodes(node.children).map((child) => (
                <TreeItem
                  key={child.path}
                  node={child}
                  activeFile={activeFile}
                  selectedPaths={selectedPaths}
                  uploadProgressByPath={uploadProgressByPath}
                  onItemClick={onItemClick}
                  onSelect={onSelect}
                  onSelectPersistent={onSelectPersistent}
                  onOpenMenu={onOpenMenu}
                  onDragStart={onDragStart}
                  onDragOverItem={onDragOverItem}
                  onDragLeaveItem={onDragLeaveItem}
                  onDropOnItem={onDropOnItem}
                  dropTarget={dropTarget}
                  depth={depth + 1}
                  expandedFolders={expandedFolders}
                  toggleFolder={toggleFolder}
                  inlineInput={inlineInput}
                  inlineValue={inlineValue}
                  inlineError={inlineError}
                  onInlineChange={onInlineChange}
                  onInlineConfirm={onInlineConfirm}
                  onInlineCancel={onInlineCancel}
                  renaming={renaming}
                  renameError={renameError}
                  onRenameChange={onRenameChange}
                  onRenameConfirm={onRenameConfirm}
                  onRenameCancel={onRenameCancel}
                />
              ))}
            </div>
          )}
        </div>
      )
    }

    return (
      <div>
        <div
          draggable
          onDragStart={(e) => {
            e.stopPropagation()
            e.dataTransfer.effectAllowed = 'move'
            const dragPayload: Record<string, string> = {
              [TREE_SINGLE_PATH_MIME]: node.path,
            }
            if (isSelected && selectedPaths.size > 1) {
              dragPayload[TREE_MULTI_PATHS_MIME] = JSON.stringify([...selectedPaths])
              const badge = document.createElement('div')
              badge.textContent = `${selectedPaths.size} items`
              Object.assign(badge.style, {
                position: 'absolute', top: '-1000px', left: '-1000px',
                padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '600',
                background: 'var(--cz-accent, #3b82f6)', color: '#fff',
                whiteSpace: 'nowrap', pointerEvents: 'none',
              })
              document.body.appendChild(badge)
              e.dataTransfer.setDragImage(badge, badge.offsetWidth / 2, badge.offsetHeight / 2)
              requestAnimationFrame(() => badge.remove())
            }
            writeComposureDragPayload(e.dataTransfer, dragPayload)
            onDragStart(node.path)
          }}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); onDragOverItem(e, node.path) }}
          onDragLeave={(e) => { e.stopPropagation(); onDragLeaveItem(node.path) }}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDropOnItem(e, node.path) }}
          className={`group flex w-full items-center px-2 py-1 text-xs transition-colors rounded cursor-pointer ${
            isDropTarget
              ? 'bg-cz-accent/20 text-cz-text border-l-2 border-cz-accent'
              : isSelected
                ? 'bg-cz-accent-muted text-cz-accent'
                : 'text-cz-text-muted hover:bg-cz-surface-hover'
          }`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={(e) => {
            if (e.ctrlKey || e.metaKey || e.shiftKey) {
              onItemClick(node.path, e)
            } else {
              onItemClick(node.path, e)
              toggleFolder(node.path)
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onOpenMenu('context', node.path, { x: e.clientX, y: e.clientY })
          }}
        >
          <ChevronRight
            size={12}
            className="mr-1.5 transition-transform"
            style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
          />
          <Folder size={13} className="mr-1.5" />
          <span className="truncate">{node.name}</span>
          <div className="ml-auto">
            <button
              onClick={(e) => {
                e.stopPropagation()
                const rect = e.currentTarget.getBoundingClientRect()
                onOpenMenu('row-action', node.path, { x: rect.right, y: rect.bottom })
              }}
              className="rounded p-0.5 text-cz-text-muted opacity-0 transition-opacity hover:bg-cz-surface-hover hover:text-cz-text group-hover:opacity-100"
              title="Folder actions"
              aria-label="Folder actions"
            >
              <MoreHorizontal size={14} />
            </button>
          </div>
        </div>
        {expanded && (
          <div>
            {sortNodes(node.children).map((child) => (
              <TreeItem
                key={child.path}
                node={child}
                activeFile={activeFile}
                selectedPaths={selectedPaths}
                uploadProgressByPath={uploadProgressByPath}
                onItemClick={onItemClick}
                onSelect={onSelect}
                onSelectPersistent={onSelectPersistent}
                onOpenMenu={onOpenMenu}
                onDragStart={onDragStart}
                onDragOverItem={onDragOverItem}
                onDragLeaveItem={onDragLeaveItem}
                onDropOnItem={onDropOnItem}
                dropTarget={dropTarget}
                depth={depth + 1}
                expandedFolders={expandedFolders}
                toggleFolder={toggleFolder}
                inlineInput={inlineInput}
                inlineValue={inlineValue}
                inlineError={inlineError}
                onInlineChange={onInlineChange}
                onInlineConfirm={onInlineConfirm}
                onInlineCancel={onInlineCancel}
                renaming={renaming}
                renameError={renameError}
                onRenameChange={onRenameChange}
                onRenameConfirm={onRenameConfirm}
                onRenameCancel={onRenameCancel}
              />
            ))}
            {inlineInput && inlineInput.folder === node.path && (
              <InlineInputRow
                kind={inlineInput.kind}
                depth={depth + 1}
                value={inlineValue}
                onChange={onInlineChange}
                onConfirm={onInlineConfirm}
                onCancel={onInlineCancel}
                error={inlineError}
              />
            )}
          </div>
        )}
      </div>
    )
  }

  if (isRenaming) {
    return (
      <div style={{ paddingLeft: `${depth * 12 + 8}px` }} className="pr-2">
        <div
          className={`relative z-10 flex items-center px-2 py-1 text-xs rounded bg-cz-surface ${
            renameError ? 'border border-red-500' : 'border border-cz-accent'
          }`}
        >
          <FileIcon name={renaming.value || node.name} nodeType={node.nodeType} />
          <input
            autoFocus
            value={renaming.value}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); onRenameConfirm() }
              if (e.key === 'Escape') { e.preventDefault(); onRenameCancel() }
            }}
            onBlur={onRenameConfirm}
            className="flex-1 min-w-0 bg-transparent text-cz-text focus:outline-none"
          />
        </div>
        {renameError && (
          <div className="px-2 pb-1 pt-1.5 text-[11px] text-white border-x border-b border-red-500 bg-red-500 rounded-b -mt-1">
            {renameError}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      draggable={!isUploading}
      onDragStart={(e) => {
        if (isUploading) {
          return
        }
        e.stopPropagation()
        e.dataTransfer.effectAllowed = 'move'
        const dragPayload: Record<string, string> = {
          [TREE_SINGLE_PATH_MIME]: node.path,
        }
        if (isSelected && selectedPaths.size > 1) {
          dragPayload[TREE_MULTI_PATHS_MIME] = JSON.stringify([...selectedPaths])
          const badge = document.createElement('div')
          badge.textContent = `${selectedPaths.size} items`
          Object.assign(badge.style, {
            position: 'absolute', top: '-1000px', left: '-1000px',
            padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '600',
            background: 'var(--cz-accent, #3b82f6)', color: '#fff',
            whiteSpace: 'nowrap', pointerEvents: 'none',
          })
          document.body.appendChild(badge)
          e.dataTransfer.setDragImage(badge, badge.offsetWidth / 2, badge.offsetHeight / 2)
          requestAnimationFrame(() => badge.remove())
        }
        writeComposureDragPayload(e.dataTransfer, dragPayload)
        onDragStart(node.path)
      }}
      onClick={(e) => {
        if (isUploading) {
          return
        }
        onItemClick(node.path, e)
        if (canSelect && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
          onSelect(node.path)
        }
      }}
      onDoubleClick={(e) => {
        if (isUploading || !canSelect || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) {
          return
        }
        onSelectPersistent(node.path)
      }}
      onContextMenu={(e) => {
        if (isUploading) {
          return
        }
        e.preventDefault()
        e.stopPropagation()
        onOpenMenu('context', node.path, { x: e.clientX, y: e.clientY })
      }}
      className={`group relative flex w-full items-center px-2 py-1 text-xs transition-colors rounded ${
        isUploading ? 'cursor-not-allowed bg-cz-surface text-cz-text-muted opacity-70' : canSelect ? 'cursor-pointer' : 'cursor-default'
      } ${
        !isUploading && isSelected
          ? 'bg-cz-accent-muted text-cz-accent'
          : !isUploading && isActive && selectedPaths.size === 0
            ? 'bg-cz-accent-muted text-cz-accent'
            : isUploading
              ? 'text-cz-text-muted'
              : 'text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text'
      }`}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      {isUploading && (
        <>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-cz-border/70" />
          <div
            role="progressbar"
            aria-label={`Uploading ${node.name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(uploadProgress ?? 0)}
            className="pointer-events-none absolute bottom-0 left-0 h-0.5 bg-cz-accent transition-[width] duration-150"
            style={{ width: `${Math.max(0, Math.min(100, uploadProgress ?? 0))}%` }}
          />
        </>
      )}
      <FileIcon name={node.name} nodeType={node.nodeType} />
      <span className="truncate">{node.name}</span>
      <div className="ml-auto">
        <button
          onClick={(e) => {
            if (isUploading) {
              return
            }
            e.stopPropagation()
            const rect = e.currentTarget.getBoundingClientRect()
            onOpenMenu('row-action', node.path, { x: rect.right, y: rect.bottom })
          }}
          className={`rounded p-0.5 text-cz-text-muted transition-opacity hover:bg-cz-surface-hover hover:text-cz-text ${
            isUploading ? 'pointer-events-none opacity-0' : 'opacity-0 group-hover:opacity-100'
          }`}
          title="File actions"
          aria-label="File actions"
          disabled={isUploading}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// FileTree
// ---------------------------------------------------------------------------

export function FileTree({
  fileMap,
  ydoc,
  projectId,
  shareHeaders,
  activeFile,
  isDocumentLoading,
  onSelect,
  onSelectPersistent,
  onRename,
  onDelete,
}: FileTreeProps) {
  const [popup, setPopup] = useState<FilePopupState | null>(null)
  const [activeMenu, setActiveMenu] = useState<ActiveMenu>(null)
  const [inlineInput, setInlineInput] = useState<InlineInput>(null)
  const [inlineValue, setInlineValue] = useState('')
  const [renaming, setRenaming] = useState<RenameState>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [uploadProgressByPath, setUploadProgressByPath] = useState<Record<string, { progress: number; nodeType: NodeType }>>({})
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set())
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set())
  const lastClickedPathRef = useRef<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounter = useRef(0)
  const dragSourceRef = useRef<string | null>(null)
  const uploadFolderRef = useRef<string | null>(null)

  // Derive entries from fileMap
  const [entries, setEntries] = useState<Array<{ path: string; meta: FileMetadata }>>(() => {
    const result: Array<{ path: string; meta: FileMetadata }> = []
    fileMap.forEach((val: string, key: string) => {
      result.push({ path: key, meta: parseFileMetadata(val) })
    })
    return result
  })

  useEffect(() => {
    const handler = () => {
      const result: Array<{ path: string; meta: FileMetadata }> = []
      fileMap.forEach((val: string, key: string) => {
        result.push({ path: key, meta: parseFileMetadata(val) })
      })
      setEntries(result)
    }
    fileMap.observe(handler)
    return () => fileMap.unobserve(handler)
  }, [fileMap])

  useEffect(() => {
    const updates: Array<{ path: string; value: string }> = []
    fileMap.forEach((raw: string, key: string) => {
      const normalized = serializeFileMetadata(withFileId(parseFileMetadata(raw)))
      if (raw !== normalized) {
        updates.push({ path: key, value: normalized })
      }
    })

    if (updates.length === 0) return

    ydoc.transact(() => {
      for (const update of updates) {
        fileMap.set(update.path, update.value)
      }
    }, 'composure:normalize-file-metadata')
  }, [fileMap, ydoc])

  const displayEntries = useMemo(() => {
    const entryByPath = new Map(entries.map((entry) => [entry.path, entry]))
    const combined = [...entries]

    for (const [path, uploadState] of Object.entries(uploadProgressByPath)) {
      if (entryByPath.has(path)) {
        continue
      }
      combined.push({ path, meta: { type: uploadState.nodeType } })
    }

    return combined
  }, [entries, uploadProgressByPath])

  const uploadPaths = useMemo(() => new Set(Object.keys(uploadProgressByPath)), [uploadProgressByPath])
  const uploadProgressLookup = useMemo(() => {
    return new Map(Object.entries(uploadProgressByPath).map(([path, state]) => [path, state.progress]))
  }, [uploadProgressByPath])

  const tree = useMemo(() => buildTree(displayEntries), [displayEntries])
  const flatOrder = useMemo(() => flattenTree(tree, expandedFolders), [tree, expandedFolders])
  const folderPaths = useMemo(() => new Set(displayEntries.filter((en) => en.meta.type === 'folder').map((en) => en.path)), [displayEntries])

  // Multi-select click handler
  // Anchor = lastClickedPathRef. Only plain Click and Ctrl+Click move the anchor.
  // Shift never moves the anchor.
  const handleItemClick = useCallback((path: string, e: React.MouseEvent) => {
    // Check shift FIRST so Shift+Ctrl combo enters the range branch, not toggle
    if (e.shiftKey && lastClickedPathRef.current) {
      const startIdx = flatOrder.indexOf(lastClickedPathRef.current)
      const endIdx = flatOrder.indexOf(path)
      if (startIdx !== -1 && endIdx !== -1) {
        const lo = Math.min(startIdx, endIdx)
        const hi = Math.max(startIdx, endIdx)
        const range = flatOrder.slice(lo, hi + 1).filter((p) => !folderPaths.has(p) && !uploadPaths.has(p))
        if (e.ctrlKey || e.metaKey) {
          // Shift+Ctrl: add range to existing selections
          setSelectedPaths((prev) => {
            const next = new Set(prev)
            for (const p of range) next.add(p)
            return next
          })
        } else {
          // Shift only: replace entire selection with just the range
          setSelectedPaths(new Set(range))
        }
        return
      }
    }

    if (e.ctrlKey || e.metaKey) {
      // Toggle individual item, anchor moves here
      setSelectedPaths((prev) => {
        const next = new Set(prev)
        if (next.has(path)) next.delete(path)
        else next.add(path)
        return next
      })
      lastClickedPathRef.current = path
      return
    }

    // Normal click — clear multi-selection, anchor moves here
    setSelectedPaths(new Set())
    lastClickedPathRef.current = path
  }, [flatOrder, folderPaths, uploadPaths])

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])

  // Helpers
  const closePopup = useCallback(() => setPopup(null), [])
  const closeMenu = useCallback(() => setActiveMenu(null), [])

  const openRename = useCallback((path: string, nodeType: NodeType) => {
    // Extract just the name (last segment) for inline editing
    const name = path.split('/').pop() ?? path
    setRenaming({ path, nodeType, value: name })
  }, [])

  const openDelete = useCallback((path: string, nodeType: NodeType) => {
    if (nodeType === 'folder') {
      // Count children
      let count = 0
      for (const e of entries) {
        if (e.path.startsWith(path + '/') && e.meta.type !== 'folder') count++
      }
      setPopup({ kind: 'delete', path, nodeType, childCount: count })
    } else {
      setPopup({ kind: 'delete', path, nodeType })
    }
  }, [entries])

  const openAlert = useCallback((message: string, title = 'Action failed') => {
    setPopup({ kind: 'alert', title, message })
  }, [])

  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const openMenu = useCallback((kind: 'row-action' | 'context', path: string, position: { x: number; y: number }) => {
    setActiveMenu({ kind, path, position })
  }, [])

  // Scope path to inline input folder (for folder context-menu actions)
  const scopedPath = useCallback((name: string, folder: string | null) => {
    const normalized = normalizeWorkspacePath(name)
    return folder ? `${folder}/${normalized}` : normalized
  }, [])

  // Create file
  const handleCreateFile = useCallback((name: string, folder: string | null) => {
    const trimmed = name.trim()
    if (!trimmed) return
    const fullPath = scopedPath(trimmed, folder)
    if (fileMap.has(fullPath)) return
    ydoc.transact(() => {
      fileMap.set(fullPath, serializeFileMetadata(withFileId({ type: 'text' })))
      ydoc.getText(`file:${fullPath}`)
    }, 'composure:create-file')
    onSelect(fullPath)
  }, [fileMap, ydoc, scopedPath, onSelect])

  // Create folder
  const handleCreateFolder = useCallback((name: string, folder: string | null) => {
    const trimmed = name.trim()
    if (!trimmed) return
    const fullPath = scopedPath(trimmed, folder)
    if (fileMap.has(fullPath)) return
    fileMap.set(fullPath, serializeFileMetadata(withFileId({ type: 'folder' })))
    setExpandedFolders((prev) => new Set(prev).add(fullPath))
  }, [fileMap, scopedPath])

  // Confirm rename (inline)
  const confirmRename = useCallback(() => {
    if (!renaming) return
    const newName = normalizeWorkspacePath(renaming.value)
    const oldName = renaming.path.split('/').pop()!
    if (!newName || newName === oldName) { setRenaming(null); return }

    // Build full new path by replacing the last segment
    const parentSlash = renaming.path.lastIndexOf('/')
    const nextPath = parentSlash >= 0
      ? renaming.path.slice(0, parentSlash + 1) + newName
      : newName

    // Check for conflicts
    if (fileMap.has(nextPath)) return  // blocked by validation error

    if (renaming.nodeType === 'folder') {
      // Rename folder: rename all entries with the old prefix
      const oldPrefix = renaming.path + '/'
      const newPrefix = nextPath + '/'
      const toRename: Array<{ oldKey: string; newKey: string; value: string }> = []

      // The folder sentinel itself
      if (fileMap.has(renaming.path)) {
        toRename.push({ oldKey: renaming.path, newKey: nextPath, value: fileMap.get(renaming.path)! })
      }
      // All children
      fileMap.forEach((val: string, key: string) => {
        if (key.startsWith(oldPrefix)) {
          toRename.push({ oldKey: key, newKey: newPrefix + key.slice(oldPrefix.length), value: val })
        }
      })

      ydoc.transact(() => {
        for (const { oldKey, newKey, value } of toRename) {
          const meta = parseFileMetadata(value)
          if (meta.type === 'text') {
            // Move YText content
            const source = ydoc.getText(`file:${oldKey}`).toString()
            const target = ydoc.getText(`file:${newKey}`)
            target.delete(0, target.length)
            target.insert(0, source)
            const prev = ydoc.getText(`file:${oldKey}`)
            prev.delete(0, prev.length)
          }
          fileMap.delete(oldKey)
          fileMap.set(newKey, value)
        }
      }, 'composure:rename-folder')

      // Update expanded folders
      setExpandedFolders((prev) => {
        const next = new Set<string>()
        for (const f of prev) {
          if (f === renaming.path) next.add(nextPath)
          else if (f.startsWith(oldPrefix)) next.add(newPrefix + f.slice(oldPrefix.length))
          else next.add(f)
        }
        return next
      })

      setRenaming(null)
      return
    }

    // File/asset rename
    if (!onRename(renaming.path, nextPath)) {
      openAlert('Could not rename. Make sure the name is unique.')
      return
    }
    setRenaming(null)
  }, [renaming, fileMap, ydoc, onRename, openAlert])

  // Confirm delete
  const confirmDelete = useCallback(async () => {
    if (!popup || popup.kind !== 'delete') return

    if (popup.nodeType === 'folder') {
      const prefix = popup.path + '/'
      const toDelete: Array<{ key: string; meta: FileMetadata }> = []

      // Folder sentinel
      if (fileMap.has(popup.path)) {
        toDelete.push({ key: popup.path, meta: parseFileMetadata(fileMap.get(popup.path)!) })
      }
      // Children
      fileMap.forEach((val: string, key: string) => {
        if (key.startsWith(prefix)) {
          toDelete.push({ key, meta: parseFileMetadata(val) })
        }
      })

      // Delete assets from server
      for (const { meta } of toDelete) {
        if (meta.type === 'asset' && meta.storageKey) {
          await deleteAssetFromServer(projectId, meta.storageKey, shareHeaders)
        }
      }

      ydoc.transact(() => {
        for (const { key, meta } of toDelete) {
          if (meta.type === 'text') {
            const text = ydoc.getText(`file:${key}`)
            text.delete(0, text.length)
          }
          fileMap.delete(key)
        }
      }, 'composure:delete-folder')

      closePopup()
      return
    }

    // Asset file delete
    const meta = parseFileMetadata(fileMap.get(popup.path) ?? '')
    if (meta.type === 'asset' && meta.storageKey) {
      await deleteAssetFromServer(projectId, meta.storageKey, shareHeaders)
    }

    // Delegate to parent for fileMap cleanup and activeFile handling
    if (!onDelete(popup.path)) {
      openAlert('Could not delete file.')
      return
    }
    closePopup()
  }, [popup, fileMap, ydoc, projectId, shareHeaders, onDelete, closePopup, openAlert])

  // Confirm multi-delete
  const confirmMultiDelete = useCallback(async () => {
    if (!popup || popup.kind !== 'multi-delete') return

    const toDelete: Array<{ key: string; meta: FileMetadata }> = []

    for (const p of popup.paths) {
      const raw = fileMap.get(p)
      if (!raw) continue
      const meta = parseFileMetadata(raw)
      toDelete.push({ key: p, meta })

      if (meta.type === 'folder') {
        const prefix = p + '/'
        fileMap.forEach((val: string, key: string) => {
          if (key.startsWith(prefix)) {
            toDelete.push({ key, meta: parseFileMetadata(val) })
          }
        })
      }
    }

    // Deduplicate
    const seen = new Set<string>()
    const unique = toDelete.filter((item) => {
      if (seen.has(item.key)) return false
      seen.add(item.key)
      return true
    })

    for (const { meta } of unique) {
      if (meta.type === 'asset' && meta.storageKey) {
        await deleteAssetFromServer(projectId, meta.storageKey, shareHeaders)
      }
    }

    ydoc.transact(() => {
      for (const { key, meta } of unique) {
        if (meta.type === 'text') {
          const text = ydoc.getText(`file:${key}`)
          text.delete(0, text.length)
        }
        fileMap.delete(key)
      }
    }, 'composure:multi-delete')

    setSelectedPaths(new Set())
    closePopup()

    // Notify parent about each deleted file for activeFile handling
    for (const { key } of unique) {
      onDelete(key)
    }
  }, [popup, fileMap, ydoc, projectId, shareHeaders, onDelete, closePopup])

  // Upload handler
  const handleUpload = useCallback(async (files: FileList | File[], folder: string | null = null) => {
    const fileArray = Array.from(files)
    if (fileArray.length === 0) return

    if (folder) {
      setExpandedFolders((prev) => new Set(prev).add(folder))
    }

    const results = await Promise.all(fileArray.map(async (file) => {
      const displayPath = scopedPath(file.name, folder)
      const nodeType = inferUploadNodeType(file)

      setUploadProgressByPath((prev) => ({
        ...prev,
        [displayPath]: { progress: 0, nodeType },
      }))

      try {
        const result = await uploadSingleFile(projectId, file, shareHeaders, (progress) => {
          setUploadProgressByPath((prev) => {
            const existing = prev[displayPath]
            if (!existing) {
              return prev
            }
            if (progress <= existing.progress && progress !== 100) {
              return prev
            }
            return {
              ...prev,
              [displayPath]: { ...existing, progress },
            }
          })
        })

        if (!result.file) {
          return result.error ?? `Upload failed: ${file.name}`
        }

        const uploaded = result.file
        ydoc.transact(() => {
          if (uploaded.kind === 'text') {
            fileMap.set(displayPath, serializeFileMetadata(withFileId({ type: 'text' })))
            const text = ydoc.getText(`file:${displayPath}`)
            if (text.length > 0) text.delete(0, text.length)
            text.insert(0, uploaded.content)
          } else {
            fileMap.set(displayPath, serializeFileMetadata(withFileId({
              type: 'asset',
              storageKey: uploaded.storageKey,
              size: uploaded.size,
              mimeType: uploaded.mimeType,
            })))
          }
        }, 'composure:upload-file')
        return null
      } finally {
        setUploadProgressByPath((prev) => {
          if (!(displayPath in prev)) {
            return prev
          }
          const next = { ...prev }
          delete next[displayPath]
          return next
        })
      }
    }))

    const errors = results.filter((error): error is string => Boolean(error))
    if (errors.length > 0) {
      const suffix = errors.length > 1 ? ` (+${errors.length - 1} more)` : ''
      setToast(`${errors[0]}${suffix}`)
    }
  }, [projectId, shareHeaders, ydoc, fileMap, scopedPath])

  // Internal drag-drop: move a node to a new parent folder
  const moveNode = useCallback((sourcePath: string, targetFolder: string | null) => {
    const name = sourcePath.split('/').pop()!
    const newPath = targetFolder ? `${targetFolder}/${name}` : name

    if (newPath === sourcePath) return
    // Don't allow moving a folder into itself or its descendants
    if (targetFolder && (targetFolder === sourcePath || targetFolder.startsWith(sourcePath + '/'))) return
    if (fileMap.has(newPath)) {
      openAlert(`"${name}" already exists in the destination.`)
      return
    }

    const meta = parseFileMetadata(fileMap.get(sourcePath) ?? '')
    if (meta.type === 'folder') {
      // Move folder and all children
      const oldPrefix = sourcePath + '/'
      const newPrefix = newPath + '/'
      const toMove: Array<{ oldKey: string; newKey: string; value: string }> = []

      if (fileMap.has(sourcePath)) {
        toMove.push({ oldKey: sourcePath, newKey: newPath, value: fileMap.get(sourcePath)! })
      }
      fileMap.forEach((val: string, key: string) => {
        if (key.startsWith(oldPrefix)) {
          toMove.push({ oldKey: key, newKey: newPrefix + key.slice(oldPrefix.length), value: val })
        }
      })

      ydoc.transact(() => {
        for (const { oldKey, newKey, value } of toMove) {
          const m = parseFileMetadata(value)
          if (m.type === 'text') {
            const source = ydoc.getText(`file:${oldKey}`).toString()
            const target = ydoc.getText(`file:${newKey}`)
            target.delete(0, target.length)
            target.insert(0, source)
            const prev = ydoc.getText(`file:${oldKey}`)
            prev.delete(0, prev.length)
          }
          fileMap.delete(oldKey)
          fileMap.set(newKey, value)
        }
      }, 'composure:move-folder')

      // Update expanded folders
      setExpandedFolders((prev) => {
        const next = new Set<string>()
        for (const f of prev) {
          if (f === sourcePath) next.add(newPath)
          else if (f.startsWith(oldPrefix)) next.add(newPrefix + f.slice(oldPrefix.length))
          else next.add(f)
        }
        return next
      })
    } else {
      // Move single file
      const value = fileMap.get(sourcePath)
      if (!value) return

      ydoc.transact(() => {
        if (meta.type === 'text') {
          const source = ydoc.getText(`file:${sourcePath}`).toString()
          const target = ydoc.getText(`file:${newPath}`)
          target.delete(0, target.length)
          target.insert(0, source)
          const prev = ydoc.getText(`file:${sourcePath}`)
          prev.delete(0, prev.length)
        }
        fileMap.delete(sourcePath)
        fileMap.set(newPath, value)
      }, 'composure:move-file')
    }

    // Expand the target folder so the moved item is visible
    if (targetFolder) {
      setExpandedFolders((prev) => new Set(prev).add(targetFolder))
    }
  }, [fileMap, ydoc, openAlert])

  // Multi-item move: deduplicate, validate, and move in a single transaction
  const moveNodes = useCallback((sourcePaths: string[], targetFolder: string | null) => {
    // Deduplicate: if a folder and any of its descendants are both selected, keep only the folder
    const sorted = [...sourcePaths].sort()
    const deduped: string[] = []
    for (const p of sorted) {
      if (deduped.length > 0 && p.startsWith(deduped[deduped.length - 1] + '/')) continue
      deduped.push(p)
    }

    // Collect all items to move (each source + its children if folder)
    const allMoves: Array<{ oldKey: string; newKey: string; value: string }> = []
    const expandedUpdates: Array<{ oldPath: string; newPath: string; oldPrefix: string; newPrefix: string }> = []
    const errors: string[] = []

    for (const sourcePath of deduped) {
      const name = sourcePath.split('/').pop()!
      const newPath = targetFolder ? `${targetFolder}/${name}` : name

      if (newPath === sourcePath) continue
      if (targetFolder && (targetFolder === sourcePath || targetFolder.startsWith(sourcePath + '/'))) continue
      if (fileMap.has(newPath) && !deduped.includes(newPath)) {
        errors.push(`"${name}" already exists in the destination.`)
        continue
      }

      const meta = parseFileMetadata(fileMap.get(sourcePath) ?? '')
      if (meta.type === 'folder') {
        const oldPrefix = sourcePath + '/'
        const newPrefix = newPath + '/'
        if (fileMap.has(sourcePath)) {
          allMoves.push({ oldKey: sourcePath, newKey: newPath, value: fileMap.get(sourcePath)! })
        }
        fileMap.forEach((val: string, key: string) => {
          if (key.startsWith(oldPrefix)) {
            allMoves.push({ oldKey: key, newKey: newPrefix + key.slice(oldPrefix.length), value: val })
          }
        })
        expandedUpdates.push({ oldPath: sourcePath, newPath, oldPrefix, newPrefix })
      } else {
        const value = fileMap.get(sourcePath)
        if (value) allMoves.push({ oldKey: sourcePath, newKey: newPath, value })
      }
    }

    if (allMoves.length === 0) {
      if (errors.length > 0) openAlert(errors[0])
      return
    }

    ydoc.transact(() => {
      for (const { oldKey, newKey, value } of allMoves) {
        const m = parseFileMetadata(value)
        if (m.type === 'text') {
          const source = ydoc.getText(`file:${oldKey}`).toString()
          const target = ydoc.getText(`file:${newKey}`)
          target.delete(0, target.length)
          target.insert(0, source)
          const prev = ydoc.getText(`file:${oldKey}`)
          prev.delete(0, prev.length)
        }
        fileMap.delete(oldKey)
        fileMap.set(newKey, value)
      }
    }, 'composure:move-files')

    if (expandedUpdates.length > 0) {
      setExpandedFolders((prev) => {
        const next = new Set<string>()
        for (const f of prev) {
          let mapped = f
          for (const { oldPath, newPath, oldPrefix, newPrefix } of expandedUpdates) {
            if (f === oldPath) { mapped = newPath; break }
            if (f.startsWith(oldPrefix)) { mapped = newPrefix + f.slice(oldPrefix.length); break }
          }
          next.add(mapped)
        }
        return next
      })
    }

    if (targetFolder) {
      setExpandedFolders((prev) => new Set(prev).add(targetFolder))
    }

    setSelectedPaths(new Set())

    if (errors.length > 0) openAlert(errors[0])
  }, [fileMap, ydoc, openAlert])

  // Drag-and-drop handlers (external file uploads + internal moves to root)
  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current++
    if (hasDataTransferType(e.dataTransfer, 'Files')) setDragOver(true)
  }, [])

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current--
    if (dragCounter.current === 0) setDragOver(false)
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current = 0
    setDragOver(false)
    setDropTarget(null)

    // Internal move → move to root
    const multiPaths = readComposureDragData(e.dataTransfer, TREE_MULTI_PATHS_MIME)
    const sourcePath = readComposureDragData(e.dataTransfer, TREE_SINGLE_PATH_MIME)
    if (multiPaths) {
      try { moveNodes(JSON.parse(multiPaths) as string[], null) } catch { /* ignore bad data */ }
      dragSourceRef.current = null
      return
    }
    if (sourcePath) {
      moveNode(sourcePath, null)
      dragSourceRef.current = null
      return
    }

    if (e.dataTransfer.files.length > 0) {
      void handleUpload(e.dataTransfer.files)
    }
  }, [handleUpload, moveNode, moveNodes])

  // Handlers passed to TreeItem for internal drag-drop onto folders
  const handleItemDragStart = useCallback((path: string) => {
    dragSourceRef.current = path
  }, [])

  const handleDragOverItem = useCallback((e: React.DragEvent, path: string) => {
    // Only accept internal moves
    const hasSinglePath = readComposureDragData(e.dataTransfer, TREE_SINGLE_PATH_MIME).length > 0
    const hasMultiPaths = readComposureDragData(e.dataTransfer, TREE_MULTI_PATHS_MIME).length > 0
    if (!hasSinglePath && !hasMultiPaths) return
    e.dataTransfer.dropEffect = 'move'
    setDropTarget(path)
  }, [])

  const handleDragLeaveItem = useCallback((_path: string) => {
    setDropTarget((prev) => prev === _path ? null : prev)
  }, [])

  const handleDropOnItem = useCallback((e: React.DragEvent, targetPath: string) => {
    setDropTarget(null)
    const multiPaths = readComposureDragData(e.dataTransfer, TREE_MULTI_PATHS_MIME)
    if (multiPaths) {
      try { moveNodes(JSON.parse(multiPaths) as string[], targetPath) } catch { /* ignore bad data */ }
      dragSourceRef.current = null
      return
    }
    const sourcePath = readComposureDragData(e.dataTransfer, TREE_SINGLE_PATH_MIME)
    if (!sourcePath || sourcePath === targetPath) return
    moveNode(sourcePath, targetPath)
    dragSourceRef.current = null
  }, [moveNode, moveNodes])

  // Build menu items for a given node
  const getMenuItems = useCallback((path: string): ContextMenuItem[] => {
    // Multi-selection context menu
    if (selectedPaths.size > 1 && selectedPaths.has(path)) {
      const count = selectedPaths.size
      return [
        { icon: Pencil, name: 'Rename', action: () => {}, disabled: true },
        { icon: Trash2, name: `Delete ${count} items`, action: () => setPopup({ kind: 'multi-delete', paths: [...selectedPaths] }), danger: true },
      ]
    }

    const meta = parseFileMetadata(fileMap.get(path) ?? '')
    const nodeEntry = entries.find((e) => e.path === path)
    const nodeType = nodeEntry?.meta.type ?? meta.type
    const isDir = nodeType === 'folder' || entries.some((e) => e.path.startsWith(path + '/'))

    if (isDir) {
      return [
        { icon: FilePlus, name: 'New File', action: () => { setExpandedFolders((prev) => new Set(prev).add(path)); setInlineInput({ kind: 'file', folder: path }); setInlineValue('') } },
        { icon: FolderPlus, name: 'New Folder', action: () => { setExpandedFolders((prev) => new Set(prev).add(path)); setInlineInput({ kind: 'folder', folder: path }); setInlineValue('') } },
        { icon: Upload, name: 'Upload File', action: () => { uploadFolderRef.current = path; fileInputRef.current?.click() } },
        { icon: Pencil, name: 'Rename', action: () => openRename(path, 'folder') },
        { icon: Trash2, name: 'Delete', action: () => openDelete(path, 'folder'), danger: true },
      ]
    }

    return [
      { icon: Pencil, name: 'Rename', action: () => openRename(path, nodeType) },
      { icon: Trash2, name: 'Delete', action: () => openDelete(path, nodeType), danger: true },
    ]
  }, [fileMap, entries, openRename, openDelete, selectedPaths])

  // +New / empty space menu items — always add to root
  const newMenuItems: ContextMenuItem[] = useMemo(() => [
    { icon: FilePlus, name: 'New File', action: () => { setInlineInput({ kind: 'file', folder: null }); setInlineValue('') } },
    { icon: FolderPlus, name: 'New Folder', action: () => { setInlineInput({ kind: 'folder', folder: null }); setInlineValue('') } },
    { icon: Upload, name: 'Upload File', action: () => { uploadFolderRef.current = null; fileInputRef.current?.click() } },
  ], [])

  // Compute inline validation error
  const inlineError = useMemo(() => {
    if (!inlineInput) return null
    const trimmed = inlineValue.trim()
    if (!trimmed) return null
    const fullPath = scopedPath(trimmed, inlineInput.folder)
    if (fileMap.has(fullPath)) {
      return 'A file or folder with this name already exists here. Please choose a different name.'
    }
    return null
  }, [inlineInput, inlineValue, fileMap, scopedPath])

  // Compute rename validation error
  const renameError = useMemo(() => {
    if (!renaming) return null
    const newName = normalizeWorkspacePath(renaming.value)
    const oldName = renaming.path.split('/').pop()!
    if (!newName || newName === oldName) return null
    const parentSlash = renaming.path.lastIndexOf('/')
    const nextPath = parentSlash >= 0
      ? renaming.path.slice(0, parentSlash + 1) + newName
      : newName
    if (fileMap.has(nextPath)) {
      return 'A file or folder with this name already exists here. Please choose a different name.'
    }
    return null
  }, [renaming, fileMap])

  // Inline input confirm
  const confirmInline = useCallback(() => {
    if (!inlineInput) return
    if (inlineError) return
    const trimmed = inlineValue.trim()
    if (!trimmed) {
      setInlineInput(null)
      setInlineValue('')
      return
    }
    if (inlineInput.kind === 'file') {
      handleCreateFile(inlineValue, inlineInput.folder)
    } else {
      handleCreateFolder(inlineValue, inlineInput.folder)
    }
    setInlineInput(null)
    setInlineValue('')
  }, [inlineInput, inlineValue, inlineError, handleCreateFile, handleCreateFolder])

  const cancelInline = useCallback(() => {
    setInlineInput(null)
    setInlineValue('')
  }, [])

  const cancelRename = useCallback(() => {
    setRenaming(null)
  }, [])

  return (
    <div
      className="flex flex-1 flex-col overflow-y-auto py-2 relative"
      tabIndex={0}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onKeyDown={(e) => {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          if (selectedPaths.size > 1) {
            e.preventDefault()
            setPopup({ kind: 'multi-delete', paths: [...selectedPaths] })
          } else if (selectedPaths.size === 1) {
            const path = [...selectedPaths][0]
            const entry = entries.find((en) => en.path === path)
            if (entry) {
              e.preventDefault()
              openDelete(path, entry.meta.type)
            }
          }
        }
      }}
      onContextMenu={(e) => {
        // Right-click empty space
        if (e.target === e.currentTarget) {
          e.preventDefault()
          setActiveMenu({ kind: 'empty-space', position: { x: e.clientX, y: e.clientY } })
        }
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 mb-2">
        <span className="text-[10px] font-medium uppercase tracking-widest text-cz-text-muted">
          Files
        </span>
        <button
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            setActiveMenu({ kind: 'new-button', position: { x: rect.left, y: rect.bottom + 4 } })
          }}
          className="flex items-center gap-1 text-cz-text-muted hover:text-cz-accent text-sm transition-colors"
          title="New"
        >
          <Plus size={14} />
          <span className="text-[10px] font-medium uppercase tracking-wide">New</span>
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div className="mx-3 mb-2 rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">
          {toast}
        </div>
      )}

      {/* Tree */}
      {sortNodes(tree).map((node) => (
        <TreeItem
          key={node.path}
          node={node}
          activeFile={activeFile}
          selectedPaths={selectedPaths}
          uploadProgressByPath={uploadProgressLookup}
          onItemClick={handleItemClick}
          onSelect={onSelect}
          onSelectPersistent={onSelectPersistent}
          onOpenMenu={openMenu}
          onDragStart={handleItemDragStart}
          onDragOverItem={handleDragOverItem}
          onDragLeaveItem={handleDragLeaveItem}
          onDropOnItem={handleDropOnItem}
          dropTarget={dropTarget}
          depth={0}
          expandedFolders={expandedFolders}
          toggleFolder={toggleFolder}
          inlineInput={inlineInput}
          inlineValue={inlineValue}
          inlineError={inlineError}
          onInlineChange={setInlineValue}
          onInlineConfirm={confirmInline}
          onInlineCancel={cancelInline}
          renaming={renaming}
          renameError={renameError}
          onRenameChange={(v) => setRenaming((prev) => prev ? { ...prev, value: v } : prev)}
          onRenameConfirm={confirmRename}
          onRenameCancel={cancelRename}
        />
      ))}

      {/* Inline input for root-level creation */}
      {inlineInput && inlineInput.folder === null && (
        <InlineInputRow
          kind={inlineInput.kind}
          depth={0}
          value={inlineValue}
          onChange={setInlineValue}
          onConfirm={confirmInline}
          onCancel={cancelInline}
          error={inlineError}
        />
      )}

      {/* Loading skeleton */}
      {isDocumentLoading && entries.length === 0 && (
        <div className="px-3 py-4">
          <div className="space-y-2">
            <div className="cz-skeleton h-5 w-full rounded" />
            <div className="cz-skeleton h-5 w-[92%] rounded" />
            <div className="cz-skeleton h-5 w-[86%] rounded" />
            <div className="cz-skeleton h-5 w-[78%] rounded" />
          </div>
        </div>
      )}

      {/* Empty state */}
      {!isDocumentLoading && entries.length === 0 && (
        <div className="px-4 py-8 text-center text-xs text-cz-text-muted">
          No files yet.
          <br />
          Click <strong>+ New</strong> to create one.
        </div>
      )}

      {/* Drag-and-drop overlay */}
      {dragOver && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-cz-accent/10 border-2 border-dashed border-cz-accent rounded-lg transition-opacity duration-200">
          <div className="flex flex-col items-center gap-2 text-cz-accent">
            <Upload size={32} />
            <span className="text-sm font-medium">Drop files to upload</span>
          </div>
        </div>
      )}

      {/* Unified context menu */}
      <ContextMenu
        open={activeMenu !== null && (activeMenu.kind === 'row-action' || activeMenu.kind === 'context')}
        position={activeMenu?.position ?? { x: 0, y: 0 }}
        items={activeMenu?.path ? getMenuItems(activeMenu.path) : []}
        onClose={closeMenu}
      />

      {/* +New / empty space menu */}
      <ContextMenu
        open={activeMenu !== null && (activeMenu.kind === 'new-button' || activeMenu.kind === 'empty-space')}
        position={activeMenu?.position ?? { x: 0, y: 0 }}
        items={newMenuItems}
        onClose={closeMenu}
      />

      {/* Hidden file input for uploads */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            void handleUpload(e.target.files, uploadFolderRef.current)
          }
          e.target.value = ''
          uploadFolderRef.current = null
        }}
      />

      {/* Popups */}
      <PopupDialog
        open={popup !== null}
        title={popup?.kind === 'rename'
          ? (popup.nodeType === 'folder' ? 'Rename folder' : 'Rename file')
          : popup?.kind === 'delete'
            ? (popup.nodeType === 'folder' ? 'Delete folder' : 'Delete file')
            : popup?.kind === 'multi-delete'
              ? `Delete ${popup.paths.length} items`
              : popup?.title ?? ''}
        message={popup?.kind === 'delete'
          ? (popup.nodeType === 'folder'
            ? `Delete folder "${popup.path.split('/').pop()}"${popup.childCount ? ` and ${popup.childCount} file${popup.childCount > 1 ? 's' : ''}` : ''}?`
            : `Delete ${popup.path}?`)
          : popup?.kind === 'multi-delete'
            ? `Delete ${popup.paths.length} selected items? This cannot be undone.`
            : popup?.kind === 'alert'
              ? popup.message
              : undefined}
        dismiss={popup && popup.kind !== 'alert'
          ? { label: 'Cancel', onClick: closePopup }
          : undefined}
        actions={popup
          ? popup.kind === 'alert'
            ? [{ label: 'OK', onClick: closePopup, autoFocus: true }]
            : popup.kind === 'rename'
              ? [{ label: 'Rename', onClick: confirmRename, autoFocus: true }]
              : popup.kind === 'multi-delete'
                ? [{ label: 'Delete', onClick: () => void confirmMultiDelete(), variant: 'danger', autoFocus: true }]
                : [{ label: 'Delete', onClick: () => void confirmDelete(), variant: 'danger', autoFocus: true }]
          : []}
      >
        {popup?.kind === 'rename' && (
          <input
            value={popup.input}
            onChange={(e) => {
              const value = e.target.value
              setPopup((prev) => (prev && prev.kind === 'rename' ? { ...prev, input: value } : prev))
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); confirmRename() }
            }}
            autoFocus
            className="w-full rounded-md border border-cz-border bg-cz-bg px-3 py-2 text-sm text-cz-text outline-none focus:border-cz-accent"
          />
        )}
      </PopupDialog>
    </div>
  )
}
