import { memo } from 'react'
import {
  Excalidraw,
  LiveCollaborationTrigger,
} from '@excalidraw/excalidraw'
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
  onOpenShare: () => void
}

function WhiteboardCanvasComponent({
  canEdit,
  isCollaborating,
  collaborators,
  onSetApi,
  onChange,
  onPointerUpdate,
  onOpenShare,
}: WhiteboardCanvasProps) {
  return (
    <div className="h-full w-full">
      <Excalidraw
        excalidrawAPI={onSetApi}
        onChange={onChange}
        onPointerUpdate={onPointerUpdate}
        isCollaborating={isCollaborating}
        viewModeEnabled={!canEdit}
        UIOptions={{
          canvasActions: {
            loadScene: false,
            export: false,
            saveToActiveFile: false,
            clearCanvas: canEdit,
            toggleTheme: false,
          },
        }}
        initialData={{
          appState: {
            viewBackgroundColor: '#ffffff',
            collaborators,
          } as Partial<AppState>,
        }}
        renderTopRightUI={() => (
          <LiveCollaborationTrigger
            isCollaborating={isCollaborating}
            onSelect={onOpenShare}
          />
        )}
      />
    </div>
  )
}

export const WhiteboardCanvas = memo(WhiteboardCanvasComponent)
