import { memo } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import type * as Y from "yjs";
import { FilePlus2, FileQuestion, MousePointerClick } from "lucide-react";
import { DiffView } from "./DiffView";
import { Editor } from "./Editor";
import { FileTabs, type FileTabsDropPayload } from "./FileTabs";
import { AssetPreview } from "@/preview/AssetPreview";
import type { CommentLineNumbers } from "@/sidebar/CommentsPanel";
import type {
  DiffWorkspaceTab,
  EditorMode,
  ProjectComment,
  SessionUser,
} from "@/types";
import { formatBinarySize } from "@/utils/text-size";
import type { EditorPaneState } from "./workspace-state";
import type { SplitDropZone } from "@/workspace/layout-utils";

interface EditorPaneProps {
  paneId: string;
  paneState: EditorPaneState;
  activePaneId: string;
  focusedEditorPaneId: string | null;
  paneDropZone: SplitDropZone | null;
  projectId: string;
  shareToken?: string;
  activeDiffTab: DiffWorkspaceTab | null;
  canEdit: boolean;
  onActiveDiffModeChange: (paneId: string, mode: "side-by-side" | "inline") => void;
  onActiveDiffBaseChange: (paneId: string, base: "parent" | "current") => void;
  onHistoryRestored: (paneId: string, filePath: string) => void;
  onPopupAlert: (message: string, title?: string) => void;
  paneActiveFile: string;
  paneHasActiveTextFile: boolean;
  paneTextOverLimit: boolean;
  paneTextSizeBytes: number | null;
  paneTextLimitBytes: number | null;
  paneActiveAsset: { storageKey?: string; mimeType?: string } | null;
  initialSyncDone: boolean;
  hasProjectEntries: boolean;
  provider: HocuspocusProvider | null;
  ydoc: Y.Doc;
  availableFilePaths: readonly string[];
  maxTextFileSizeBytes: number | "unlimited";
  largeFileThresholdChars: number;
  effectiveMode: EditorMode;
  canInteractWithComments: boolean;
  sessionUser: SessionUser | null;
  accountLabel: string;
  principalGuestId: string | null;
  comments: ProjectComment[];
  activeCommentId: string | null;
  activeCommentRevision: number;
  focusCollaboratorRequest: { clientId: number; revision: number } | null;
  editorBraceMatching: boolean;
  editorHighlightSelectionMatches: boolean;
  editorInEditorFind: boolean;
  editorAutocomplete: boolean;
  editorAutoCloseLatexBeginEnd: boolean;
  onCreateComment: (input: {
    filePath: string;
    startLine: number | null;
    endLine: number | null;
    parentCommentId: string | null;
    body: string;
  }) => Promise<void>;
  onTextLimitExceeded: (input: {
    filePath: string;
    sizeBytes: number;
    limitBytes: number;
  }) => void;
  onCommentLineNumbersChange: (
    filePath: string,
    nextFileLineNumbers: Record<string, CommentLineNumbers>,
  ) => void;
  onFocusPane: (paneId: string) => void;
  onActivateTab: (paneId: string, path: string) => void;
  onCloseTab: (paneId: string, path: string) => void;
  onPromoteTab: (paneId: string, path: string) => void;
  onMoveTab: (paneId: string, path: string, targetIndex: number) => void;
  onDropPathsOnTabs: (paneId: string, payload: FileTabsDropPayload) => void;
  onToggleSnippetToolbar: (paneId: string) => void;
  onPaneDragOver: (event: ReactDragEvent<HTMLDivElement>, paneId: string) => void;
  onPaneDragLeave: (event: ReactDragEvent<HTMLDivElement>, paneId: string) => void;
  onPaneDrop: (event: ReactDragEvent<HTMLDivElement>, paneId: string) => void;
  onPaneEditorFocusChange: (paneId: string, isFocused: boolean) => void;
}

