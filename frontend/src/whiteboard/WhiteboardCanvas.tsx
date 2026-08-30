import { memo, useMemo } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import type {
  AppState,
  ExcalidrawImperativeAPI,
  ExcalidrawProps,
  LibraryItems,
  SocketId,
  Collaborator,
} from '@excalidraw/excalidraw/types'
import '@excalidraw/excalidraw/index.css'
import type { WhiteboardSceneData } from './use-whiteboard-collab'

interface WhiteboardCanvasProps {
  canEdit: boolean
  isCollaborating: boolean
  collaborators: Map<SocketId, Collaborator>
  initialLibraryItems: LibraryItems
  initialScene: WhiteboardSceneData
  onSetApi: (api: ExcalidrawImperativeAPI) => void
  onLibraryChange: NonNullable<ExcalidrawProps['onLibraryChange']>
  onPointerUpdate: NonNullable<ExcalidrawProps['onPointerUpdate']>
  onUserFollow?: NonNullable<ExcalidrawProps['onUserFollow']>
}

function WhiteboardCanvasComponent({
  canEdit,
  isCollaborating,
  collaborators,
  initialLibraryItems,
  initialScene,
  onSetApi,
  onLibraryChange,
  onPointerUpdate,
  onUserFollow,
}: WhiteboardCanvasProps) {
  const uiOptions = useMemo<ExcalidrawProps['UIOptions']>(() => ({
    canvasActions: {
      loadScene: false,
      export: false,
      saveToActiveFile: false,
      clearCanvas: canEdit,
      toggleTheme: false,
    },
  }), [canEdit])

  const initialAppState = useMemo<Partial<AppState>>(() => ({
    ...initialScene.appState,
    viewBackgroundColor: initialScene.appState.viewBackgroundColor ?? '#ffffff',
    collaborators,
  }), [collaborators, initialScene.appState])

  return (
    <div className="whiteboard-excalidraw-host h-full w-full">
      <Excalidraw
        excalidrawAPI={onSetApi}
        onLibraryChange={onLibraryChange}
        onPointerUpdate={onPointerUpdate}
        onUserFollow={onUserFollow}
        isCollaborating={isCollaborating}
        viewModeEnabled={!canEdit}
        UIOptions={uiOptions}
        initialData={{
          elements: initialScene.elements,
          appState: initialAppState,
          files: initialScene.files,
          libraryItems: initialLibraryItems,
        }}
      />
    </div>
  )
}

export const WhiteboardCanvas = memo(WhiteboardCanvasComponent)
