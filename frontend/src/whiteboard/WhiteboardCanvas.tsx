import { memo, useMemo } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import type {
  AppState,
  ExcalidrawImperativeAPI,
  ExcalidrawProps,
  SocketId,
  Collaborator,
} from '@excalidraw/excalidraw/types'
import '@excalidraw/excalidraw/index.css'

interface WhiteboardCanvasProps {
  canEdit: boolean
  isCollaborating: boolean
  collaborators: Map<SocketId, Collaborator>
  onSetApi: (api: ExcalidrawImperativeAPI) => void
  onChange: NonNullable<ExcalidrawProps['onChange']>
  onPointerUpdate: NonNullable<ExcalidrawProps['onPointerUpdate']>
  onUserFollow?: NonNullable<ExcalidrawProps['onUserFollow']>
}

function WhiteboardCanvasComponent({
  canEdit,
  isCollaborating,
  collaborators,
  onSetApi,
  onChange,
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

  return (
    <div className="whiteboard-excalidraw-host h-full w-full">
      <Excalidraw
        excalidrawAPI={onSetApi}
        onChange={onChange}
        onPointerUpdate={onPointerUpdate}
        onUserFollow={onUserFollow}
        isCollaborating={isCollaborating}
        viewModeEnabled={!canEdit}
        UIOptions={uiOptions}
        initialData={{
          appState: {
            viewBackgroundColor: '#ffffff',
            collaborators,
          } as Partial<AppState>,
        }}
      />
    </div>
  )
}

export const WhiteboardCanvas = memo(WhiteboardCanvasComponent)
