import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { Eye, FolderTree, History as HistoryIcon, MessageSquare, X } from "lucide-react";
import { CommentsPanel } from "@/sidebar/CommentsPanel";
import { ChatPanel } from "@/sidebar/ChatPanel";
import { FileTree } from "@/sidebar/FileTree";

import { HistoryPanel } from "@/sidebar/HistoryPanel";
import { HtmlPreview } from "@/preview/HtmlPreview";
import { CompilePreview } from "@/preview/CompilePreview";
import { ResizeHandle } from "@/components/ResizeHandle";
import { ShareModal } from "./ShareModal";
import { ReferenceLookupModal } from "./ReferenceLookupModal";
import { Toolbar } from "./Toolbar";
import { EditorPane } from "@/editor/EditorPane";
import { PaneLayout } from "@/editor/PaneLayout";
import { PopupDialog } from "@/components/PopupDialog";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { useProjectSharing } from "@/hooks/use-project-sharing";
import { useCollabSession } from "./hooks/use-collab-session";
import { useProjectComments } from "./hooks/use-project-comments";
import { useCompile } from "./hooks/use-compile";
import { useHtmlPreview } from "./hooks/use-html-preview";
import { useProjectFiles } from "./hooks/use-project-files";
import { usePaneLayout } from "./hooks/use-pane-layout";
import { useTextFileSizes } from "./hooks/use-text-file-sizes";
import type { EditorMode, SessionUser, WorkspaceTab } from "@/types";
import { parseFileMetadata, withFileId } from "@/utils/file-metadata";
import {
  detectProjectFormatFromFilename,
  shouldScheduleAutoCompileForDocChange,
  type ProjectFormat,
} from "@/utils/project-format";
import { restoreVersion } from "@/sidebar/history-api";
import { apiFetch, getErrorMessage } from "@/utils/fetch";
import { WorkspaceProjectTitle } from "@/components/WorkspaceProjectTitle";
import { navigateToProjects, navigateToSettings } from "@/utils/route";
import {
  findWorkspaceTabByPath,
  isDiffWorkspaceTab,
  isFileWorkspaceTab,
  workspaceTabReferencesFile,
} from "@/editor/workspace-tabs";

interface ProjectWorkspaceProps {
  projectId: string;
  session: {
    accountLabel: string;
    accountEmail: string | null;
    accountImageUrl: string | null;
    accountIsGuest: boolean;
    user: SessionUser | null;
    principal: {
      userId: string | null;
      guestId: string | null;
    };
  };
  shareToken?: string;
  autoCompileDefault: boolean;
  autoCompileTimeoutSeconds: number;
  autoSaveOnCompile: boolean;
  autoSaveOnExport: boolean;
  editorBraceMatching: boolean;
  editorHighlightSelectionMatches: boolean;
  editorInEditorFind: boolean;
  editorAutocomplete: boolean;
  editorAutoCloseLatexBeginEnd: boolean;
  onLogin: () => void;
  onLogout: () => void;
  onPopupAlert: (message: string, title?: string) => void;
  projectTitle: string;
  entrypoint: string;
  defaultBibliographyFile: string | null;
  referenceLookupFormat?: "bibtex" | "biblatex";
  /** When set and the user can edit the project, the sidebar title supports inline rename (Enter to save). */
  onRenameProject?: (nextTitle: string) => Promise<void>;
}

const cornerHitSizePx = 14;