export const EditorPane = memo(function EditorPane({
  paneId,
  paneState,
  activePaneId,
  focusedEditorPaneId,
  paneDropZone,
  projectId,
  shareToken,
  activeDiffTab,
  canEdit,
  onActiveDiffModeChange,
  onActiveDiffBaseChange,
  onHistoryRestored,
  onPopupAlert,
  paneActiveFile,
  paneHasActiveTextFile,
  paneTextOverLimit,
  paneTextSizeBytes,
  paneTextLimitBytes,
  paneActiveAsset,
  initialSyncDone,
  hasProjectEntries,
  provider,
  ydoc,
  availableFilePaths,
  maxTextFileSizeBytes,
  largeFileThresholdChars,
  effectiveMode,
  canInteractWithComments,
  sessionUser,
  accountLabel,
  principalGuestId,
  comments,
  activeCommentId,
  activeCommentRevision,
  focusCollaboratorRequest,
  editorBraceMatching,
  editorHighlightSelectionMatches,
  editorInEditorFind,
  editorAutocomplete,
  editorAutoCloseLatexBeginEnd,
  onCreateComment,
  onTextLimitExceeded,
  onCommentLineNumbersChange,
  onFocusPane,
  onActivateTab,
  onCloseTab,
  onPromoteTab,
  onMoveTab,
  onDropPathsOnTabs,
  onToggleSnippetToolbar,
  onPaneDragOver,
  onPaneDragLeave,
  onPaneDrop,
  onPaneEditorFocusChange,
}: EditorPaneProps) {
  const isFocusedPane = paneId === activePaneId;
  const showActiveTabBorder = isFocusedPane && focusedEditorPaneId === paneId;

  return (
    <div
      key={paneId}
      className={`flex h-full min-h-0 min-w-0 flex-col ${isFocusedPane ? "bg-cz-bg" : ""}`}
      onMouseDown={() => {
        if (activePaneId !== paneId) {
          onFocusPane(paneId);
        }
      }}
    >
      <FileTabs
        paneId={paneId}
        tabs={paneState.tabs}
        activeFile={paneActiveFile}
        isFocusedPane={showActiveTabBorder}
        onActivate={(path) => onActivateTab(paneId, path)}
        onClose={(path) => onCloseTab(paneId, path)}
        onPromote={(path) => onPromoteTab(paneId, path)}
        onMove={(path, targetIndex) => onMoveTab(paneId, path, targetIndex)}
        onDropPaths={(payload) => onDropPathsOnTabs(paneId, payload)}
        snippetToolbarVisible={paneState.showSnippetToolbar}
        onToggleSnippetToolbar={() => onToggleSnippetToolbar(paneId)}
      />

      <div
        className="relative flex-1 min-h-0 min-w-0"
        onDragOverCapture={(event) => onPaneDragOver(event, paneId)}
        onDragLeaveCapture={(event) => onPaneDragLeave(event, paneId)}
        onDropCapture={(event) => onPaneDrop(event, paneId)}
      >
        {activeDiffTab ? (
          <DiffView
            projectId={projectId}
            commitSha={activeDiffTab.commitSha}
            filePath={activeDiffTab.filePath}
            diffMode={activeDiffTab.diffMode}
            diffBase={activeDiffTab.diffBase}
            onDiffModeChange={(mode) => onActiveDiffModeChange(paneId, mode)}
            onDiffBaseChange={(base) => onActiveDiffBaseChange(paneId, base)}
            canRestore={canEdit}
            onRestore={(restoredFilePath) =>
              onHistoryRestored(paneId, restoredFilePath)
            }
            onPopupAlert={onPopupAlert}
          />
        ) : paneTextOverLimit ? (
          <div className="flex h-full items-center justify-center text-sm text-cz-text-muted">
            <div className="flex max-w-md flex-col items-center gap-2 text-center">
              <FileQuestion size={32} className="opacity-40" />
              <span className="text-cz-text">
                This file is too large to open in the editor.
              </span>
              <span className="text-xs text-cz-text-muted">
                File size {formatBinarySize(paneTextSizeBytes ?? 0)} exceeds the
                configured text file limit of{" "}
                {formatBinarySize(paneTextLimitBytes ?? 0)}.
              </span>
            </div>
          </div>
        ) : paneHasActiveTextFile && provider ? (
          <Editor
            ydoc={ydoc}
            provider={provider}
            activeFile={paneActiveFile}
            onFocusChange={(isFocused) =>
              onPaneEditorFocusChange(paneId, isFocused)
            }
            availableFilePaths={availableFilePaths}
            maxTextFileSizeBytes={maxTextFileSizeBytes}
            largeFileThresholdChars={largeFileThresholdChars}
            showFormatToolbar={paneState.showSnippetToolbar}
            canEdit={effectiveMode === "edit"}
            canComment={canInteractWithComments}
            presenceName={sessionUser?.displayName ?? accountLabel}
            presenceUserId={sessionUser?.id ?? null}
            presenceGuestId={principalGuestId}
            presenceImageUrl={sessionUser?.profileImageUrl ?? null}
            comments={comments}
            activeCommentId={paneId === activePaneId ? activeCommentId : null}
            activeCommentRevision={activeCommentRevision}
            focusCollaboratorRequest={
              paneId === activePaneId ? focusCollaboratorRequest : null
            }
            editorBraceMatching={editorBraceMatching}
            editorHighlightSelectionMatches={editorHighlightSelectionMatches}
            editorInEditorFind={editorInEditorFind}
            editorAutocomplete={editorAutocomplete}
            editorAutoCloseLatexBeginEnd={editorAutoCloseLatexBeginEnd}
            onCreateComment={onCreateComment}
            onTextLimitExceeded={onTextLimitExceeded}
            onCommentLineNumbersChange={(nextFileLineNumbers) =>
              onCommentLineNumbersChange(paneActiveFile, nextFileLineNumbers)
            }
          />
        ) : paneActiveAsset ? (
          <AssetPreview
            projectId={projectId}
            fileName={paneActiveFile}
            storageKey={paneActiveAsset.storageKey}
            mimeType={paneActiveAsset.mimeType}
            shareToken={shareToken}
          />
        ) : !initialSyncDone ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex items-center gap-3 text-sm text-cz-text-muted">
              <span className="cz-spinner shrink-0" aria-hidden="true" />
              Loading document...
            </div>
          </div>
        ) : hasProjectEntries ? (
          <div className="flex h-full items-center justify-center text-sm text-cz-text-muted">
            <div className="flex flex-col items-center gap-2">
              <MousePointerClick size={32} className="opacity-30" />
              <span>Select a file from the Files panel to start editing.</span>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-cz-text-muted">
            <div className="flex flex-col items-center gap-2">
              <FilePlus2 size={32} className="opacity-30" />
              <span>
                No files in this project yet. Create one from the Files panel.
              </span>
            </div>
          </div>
        )}

        {paneDropZone && (
          <div className="pointer-events-none absolute inset-0 z-40 p-2">
            <div
              className={`absolute rounded-md border-2 border-cz-accent bg-cz-accent/15 ${
                paneDropZone === "center"
                  ? "inset-2"
                  : paneDropZone === "right"
                    ? "bottom-2 right-2 top-2 w-[50%]"
                    : "bottom-2 left-2 right-2 h-[50%]"
              }`}
            />
          </div>
        )}
      </div>
    </div>
  );
});