export function ProjectWorkspace({
  projectId,
  session,
  shareToken,
  autoCompileDefault,
  autoCompileTimeoutSeconds,
  autoSaveOnCompile,
  autoSaveOnExport,
  editorBraceMatching,
  editorHighlightSelectionMatches,
  editorInEditorFind,
  editorAutocomplete,
  editorAutoCloseLatexBeginEnd,
  onLogin,
  onLogout,
  onPopupAlert,
  projectTitle,
  entrypoint,
  defaultBibliographyFile,
  referenceLookupFormat,
  onRenameProject,
}: ProjectWorkspaceProps) {
  const {
    accountLabel,
    accountEmail,
    accountImageUrl,
    accountIsGuest,
    user: sessionUser,
    principal,
  } = session;

  const isMobileSidebarLayout = useIsMobile();
  const [rightPreviewPinnedFilePath, setRightPreviewPinnedFilePath] =
    useState<string | null>(null);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showReferenceLookup, setShowReferenceLookup] = useState(false);
  const [showDuplicateCitationDialog, setShowDuplicateCitationDialog] =
    useState(false);
  const [projectEntrypoint, setProjectEntrypoint] = useState<string | null>(
    () => entrypoint.trim() || null,
  );
  const [projectDefaultBibliographyFile, setProjectDefaultBibliographyFile] =
    useState<string | null>(defaultBibliographyFile);
  const [projectReferenceLookupFormat, setProjectReferenceLookupFormat] =
    useState<"bibtex" | "biblatex">(referenceLookupFormat ?? "bibtex");
  const [lastFocusedEditorFile, setLastFocusedEditorFile] =
    useState<string>("");
  const [editorMode, setEditorMode] = useState<EditorMode>("view");
  const lastFocusedEditorFileRef = useRef<string>("");
  const duplicateCitationDecisionResolverRef = useRef<
    ((allowDuplicate: boolean) => void) | null
  >(null);

  const shareHeaders = useMemo<Record<string, string>>(
    () =>
      shareToken
        ? { "X-Share-Token": shareToken }
        : ({} as Record<string, string>),
    [shareToken],
  );

  const {
    peopleWithAccess,
    linkEnabled,
    linkRole,
    accessRole,
    canViewChat,
    maxTextFileSizeBytes,
    largeFileThresholdChars,
    chatHistoryRetentionDays,
    inviteEmail,
    setInviteEmail,
    inviteRole,
    setInviteRole,
    inviting,
    setLinkRole,
    inviteMember,
    updateMemberRole,
    setLinkSharing,
    invalidateLinkSharing,
    shareUrl,
  } = useProjectSharing({
    projectId,
    shareToken,
    shareHeaders,
    onPopupAlert,
  });

  const bumpHistoryRefresh = useCallback(() => {
    setHistoryRefreshKey((k) => k + 1);
  }, []);

  const {
    ydoc,
    chatYdoc,
    provider,
    chatProvider,
    connectionState,
    chatConnectionState,
    initialSyncDone,
    activeEditors,
    focusCollaboratorRequest,
    focusCollaborator,
  } = useCollabSession({
    projectId,
    shareToken,
    canOpenChat: canViewChat,
    onHistoryUpdated: bumpHistoryRefresh,
  });

  // Server-provided project metadata wins whenever it (or the project)
  // changes (previously an effect; the focused-file ref catches up via its
  // sync effect below).
  const [prevMetadataProps, setPrevMetadataProps] = useState({
    projectId,
    entrypoint,
    defaultBibliographyFile,
    referenceLookupFormat,
  });
  if (
    prevMetadataProps.projectId !== projectId ||
    prevMetadataProps.entrypoint !== entrypoint ||
    prevMetadataProps.defaultBibliographyFile !== defaultBibliographyFile ||
    prevMetadataProps.referenceLookupFormat !== referenceLookupFormat
  ) {
    setPrevMetadataProps({
      projectId,
      entrypoint,
      defaultBibliographyFile,
      referenceLookupFormat,
    });
    setProjectEntrypoint(entrypoint.trim() || null);
    setProjectDefaultBibliographyFile(defaultBibliographyFile);
    setProjectReferenceLookupFormat(referenceLookupFormat ?? "bibtex");
    setLastFocusedEditorFile("");
  }

  // The right-preview pin is per-project.
  const [prevPinProjectId, setPrevPinProjectId] = useState(projectId);
  if (prevPinProjectId !== projectId) {
    setPrevPinProjectId(projectId);
    setRightPreviewPinnedFilePath(null);
  }

  useEffect(() => {
    lastFocusedEditorFileRef.current = lastFocusedEditorFile;
  }, [lastFocusedEditorFile]);

  useEffect(() => {
    return () => {
      duplicateCitationDecisionResolverRef.current?.(false);
      duplicateCitationDecisionResolverRef.current = null;
    };
  }, []);

  const rememberLastFocusedEditorFile = useCallback((path: string) => {
    if (!path) {
      return;
    }
    if (lastFocusedEditorFileRef.current === path) {
      return;
    }
    lastFocusedEditorFileRef.current = path;
    setLastFocusedEditorFile(path);
  }, []);

  const {
    fileMap,
    textFilePaths,
    allFilePaths,
    assetInfoByPath,
    availableFilePathList,
  } = useProjectFiles({ ydoc, initialSyncDone });

  const {
    sidebarOpen,
    setSidebarOpen,
    sidebarTab,
    setSidebarTab,
    sidebarWidth,
    previewOpen,
    setPreviewOpen,
    previewWidth,
    activeFile,
    setActiveFile,
    activePaneId,
    focusedEditorPaneId,
    paneStateById,
    editorLayout,
    paneDropHint,
    isResizingSidebar,
    isResizingPreview,
    setHoveredCornerKey,
    splitGeometry,
    forcedActiveSplitIds,
    sidebarBoundaryResizeActive,
    previewBoundaryResizeActive,
    layoutRef,
    editorLayoutSurfaceRef,
    openTabs,
    activeTab,
    activeDiffTab,
    activeFilePath,
    focusPane,
    openFileInPane,
    openFileFromTree,
    openDiffTab,
    activateTab,
    promoteTab,
    moveTab,
    closeTab,
    replaceDiffTabWithLiveFile,
    handleDropPathsOnTabs,
    togglePaneSnippetToolbar,
    handlePaneDragOver,
    handlePaneDragLeave,
    handlePaneDrop,
    handlePaneEditorFocusChange,
    setActiveDiffModeForPane,
    setActiveDiffBaseForPane,
    resizeSidebar,
    resizePreview,
    resizeEditorSplit,
    resizeEditorCorner,
    applyFileRenameToPanes,
    applyFileDeleteToPanes,
    readPaneState,
  } = usePaneLayout({
    projectId,
    shareHeaders,
    allFilePaths,
    initialSyncDone,
    connectionState,
    isMobileSidebarLayout,
    onEditorFileFocused: rememberLastFocusedEditorFile,
  });

  const projectFormat = useMemo<ProjectFormat>(() => {
    return detectProjectFormatFromFilename(activeFilePath) ?? "latex";
  }, [activeFilePath]);

  const openTabsRef = useRef<WorkspaceTab[]>([]);
  // Two-step memo keeps the array's identity stable while the SET of visible
  // text files is unchanged, so the byte-size store below is not recreated
  // (and its sizes not recomputed) by unrelated pane interactions.
  const visibleTextFilePathsKey = useMemo(() => {
    const paths = new Set<string>();
    for (const pane of Object.values(paneStateById)) {
      if (pane.activePath && textFilePaths.has(pane.activePath)) {
        paths.add(pane.activePath);
      }
    }
    return Array.from(paths).sort().join("\u0000");
  }, [paneStateById, textFilePaths]);
  const visibleTextFilePaths = useMemo(
    () =>
      visibleTextFilePathsKey.length > 0
        ? visibleTextFilePathsKey.split("\u0000")
        : [],
    [visibleTextFilePathsKey],
  );

  const { resolveTextFileSizeBytes, handleTextLimitExceeded } =
    useTextFileSizes({
      ydoc,
      visibleTextFilePaths,
      maxTextFileSizeBytes,
      onPopupAlert,
    });

  const activeRightPreviewFilePath = useMemo(() => {
    if (!activeFilePath || !activeTab || !isFileWorkspaceTab(activeTab)) {
      return "";
    }
    return activeFilePath;
  }, [activeFilePath, activeTab]);

  const isRightPreviewPinned = useMemo(() => {
    return (
      rightPreviewPinnedFilePath != null &&
      allFilePaths.has(rightPreviewPinnedFilePath)
    );
  }, [allFilePaths, rightPreviewPinnedFilePath]);

  const rightPreviewFilePath = useMemo(() => {
    if (isRightPreviewPinned && rightPreviewPinnedFilePath) {
      return rightPreviewPinnedFilePath;
    }
    return activeRightPreviewFilePath;
  }, [activeRightPreviewFilePath, isRightPreviewPinned, rightPreviewPinnedFilePath]);

  const rightPreviewFormat = useMemo<ProjectFormat>(() => {
    if (isRightPreviewPinned && rightPreviewFilePath) {
      return detectProjectFormatFromFilename(rightPreviewFilePath) ?? "latex";
    }
    return projectFormat;
  }, [isRightPreviewPinned, projectFormat, rightPreviewFilePath]);

  const canPinRightPreview = useMemo(() => {
    return (
      !isRightPreviewPinned &&
      activeRightPreviewFilePath.length > 0
    );
  }, [activeRightPreviewFilePath, isRightPreviewPinned]);

  const toggleRightPreviewPin = useCallback(() => {
    if (isRightPreviewPinned) {
      setRightPreviewPinnedFilePath(null);
      return;
    }
    if (!canPinRightPreview) {
      return;
    }
    setRightPreviewPinnedFilePath(activeRightPreviewFilePath);
  }, [activeRightPreviewFilePath, canPinRightPreview, isRightPreviewPinned]);

  useEffect(() => {
    openTabsRef.current = openTabs;
  }, [openTabs]);

  // A pinned preview whose file vanished unpins itself.
  if (
    rightPreviewPinnedFilePath &&
    !allFilePaths.has(rightPreviewPinnedFilePath)
  ) {
    setRightPreviewPinnedFilePath(null);
  }

  // Once synced, an entrypoint pointing at a deleted file is cleared.
  if (initialSyncDone && projectEntrypoint && !allFilePaths.has(projectEntrypoint)) {
    setProjectEntrypoint(null);
  }

  const activeEntrypoint = useMemo(() => {
    if (!projectEntrypoint) {
      return null;
    }
    return allFilePaths.has(projectEntrypoint) ? projectEntrypoint : null;
  }, [allFilePaths, projectEntrypoint]);

  const activeDefaultBibliographyFile = useMemo(() => {
    if (!projectDefaultBibliographyFile) {
      return null;
    }
    return allFilePaths.has(projectDefaultBibliographyFile)
      ? projectDefaultBibliographyFile
      : null;
  }, [allFilePaths, projectDefaultBibliographyFile]);

  const patchProjectMetadata = useCallback(
    async (patch: {
      rootFile?: string | null;
      defaultBibliographyFile?: string | null;
      referenceLookupFormat?: "bibtex" | "biblatex";
    }) => {
      const res = await apiFetch(`/projects/${projectId}/metadata`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...shareHeaders,
        },
        body: JSON.stringify(patch),
      });

      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: "Failed to update project metadata" }));
        throw new Error(String(err.error ?? "Failed to update project metadata"));
      }

      return (await res.json()) as {
        rootFile?: string;
        defaultBibliographyFile?: string | null;
        referenceLookupFormat?: "bibtex" | "biblatex";
      };
    },
    [projectId, shareHeaders],
  );

  const handleSetEntrypoint = useCallback(
    async (path: string | null) => {
      const next = await patchProjectMetadata({ rootFile: path });
      const resolvedPath =
        typeof next.rootFile === "string" && next.rootFile.trim().length > 0
          ? next.rootFile
          : null;
      setProjectEntrypoint(resolvedPath);
    },
    [patchProjectMetadata],
  );

  const handleSetDefaultBibliography = useCallback(
    async (path: string | null) => {
      const next = await patchProjectMetadata({ defaultBibliographyFile: path });
      setProjectDefaultBibliographyFile(next.defaultBibliographyFile ?? null);
    },
    [patchProjectMetadata],
  );

  // A default bibliography pointing at a deleted file is cleaned up on the
  // server, then locally once the PATCH settles. The UI already ignores the
  // stale value via activeDefaultBibliographyFile, and the in-flight ref
  // prevents duplicate PATCHes while allFilePaths keeps changing.
  const bibliographyCleanupPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialSyncDone) {
      return;
    }

    const stalePath = projectDefaultBibliographyFile;
    if (!stalePath || allFilePaths.has(stalePath)) {
      return;
    }
    if (bibliographyCleanupPathRef.current === stalePath) {
      return;
    }

    bibliographyCleanupPathRef.current = stalePath;
    void patchProjectMetadata({ defaultBibliographyFile: null })
      .catch(() => {
        /* best-effort cleanup */
      })
      .finally(() => {
        bibliographyCleanupPathRef.current = null;
        setProjectDefaultBibliographyFile((prev) =>
          prev === stalePath ? null : prev,
        );
      });
  }, [
    allFilePaths,
    initialSyncDone,
    patchProjectMetadata,
    projectDefaultBibliographyFile,
  ]);

  const handleReferenceLookupFormatChange = useCallback(
    (nextFormat: "bibtex" | "biblatex") => {
      setProjectReferenceLookupFormat(nextFormat);
      if (nextFormat === projectReferenceLookupFormat) {
        return;
      }

      void patchProjectMetadata({ referenceLookupFormat: nextFormat })
        .then((next) => {
          setProjectReferenceLookupFormat(next.referenceLookupFormat ?? nextFormat);
        })
        .catch((err) => {
          setProjectReferenceLookupFormat(projectReferenceLookupFormat);
          onPopupAlert(getErrorMessage(err), "Could not save citation format");
        });
    },
    [
      onPopupAlert,
      patchProjectMetadata,
      projectReferenceLookupFormat,
    ],
  );

  const escapeRegExp = useCallback((raw: string): string => {
    return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }, []);

  const extractCitationKey = useCallback((citation: string): string | null => {
    const match = /@\w+\s*\{\s*([^,\s]+)\s*,/i.exec(citation);
    const key = match?.[1]?.trim() ?? "";
    return key.length > 0 ? key : null;
  }, []);

  const bibliographyAlreadyContainsCitation = useCallback(
    (bibliographyContent: string, citation: string): boolean => {
      const normalizedCitation = citation.trim().replace(/\r\n/g, "\n");
      const normalizedBibliography = bibliographyContent.replace(/\r\n/g, "\n");

      if (!normalizedCitation) {
        return false;
      }

      if (normalizedBibliography.includes(normalizedCitation)) {
        return true;
      }

      const key = extractCitationKey(normalizedCitation);
      if (!key) {
        return false;
      }

      const keyPattern = new RegExp(
        `@\\w+\\s*\\{\\s*${escapeRegExp(key)}\\s*,`,
        "i",
      );
      return keyPattern.test(normalizedBibliography);
    },
    [escapeRegExp, extractCitationKey],
  );

  const compileCurrentFile = useMemo(() => {
    if (activeFilePath && allFilePaths.has(activeFilePath)) {
      return activeFilePath;
    }
    return "";
  }, [activeFilePath, allFilePaths]);

  const appendCitationToDefaultBibliography = useCallback(
    async (
      citation: string,
      options?: { allowDuplicate?: boolean },
    ): Promise<{ added: boolean; duplicate: boolean }> => {
      const targetPath = activeDefaultBibliographyFile;
      if (!targetPath) {
        throw new Error("No default bibliography file is configured for this project.");
      }

      const existing = fileMap.get(targetPath);
      if (typeof existing !== "string") {
        throw new Error("Default bibliography file is missing.");
      }

      const meta = parseFileMetadata(existing);
      if (meta.type !== "text") {
        throw new Error("Default bibliography file is not a text file.");
      }

      const text = ydoc.getText(`file:${targetPath}`);
      const current = text.toString();
      const duplicate = bibliographyAlreadyContainsCitation(current, citation);

      if (duplicate && !options?.allowDuplicate) {
        return { added: false, duplicate: true };
      }

      ydoc.transact(() => {
        const separator = current.length === 0 ? "" : current.endsWith("\n") ? "\n" : "\n\n";
        text.insert(text.length, `${separator}${citation}\n`);
      }, "composure:add-reference-citation");

      return { added: true, duplicate };
    },
    [
      activeDefaultBibliographyFile,
      bibliographyAlreadyContainsCitation,
      fileMap,
      ydoc,
    ],
  );

  const requestDuplicateCitationConfirmation = useCallback((): Promise<boolean> => {
    return new Promise((resolve) => {
      duplicateCitationDecisionResolverRef.current = resolve;
      setShowDuplicateCitationDialog(true);
    });
  }, []);

  const resolveDuplicateCitationConfirmation = useCallback(
    (allowDuplicate: boolean) => {
      setShowDuplicateCitationDialog(false);
      const resolver = duplicateCitationDecisionResolverRef.current;
      duplicateCitationDecisionResolverRef.current = null;
      resolver?.(allowDuplicate);
    },
    [],
  );

  const handleAddCitationToBibliography = useCallback(
    async (citation: string): Promise<{ added: boolean }> => {
      try {
        const initialAttempt = await appendCitationToDefaultBibliography(citation);
        if (initialAttempt.duplicate) {
          const shouldAddDuplicate =
            await requestDuplicateCitationConfirmation();
          if (!shouldAddDuplicate) {
            return { added: false };
          }

          await appendCitationToDefaultBibliography(citation, {
            allowDuplicate: true,
          });
          return { added: true };
        }

        return { added: initialAttempt.added };
      } catch (err) {
        onPopupAlert(getErrorMessage(err), "Could not add citation");
        throw err;
      }
    },
    [
      appendCitationToDefaultBibliography,
      onPopupAlert,
      requestDuplicateCitationConfirmation,
    ],
  );

  const canComment =
    accessRole === "owner" || accessRole === "edit" || accessRole === "comment";
  const canEdit = accessRole === "owner" || accessRole === "edit";
  const canOpenChat = canViewChat;
  const canChat = canComment;
  const canCommentLive = canComment && connectionState === "connected";
  const canEditLive = canEdit && connectionState === "connected";
  const canChatLive = canChat && canOpenChat && chatConnectionState === "connected";
  const canManageAccess = accessRole === "owner" && Boolean(sessionUser?.id);
  const effectiveMode: EditorMode =
    editorMode === "edit" && !canEditLive
      ? canCommentLive
        ? "comment"
        : "view"
      : editorMode === "comment" && !canCommentLive
        ? "view"
        : editorMode;
  const canInteractWithComments = canCommentLive && effectiveMode !== "view";

  const {
    comments,
    activeCommentId,
    activeCommentRevision,
    commentLineNumbersById,
    activateComment,
    hoverComment,
    endHoverComment,
    setCommentLineNumbersForFile,
    createComment,
    updateComment,
    removeComment,
  } = useProjectComments({
    projectId,
    shareHeaders,
    ydoc,
    canInteractWithComments,
    activeFile,
  });

  const handleRestoreVersion = useCallback(
    async (sha: string) => {
      try {
        await restoreVersion(projectId, sha);
        setHistoryRefreshKey((k) => k + 1);
      } catch (err) {
        onPopupAlert(getErrorMessage(err), "Restore failed");
      }
    },
    [projectId, onPopupAlert],
  );

  // The editor mode tracks live permissions: downgraded when they drop,
  // upgraded to edit when they arrive (previously an effect; runs once on
  // mount and then whenever the live capabilities change).
  const [prevModeCaps, setPrevModeCaps] = useState<{
    canEditLive: boolean;
    canCommentLive: boolean;
  } | null>(null);
  if (
    prevModeCaps === null ||
    prevModeCaps.canEditLive !== canEditLive ||
    prevModeCaps.canCommentLive !== canCommentLive
  ) {
    setPrevModeCaps({ canEditLive, canCommentLive });
    setEditorMode((prev) => {
      if (prev === "edit" && !canEditLive) {
        return canCommentLive ? "comment" : "view";
      }
      if (prev === "comment" && !canCommentLive) {
        return "view";
      }
      if (prev === "view" && canEditLive) {
        return "edit";
      }
      return prev;
    });
  }

  // Losing chat access closes the chat tab.
  if (!canOpenChat && sidebarTab === "chat") {
    setSidebarTab("files");
  }

  const activeFileRef = useRef("");
  useEffect(() => {
    activeFileRef.current =
      activeTab && isFileWorkspaceTab(activeTab) ? activeTab.path : "";
  });

  // Follow renames/moves: when the active file is deleted and a new key is
  // added in the same Yjs transaction (rename/move), switch to the new path
  // so collaborators stay on the same document instead of landing on a blank
  // page or jumping to the first alphabetical file.
  useEffect(() => {
    if (!initialSyncDone) return;

    const handler = (event: Y.YMapEvent<string>) => {
      const current = activeFileRef.current;
      if (!current) return;

      const change = event.changes.keys.get(current);
      if (!change || change.action !== "delete") return;

      // Collect keys added in the same transaction
      const added: string[] = [];
      event.changes.keys.forEach((info, key) => {
        if (info.action === "add") added.push(key);
      });

      if (added.length === 0) {
        // Pure deletion — fall back to a remaining open tab, then first file.
        const fallbackFromTabs = openTabsRef.current
          .map((tab) => tab.path)
          .find((path) => path !== current && fileMap.has(path));
        const remainingFiles = Array.from(fileMap.entries())
          .filter(([, raw]) => parseFileMetadata(raw).type !== "folder")
          .map(([path]) => path)
          .sort();

        if (fallbackFromTabs || remainingFiles.length > 0) {
          const nextPath = fallbackFromTabs ?? remainingFiles[0];
          setActiveFile(nextPath);
          console.info(`[app] active-file-recovered path=${nextPath}`);
        } else {
          setActiveFile("");
          console.info("[app] active-file-cleared no-files-remaining");
        }
        return;
      }

      // Try to find the best match: same basename first, then any added key
      const oldName = current.split("/").pop()!;
      const match =
        added.find((k) => k.split("/").pop() === oldName) ?? added[0];
      setActiveFile(match);
      console.info(`[app] active-file-followed old=${current} new=${match}`);
    };

    fileMap.observe(handler);
    return () => fileMap.unobserve(handler);
  }, [fileMap, initialSyncDone, setActiveFile]);

  const compileDefaultRootFile = useMemo(() => {
    if (activeEntrypoint) {
      return activeEntrypoint;
    }
    if (activeFilePath && allFilePaths.has(activeFilePath)) {
      return activeFilePath;
    }
    return "";
  }, [activeEntrypoint, activeFilePath, allFilePaths]);

  const autoCompileScheduleEligible = useMemo(
    () =>
      shouldScheduleAutoCompileForDocChange({
        hasEntrypoint: activeEntrypoint != null,
        compileRootPath: compileDefaultRootFile,
        activeEditorPath: activeFilePath,
        rightPreviewPath: rightPreviewFilePath,
        previewPaneOpen: previewOpen,
      }),
    [
      activeEntrypoint,
      activeFilePath,
      compileDefaultRootFile,
      previewOpen,
      rightPreviewFilePath,
    ],
  );

  const {
    pdfUrl,
    compileError,
    compiling,
    clearingCompileOutput,
    autoCompileEnabled,
    setAutoCompileEnabled,
    exporting,
    saving,
    handleSave,
    handleCompile,
    handleCompileCurrentFile,
    canCompileCurrentFile,
    handleExport,
    handleClearCompileOutput,
  } = useCompile({
    projectId,
    shareToken,
    shareHeaders,
    ydoc,
    provider,
    canEdit,
    initialSyncDone,
    autoCompileDefault,
    autoCompileTimeoutSeconds,
    autoSaveOnCompile,
    autoSaveOnExport,
    activeDiffTab,
    activeFilePath,
    compileCurrentFile,
    compileDefaultRootFile,
    autoCompileScheduleEligible,
    onHistoryChanged: bumpHistoryRefresh,
    onPopupAlert,
  });

  const markdownHtml = useHtmlPreview({
    ydoc,
    rightPreviewFilePath,
    rightPreviewFormat,
    initialSyncDone,
  });

  const renameFile = useCallback(
    (path: string, nextPath: string) => {
      const trimmed = nextPath.trim();
      if (!trimmed || trimmed === path || fileMap.has(trimmed)) {
        return false;
      }

      const rawMeta = fileMap.get(path) ?? "";
      const meta = withFileId(parseFileMetadata(rawMeta));
      const normalizedMeta = JSON.stringify(meta);

      if (meta.type === "asset") {
        // Asset rename: just move the map key, no YText
        ydoc.transact(() => {
          fileMap.delete(path);
          fileMap.set(trimmed, rawMeta);
        }, "composure:rename-asset");
      } else {
        // Text file rename
        ydoc.transact(() => {
          const source = ydoc.getText(`file:${path}`).toString();
          const target = ydoc.getText(`file:${trimmed}`);
          target.delete(0, target.length);
          target.insert(0, source);
          const previous = ydoc.getText(`file:${path}`);
          previous.delete(0, previous.length);
          fileMap.delete(path);
          fileMap.set(trimmed, normalizedMeta);
        }, "composure:rename-file");
      }

      applyFileRenameToPanes(path, trimmed);
      if (projectEntrypoint === path) {
        setProjectEntrypoint(trimmed);
        void patchProjectMetadata({ rootFile: trimmed }).catch(() => {
          /* best-effort sync */
        });
      }
      if (projectDefaultBibliographyFile === path) {
        setProjectDefaultBibliographyFile(trimmed);
        void patchProjectMetadata({ defaultBibliographyFile: trimmed }).catch(() => {
          /* best-effort sync */
        });
      }
      if (lastFocusedEditorFileRef.current === path) {
        rememberLastFocusedEditorFile(trimmed);
      }
      return true;
    },
    [
      fileMap,
      ydoc,
      applyFileRenameToPanes,
      patchProjectMetadata,
      projectDefaultBibliographyFile,
      projectEntrypoint,
      rememberLastFocusedEditorFile,
    ],
  );

  const deleteFile = useCallback(
    (path: string) => {
      if (!fileMap.has(path)) {
        return false;
      }

      const rawMeta = fileMap.get(path) ?? "";
      const meta = withFileId(parseFileMetadata(rawMeta));

      const remainingFiles = Array.from(fileMap.entries())
        .filter(
          ([candidatePath, raw]) =>
            candidatePath !== path && parseFileMetadata(raw).type !== "folder",
        )
        .map(([candidatePath]) => candidatePath)
        .sort();

      const tabIndex = openTabs.findIndex((tab) =>
        workspaceTabReferencesFile(tab, path),
      );
      const fallbackFromTabs =
        tabIndex === -1
          ? ""
          : (openTabs[tabIndex + 1]?.path ??
            openTabs[tabIndex - 1]?.path ??
            "");

      if (meta.type === "asset") {
        // Asset delete: just remove from map (server deletion handled by FileTree)
        fileMap.delete(path);
      } else {
        ydoc.transact(() => {
          const text = ydoc.getText(`file:${path}`);
          text.delete(0, text.length);
          fileMap.delete(path);
        }, "composure:delete-file");
      }

      applyFileDeleteToPanes(path, fallbackFromTabs, remainingFiles[0] ?? "");

      if (projectEntrypoint === path) {
        setProjectEntrypoint(null);
      }
      if (projectDefaultBibliographyFile === path) {
        setProjectDefaultBibliographyFile(null);
        void patchProjectMetadata({ defaultBibliographyFile: null }).catch(() => {
          /* best-effort sync */
        });
      }
      if (lastFocusedEditorFileRef.current === path) {
        lastFocusedEditorFileRef.current = "";
        setLastFocusedEditorFile("");
      }
      return true;
    },
    [
      fileMap,
      ydoc,
      openTabs,
      applyFileDeleteToPanes,
      patchProjectMetadata,
      projectDefaultBibliographyFile,
      projectEntrypoint,
    ],
  );

  const hasProjectEntries = fileMap.size > 0;

  const handlePaneHistoryRestored = useCallback(
    (paneId: string, restoredFilePath: string) => {
      bumpHistoryRefresh();

      const pane = readPaneState(paneId);
      const activeTabInPane = pane
        ? findWorkspaceTabByPath(pane.tabs, pane.activePath)
        : null;
      if (activeTabInPane && isDiffWorkspaceTab(activeTabInPane)) {
        replaceDiffTabWithLiveFile(
          paneId,
          activeTabInPane.path,
          restoredFilePath,
        );
        return;
      }

      openFileInPane(paneId, restoredFilePath, "persistent");
      focusPane(paneId, restoredFilePath);
    },
    [
      bumpHistoryRefresh,
      readPaneState,
      replaceDiffTabWithLiveFile,
      openFileInPane,
      focusPane,
    ],
  );

  const handleTreeSelect = useCallback(
    (path: string) => {
      openFileFromTree(path, "ephemeral");
    },
    [openFileFromTree],
  );

  const handleTreeSelectPersistent = useCallback(
    (path: string) => {
      openFileFromTree(path, "persistent");
    },
    [openFileFromTree],
  );

  const renderPane = (paneId: string) => {
    const paneState = paneStateById[paneId] ?? {
      tabs: [],
      activePath: "",
      showSnippetToolbar: true,
    };
    const paneActiveTab = findWorkspaceTabByPath(
      paneState.tabs,
      paneState.activePath,
    );
    const paneActiveDiffTab =
      paneActiveTab && isDiffWorkspaceTab(paneActiveTab)
        ? paneActiveTab
        : null;
    const paneActiveFile = paneState.activePath;
    const paneHasActiveTextFile =
      paneActiveTab !== null &&
      isFileWorkspaceTab(paneActiveTab) &&
      paneActiveFile.length > 0 &&
      textFilePaths.has(paneActiveFile);
    const paneTextLimitBytes =
      typeof maxTextFileSizeBytes === "number" ? maxTextFileSizeBytes : null;
    const paneTextSizeBytes = paneHasActiveTextFile
      ? resolveTextFileSizeBytes(paneActiveFile)
      : null;
    const paneTextOverLimit =
      paneHasActiveTextFile &&
      paneTextLimitBytes !== null &&
      paneTextSizeBytes !== null &&
      paneTextSizeBytes > paneTextLimitBytes;
    const paneActiveAsset =
      paneActiveTab !== null &&
      isFileWorkspaceTab(paneActiveTab) &&
      paneActiveFile.length > 0
        ? (assetInfoByPath[paneActiveFile] ?? null)
        : null;
    const paneDropZone =
      paneDropHint?.paneId === paneId ? paneDropHint.zone : null;

    return (
      <EditorPane
        key={paneId}
        paneId={paneId}
        paneState={paneState}
        activePaneId={activePaneId}
        focusedEditorPaneId={focusedEditorPaneId}
        paneDropZone={paneDropZone}
        projectId={projectId}
        shareToken={shareToken}
        activeDiffTab={paneActiveDiffTab}
        canEdit={canEdit}
        onActiveDiffModeChange={setActiveDiffModeForPane}
        onActiveDiffBaseChange={setActiveDiffBaseForPane}
        onHistoryRestored={handlePaneHistoryRestored}
        onPopupAlert={onPopupAlert}
        paneActiveFile={paneActiveFile}
        paneHasActiveTextFile={paneHasActiveTextFile}
        paneTextOverLimit={paneTextOverLimit}
        paneTextSizeBytes={paneTextSizeBytes}
        paneTextLimitBytes={paneTextLimitBytes}
        paneActiveAsset={paneActiveAsset}
        initialSyncDone={initialSyncDone}
        hasProjectEntries={hasProjectEntries}
        provider={provider}
        ydoc={ydoc}
        availableFilePaths={availableFilePathList}
        maxTextFileSizeBytes={maxTextFileSizeBytes}
        largeFileThresholdChars={largeFileThresholdChars}
        effectiveMode={effectiveMode}
        canInteractWithComments={canInteractWithComments}
        sessionUser={sessionUser}
        accountLabel={accountLabel}
        principalGuestId={principal.guestId}
        comments={comments}
        activeCommentId={activeCommentId}
        activeCommentRevision={activeCommentRevision}
        focusCollaboratorRequest={focusCollaboratorRequest}
        editorBraceMatching={editorBraceMatching}
        editorHighlightSelectionMatches={editorHighlightSelectionMatches}
        editorInEditorFind={editorInEditorFind}
        editorAutocomplete={editorAutocomplete}
        editorAutoCloseLatexBeginEnd={editorAutoCloseLatexBeginEnd}
        onCreateComment={createComment}
        onTextLimitExceeded={handleTextLimitExceeded}
        onCommentLineNumbersChange={setCommentLineNumbersForFile}
        onFocusPane={focusPane}
        onActivateTab={activateTab}
        onCloseTab={closeTab}
        onPromoteTab={promoteTab}
        onMoveTab={moveTab}
        onDropPathsOnTabs={handleDropPathsOnTabs}
        onToggleSnippetToolbar={togglePaneSnippetToolbar}
        onPaneDragOver={handlePaneDragOver}
        onPaneDragLeave={handlePaneDragLeave}
        onPaneDrop={handlePaneDrop}
        onPaneEditorFocusChange={handlePaneEditorFocusChange}
      />
    );
  };

  return (
    <div
      id="app-root"
      className="flex h-screen w-screen overflow-hidden bg-cz-bg"
    >
      {sidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close sidebar"
        />
      )}

      <aside
        className={`${isResizingSidebar ? "" : "transition-sidebar"} fixed inset-y-0 left-0 z-50 flex h-full w-72 max-w-[calc(100vw-2rem)] flex-col border-r border-cz-border bg-cz-surface shadow-2xl transition-transform duration-200 lg:static lg:z-auto lg:h-auto lg:max-w-none lg:shadow-none ${
          sidebarOpen
            ? "translate-x-0 opacity-100"
            : "-translate-x-full opacity-0 pointer-events-none lg:w-0 lg:translate-x-0 lg:overflow-hidden"
        }`}
        style={sidebarOpen && !isMobileSidebarLayout ? { width: sidebarWidth } : undefined}
      >
        <div
          className="flex items-center justify-between border-b border-cz-border px-4"
          style={{ height: "var(--toolbar-height)" }}
        >
          <WorkspaceProjectTitle
            className="min-w-0 flex-1 text-sm font-semibold tracking-tight text-cz-text"
            title={projectTitle}
            canRename={canEdit}
            onBack={navigateToProjects}
            fillWidth
            onRename={onRenameProject}
            onRenameError={(message) => onPopupAlert(message, "Rename failed")}
          />
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-cz-text-muted transition-colors hover:bg-cz-surface-hover hover:text-cz-text lg:hidden"
            aria-label="Close sidebar"
            title="Close sidebar"
          >
            <X size={16} />
          </button>
        </div>
        <div
          className={`grid ${canOpenChat ? "grid-cols-4" : "grid-cols-3"} border-b border-cz-border`}
          style={{ height: "var(--sub-toolbar-height)" }}
        >
          <button
            onClick={() => setSidebarTab("files")}
            className={`inline-flex h-full items-center justify-center ${sidebarTab === "files" ? "bg-cz-accent-muted text-cz-accent" : "text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text"}`}
            aria-label="Files"
            title="Files"
          >
            <FolderTree size={14} />
            <span className="sr-only">Files</span>
          </button>
          <button
            onClick={() => setSidebarTab("review")}
            className={`inline-flex h-full items-center justify-center ${sidebarTab === "review" ? "bg-cz-accent-muted text-cz-accent" : "text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text"}`}
            aria-label="Review"
            title="Review"
          >
            <Eye size={14} />
            <span className="sr-only">Review</span>
          </button>
          {canOpenChat ? (
            <button
              onClick={() => setSidebarTab("chat")}
              className={`inline-flex h-full items-center justify-center ${sidebarTab === "chat" ? "bg-cz-accent-muted text-cz-accent" : "text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text"}`}
              aria-label="Chat"
              title="Chat"
            >
              <MessageSquare size={14} />
              <span className="sr-only">Chat</span>
            </button>
          ) : null}
          <button
            onClick={() => setSidebarTab("history")}
            className={`inline-flex h-full items-center justify-center ${sidebarTab === "history" ? "bg-cz-accent-muted text-cz-accent" : "text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text"}`}
            aria-label="History"
            title="History"
          >
            <HistoryIcon size={14} />
            <span className="sr-only">History</span>
          </button>
        </div>

        {sidebarTab === "files" ? (
          <FileTree
            fileMap={fileMap}
            ydoc={ydoc}
            projectId={projectId}
            shareHeaders={shareHeaders}
            activeFile={activeFilePath}
            isDocumentLoading={!initialSyncDone}
            entrypointPath={activeEntrypoint}
            defaultBibliographyPath={activeDefaultBibliographyFile}
            onSetEntrypoint={handleSetEntrypoint}
            onSetDefaultBibliography={handleSetDefaultBibliography}
            onSelect={handleTreeSelect}
            onSelectPersistent={handleTreeSelectPersistent}
            onRename={renameFile}
            onDelete={deleteFile}
          />
        ) : sidebarTab === "review" ? (
          <CommentsPanel
            activeFile={activeFilePath}
            comments={comments}
            commentLineNumbersById={commentLineNumbersById}
            canComment={canInteractWithComments}
            canModerate={accessRole === "owner" && canInteractWithComments}
            onActivateComment={activateComment}
            onHoverComment={hoverComment}
            onHoverCommentEnd={endHoverComment}
            principalUserId={principal.userId}
            principalGuestId={principal.guestId}
            onReplyComment={createComment}
            onEditComment={updateComment}
            onDeleteComment={removeComment}
          />
        ) : sidebarTab === "chat" && canOpenChat ? (
          <ChatPanel
            ydoc={chatYdoc}
            provider={chatProvider}
            canSend={canChatLive}
            localUser={{
              name: accountLabel,
              userId: principal.userId,
              guestId: principal.guestId,
              profileImageUrl: sessionUser?.profileImageUrl ?? null,
            }}
            historyRetentionDays={chatHistoryRetentionDays}
          />
        ) : (
          <HistoryPanel
            projectId={projectId}
            onViewDiff={(sha, filePath, mode) => {
              openDiffTab(sha, filePath, mode ?? "ephemeral");
            }}
            canEdit={canEdit}
            refreshKey={historyRefreshKey}
            onRestoreVersion={(sha) => void handleRestoreVersion(sha)}
          />
        )}
      </aside>

      {sidebarOpen && (
        <div className="hidden lg:block">
          <ResizeHandle
            orientation="vertical"
            ariaLabel="Resize sidebar"
            forceActive={sidebarBoundaryResizeActive}
            onMouseDown={resizeSidebar}
          />
        </div>
      )}

      <div className="flex flex-1 flex-col min-w-0">
        <Toolbar
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((o) => !o)}
          onOpenSettings={navigateToSettings}
          onLogout={onLogout}
          onLogin={onLogin}
          accountLabel={accountLabel}
          accountEmail={accountEmail}
          accountImageUrl={accountImageUrl}
          accountIsGuest={accountIsGuest}
          canEdit={canEditLive}
          canComment={canCommentLive}
          mode={effectiveMode}
          onModeChange={setEditorMode}
          onOpenShare={() => setShowShareModal(true)}
          onCompile={() => {
            void handleCompile();
          }}
          onCompileCurrentFile={handleCompileCurrentFile}
          canCompileCurrentFile={canCompileCurrentFile}
          compileCurrentFilePath={compileCurrentFile}
          onClearCompileOutput={() => {
            void handleClearCompileOutput();
          }}
          hasCompiledOutput={pdfUrl != null}
          clearingCompileOutput={clearingCompileOutput}
          autoCompileEnabled={autoCompileEnabled}
          autoCompileTimeoutSeconds={autoCompileTimeoutSeconds}
          onAutoCompileChange={setAutoCompileEnabled}
          onSave={handleSave}
          saving={saving}
          connectionState={connectionState}
          compiling={compiling}
          activeFile={activeFilePath}
          activeEditors={activeEditors}
          onFocusCollaborator={focusCollaborator}
          onOpenReferenceLookup={() => setShowReferenceLookup(true)}
          projectFormat={projectFormat}
          onExport={handleExport}
          exporting={exporting}
          previewOpen={previewOpen}
          onTogglePreview={() => setPreviewOpen((open) => !open)}
          projectId={projectId}
          onViewDiff={(sha, filePath, mode) => {
            openDiffTab(sha, filePath, mode ?? "ephemeral");
          }}
          activeDiffTab={activeDiffTab}
        />

        <div ref={layoutRef} className="relative flex flex-1 min-h-0">
          <div
            ref={editorLayoutSurfaceRef}
            className="relative min-h-0 min-w-0 flex-1"
          >
            <PaneLayout
              node={editorLayout}
              renderPane={renderPane}
              forcedActiveSplitIds={forcedActiveSplitIds}
              onResizeSplit={resizeEditorSplit}
            />

            {splitGeometry.corners.map((corner) => (
              <div
                key={corner.key}
                aria-hidden="true"
                style={{
                  left: corner.x,
                  top: corner.y,
                  width: cornerHitSizePx,
                  height: cornerHitSizePx,
                  cursor: "move",
                  pointerEvents: "auto",
                }}
                className="absolute z-40 -translate-x-1/2 -translate-y-1/2"
                onPointerEnter={() => {
                  setHoveredCornerKey(corner.key);
                }}
                onPointerLeave={() => {
                  setHoveredCornerKey((prev) =>
                    prev === corner.key ? null : prev,
                  );
                }}
                onMouseDown={(event) => {
                  resizeEditorCorner(event, corner);
                }}
              />
            ))}
          </div>

          {previewOpen && (
            <>
              <ResizeHandle
                orientation="vertical"
                ariaLabel="Resize preview"
                forceActive={previewBoundaryResizeActive}
                onMouseDown={resizePreview}
              />

              <div
                className="relative min-w-[300px]"
                style={{ width: previewWidth }}
              >
                {rightPreviewFormat === "markdown" ||
                rightPreviewFormat === "asciidoc" ? (
                  <HtmlPreview
                    html={markdownHtml}
                    error={null}
                    pinControl={
                      isRightPreviewPinned || canPinRightPreview
                        ? {
                            pinned: isRightPreviewPinned,
                            onToggle: toggleRightPreviewPin,
                          }
                        : null
                    }
                  />
                ) : (
                  <CompilePreview
                    pdfUrl={pdfUrl}
                    error={compileError}
                    documentName="Compile"
                    compiling={compiling}
                    pinControl={
                      isRightPreviewPinned || canPinRightPreview
                        ? {
                            pinned: isRightPreviewPinned,
                            onToggle: toggleRightPreviewPin,
                          }
                        : null
                    }
                  />
                )}

                {isResizingPreview && (
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 z-50 cursor-col-resize"
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <ShareModal
        open={showShareModal}
        inviteEmail={inviteEmail}
        inviteRole={inviteRole}
        inviting={inviting}
        linkEnabled={linkEnabled}
        linkRole={linkRole}
        people={peopleWithAccess}
        canManage={canManageAccess}
        shareUrl={shareUrl}
        onClose={() => setShowShareModal(false)}
        onInviteEmailChange={setInviteEmail}
        onInviteRoleChange={setInviteRole}
        onInvite={() => {
          void inviteMember();
        }}
        onMemberRoleChange={(memberId, role) => {
          void updateMemberRole(memberId, role);
        }}
        onLinkToggle={(enabled) => {
          void setLinkSharing(enabled, linkRole);
        }}
        onLinkRoleChange={(role) => {
          setLinkRole(role);
          void setLinkSharing(linkEnabled, role);
        }}
        onLinkInvalidate={() => {
          void invalidateLinkSharing();
        }}
      />

      <PopupDialog
        open={showDuplicateCitationDialog}
        title="Duplicate citation"
        message="This source is already in the target bibliography. Do you want to add a duplicate?"
        dismiss={{
          label: "Cancel",
          onClick: () => {
            resolveDuplicateCitationConfirmation(false);
          },
        }}
        actions={[
          {
            label: "Add Duplicate",
            onClick: () => {
              resolveDuplicateCitationConfirmation(true);
            },
            autoFocus: true,
          },
        ]}
      />

      <ReferenceLookupModal
        open={showReferenceLookup}
        onClose={() => setShowReferenceLookup(false)}
        canAddToBibliography={activeDefaultBibliographyFile != null && canEditLive}
        shareHeaders={shareHeaders}
        citationFormat={projectReferenceLookupFormat}
        onCitationFormatChange={handleReferenceLookupFormatChange}
        onAddToBibliography={handleAddCitationToBibliography}
      />
    </div>
  );
}
