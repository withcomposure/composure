import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { X } from "lucide-react";
import MarkdownIt from "markdown-it";
import Asciidoctor from "@asciidoctor/core";
import {
  CommentsPanel,
  type CommentLineNumbers,
} from "@/sidebar/CommentsPanel";
import { FileTree } from "@/sidebar/FileTree";
import { type FileTabsDropPayload } from "@/editor/FileTabs";

import { HistoryPanel } from "@/sidebar/HistoryPanel";
import { HtmlPreview } from "@/preview/HtmlPreview";
import { CompilePreview } from "@/preview/CompilePreview";
import { ResizeHandle } from "@/components/ResizeHandle";
import { ShareModal } from "./ShareModal";
import { Toolbar } from "./Toolbar";
import { EditorPane } from "@/editor/EditorPane";
import { PaneLayout } from "@/editor/PaneLayout";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { useResizeDrag } from "@/hooks/use-resize-drag";
import type {
  AccessPerson,
  ActiveCollaborator,
  ConnectionState,
  EditorMode,
  HistoryState,
  ProjectComment,
  ProjectAccessResponse,
  ShareRole,
  SessionUser,
  WorkspaceTab,
} from "@/types";
import {
  parseFileMetadata,
  withFileId,
  type FileMetadata,
} from "@/utils/file-metadata";
import {
  detectProjectFormatFromFilename,
  type ProjectFormat,
} from "@/utils/project-format";
import {
  ROOT_PANE_ID,
  buildPersistedWorkspaceState,
  defaultPersistedWorkspaceState,
  getNextPaneIdCounter,
  getNextSplitIdCounter,
  parsePersistedWorkspaceState,
  shouldEnableWorkspaceStatePersistence,
  shouldReconcileWorkspaceFromFileMap,
  shouldResetWorkspaceForProjectChange,
  type EditorLayoutNode,
  type EditorPaneState,
  type SplitOrientation,
} from "@/editor/workspace-state";
import {
  hasAwarenessCursor,
  uint8ArrayToBase64,
} from "@/utils/page-utils";
import { restoreVersion } from "@/sidebar/history-api";
import { collaborationWsUrl } from "@/utils/api-routing";
import { apiFetch, apiUrl, getErrorMessage } from "@/utils/fetch";
import { WorkspaceProjectTitle } from "@/components/WorkspaceProjectTitle";
import { makeProjectUrl, navigateToProjects, navigateToSettings } from "@/utils/route";
import {
  applyDroppedPathsToPaneState,
  removeDroppedTabPathsFromSource,
} from "@/editor/tab-drop-state";
import { evaluateUtf8Limit, formatBinarySize } from "@/utils/text-size";
import {
  buildSplitGeometry,
  collectPaneIds,
  computeDropZone,
  dedupePaths,
  insertSplitAtPane,
  readDraggedFilePayload,
  removePaneFromLayout,
  type SplitDropZone,
} from "./layout-utils";
import {
  createEditorCornerResizeHandler,
  createEditorSplitResizeHandler,
  createPreviewResizeHandler,
  createSidebarResizeHandler,
} from "./resize-handlers";

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
  /** When set and the user can edit the project, the sidebar title supports inline rename (Enter to save). */
  onRenameProject?: (nextTitle: string) => Promise<void>;
}

const cornerHitSizePx = 14;

function pdfPreviewStorageKey(projectId: string): string {
  return `composure:pdfUrl:${projectId}`;
}

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

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<"files" | "review" | "history">(
    "files",
  );
  const [historyState, setHistoryState] = useState<HistoryState | null>(null);
  const [preHistoryFile, setPreHistoryFile] = useState("");
  const [diffMode, setDiffMode] = useState<"side-by-side" | "inline">(
    "side-by-side",
  );
  const [activeFile, setActiveFile] = useState("");
  const [activePaneId, setActivePaneId] = useState(ROOT_PANE_ID);
  const [focusedEditorPaneId, setFocusedEditorPaneId] = useState<string | null>(
    null,
  );
  const [paneStateById, setPaneStateById] = useState<
    Record<string, EditorPaneState>
  >({
    [ROOT_PANE_ID]: { tabs: [], activePath: "", showSnippetToolbar: true },
  });
  const [editorLayout, setEditorLayout] = useState<EditorLayoutNode>({
    kind: "pane",
    paneId: ROOT_PANE_ID,
  });
  const [paneDropHint, setPaneDropHint] = useState<{
    paneId: string;
    zone: SplitDropZone;
  } | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const isMobileSidebarLayout = useIsMobile();
  const [previewWidth, setPreviewWidth] = useState(520);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [pdfUrl, setPdfUrl] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(pdfPreviewStorageKey(projectId));
    } catch {
      return null;
    }
  });
  const [compileError, setCompileError] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [clearingCompileOutput, setClearingCompileOutput] = useState(false);
  const [autoCompileEnabled, setAutoCompileEnabled] =
    useState(autoCompileDefault);
  const [autoCompileRevision, setAutoCompileRevision] = useState(0);
  const [markdownHtml, setMarkdownHtml] = useState("");
  const [exporting, setExporting] = useState(false);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");
  const [saving, setSaving] = useState(false);
  const [initialSyncDone, setInitialSyncDone] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [comments, setComments] = useState<ProjectComment[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<ShareRole>("view");
  const [inviting, setInviting] = useState(false);
  const [peopleWithAccess, setPeopleWithAccess] = useState<AccessPerson[]>([]);
  const [linkEnabled, setLinkEnabled] = useState(false);
  const [linkRole, setLinkRole] = useState<ShareRole>("view");
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [maxTextFileSizeBytes, setMaxTextFileSizeBytes] = useState<
    number | "unlimited"
  >(5 * 1024 * 1024);
  const [largeFileThresholdChars, setLargeFileThresholdChars] =
    useState(500_000);
  const [accessRole, setAccessRole] = useState<ShareRole | "owner" | null>(
    null,
  );
  const [editorMode, setEditorMode] = useState<EditorMode>("view");
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(
    null,
  );
  const [hoveredCommentId, setHoveredCommentId] = useState<string | null>(null);
  const [commentLineNumbersById, setCommentLineNumbersById] = useState<
    Record<string, CommentLineNumbers>
  >({});
  const [activeCommentRevision, setActiveCommentRevision] = useState(0);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [isResizingPreview, setIsResizingPreview] = useState(false);
  const [activeEditors, setActiveEditors] = useState<ActiveCollaborator[]>([]);
  const [focusCollaboratorRequest, setFocusCollaboratorRequest] = useState<{
    clientId: number;
    revision: number;
  } | null>(null);
  const [editorLayoutSurfaceSize, setEditorLayoutSurfaceSize] = useState({
    width: 0,
    height: 0,
  });
  const [hoveredCornerKey, setHoveredCornerKey] = useState<string | null>(null);
  const [draggingCornerSplitIds, setDraggingCornerSplitIds] = useState<
    [string, string] | null
  >(null);
  const [textByteSizeByPath, setTextByteSizeByPath] = useState<
    Record<string, number>
  >({});
  const inFlightSaveCountRef = useRef(0);
  const lastTextLimitPopupAtRef = useRef(0);
  const lastAutoCompiledRevisionRef = useRef(0);
  const autoCompileRevisionRef = useRef(0);
  const paneIdCounterRef = useRef(2);
  const splitIdCounterRef = useRef(1);
  const previousProjectIdRef = useRef(projectId);
  const ydocProjectIdRef = useRef(projectId);
  const markdownDebounceTimerRef = useRef<number | null>(null);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const editorLayoutSurfaceRef = useRef<HTMLDivElement | null>(null);
  const sidebarWidthRef = useRef(sidebarWidth);
  const [workspaceStateLoaded, setWorkspaceStateLoaded] = useState(false);
  const lastPersistedWorkspaceStateRef = useRef<string | null>(null);
  const [ydoc, setYdoc] = useState(() => new Y.Doc());
  const activeCommentId = hoveredCommentId ?? selectedCommentId;
  const openTabs = useMemo(
    () => paneStateById[activePaneId]?.tabs ?? [],
    [paneStateById, activePaneId],
  );

  const setOpenTabs = useCallback(
    (updater: WorkspaceTab[] | ((prev: WorkspaceTab[]) => WorkspaceTab[])) => {
      setPaneStateById((prev) => {
        const pane = prev[activePaneId] ?? {
          tabs: [],
          activePath: "",
          showSnippetToolbar: true,
        };
        const nextTabs =
          typeof updater === "function" ? updater(pane.tabs) : updater;
        if (nextTabs === pane.tabs) {
          return prev;
        }
        return {
          ...prev,
          [activePaneId]: {
            ...pane,
            tabs: nextTabs,
          },
        };
      });
    },
    [activePaneId],
  );

  useEffect(() => {
    const element = editorLayoutSurfaceRef.current;
    if (!element) {
      return;
    }

    const updateSize = () => {
      const nextWidth = element.clientWidth;
      const nextHeight = element.clientHeight;
      setEditorLayoutSurfaceSize((prev) => {
        if (prev.width === nextWidth && prev.height === nextHeight) {
          return prev;
        }
        return { width: nextWidth, height: nextHeight };
      });
    };

    updateSize();
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(updateSize)
        : null;
    observer?.observe(element);
    window.addEventListener("resize", updateSize);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateSize);
    };
  }, []);

  const splitGeometry = useMemo(() => {
    return buildSplitGeometry(
      editorLayout,
      editorLayoutSurfaceSize.width,
      editorLayoutSurfaceSize.height,
      {
        includeLeftEdgeCorners: sidebarOpen && !isMobileSidebarLayout,
        includeRightEdgeCorners: previewOpen,
      },
    );
  }, [
    editorLayout,
    editorLayoutSurfaceSize.height,
    editorLayoutSurfaceSize.width,
    isMobileSidebarLayout,
    previewOpen,
    sidebarOpen,
  ]);

  const forcedActiveSplitIds = useMemo(() => {
    const next = new Set<string>();

    if (draggingCornerSplitIds) {
      next.add(draggingCornerSplitIds[0]);
      next.add(draggingCornerSplitIds[1]);
    }

    if (hoveredCornerKey) {
      const hoveredCorner = splitGeometry.corners.find(
        (corner) => corner.key === hoveredCornerKey,
      );
      if (hoveredCorner) {
        if (hoveredCorner.kind === "internal") {
          next.add(hoveredCorner.xSplitId);
          next.add(hoveredCorner.ySplitId);
        } else {
          next.add(hoveredCorner.rowSplitId);
        }
      }
    }

    return next;
  }, [draggingCornerSplitIds, hoveredCornerKey, splitGeometry.corners]);

  const sidebarBoundaryResizeActive = useMemo(() => {
    if (isResizingSidebar) {
      return true;
    }
    if (!hoveredCornerKey) {
      return false;
    }
    const hovered = splitGeometry.corners.find((c) => c.key === hoveredCornerKey);
    return hovered?.kind === "leftEdge";
  }, [hoveredCornerKey, isResizingSidebar, splitGeometry.corners]);

  const previewBoundaryResizeActive = useMemo(() => {
    if (isResizingPreview) {
      return true;
    }
    if (!hoveredCornerKey) {
      return false;
    }
    const hovered = splitGeometry.corners.find((c) => c.key === hoveredCornerKey);
    return hovered?.kind === "rightEdge";
  }, [hoveredCornerKey, isResizingPreview, splitGeometry.corners]);

  useEffect(() => {
    if (!hoveredCornerKey) {
      return;
    }

    const hasHoveredCorner = splitGeometry.corners.some(
      (corner) => corner.key === hoveredCornerKey,
    );
    if (!hasHoveredCorner) {
      setHoveredCornerKey(null);
    }
  }, [hoveredCornerKey, splitGeometry.corners]);

  const md = useMemo(
    () => MarkdownIt({ html: false, linkify: true, typographer: true }),
    [],
  );
  const adoc = useMemo(() => Asciidoctor(), []);

  const projectFormat = useMemo<ProjectFormat>(() => {
    return detectProjectFormatFromFilename(activeFile) ?? "latex";
  }, [activeFile]);

  useEffect(() => {
    // Fast Refresh can re-run this component while staying on the same route.
    // Keep the current Y.Doc unless the project ID actually changes.
    if (
      !shouldResetWorkspaceForProjectChange(ydocProjectIdRef.current, projectId)
    ) {
      return;
    }

    ydocProjectIdRef.current = projectId;
    setYdoc(() => new Y.Doc());
  }, [projectId]);

  useEffect(() => {
    setPaneStateById((prev) => {
      const pane = prev[activePaneId];
      if (!pane || pane.activePath === activeFile) {
        return prev;
      }
      return {
        ...prev,
        [activePaneId]: {
          ...pane,
          activePath: activeFile,
        },
      };
    });
  }, [activePaneId, activeFile]);

  useEffect(() => {
    // Ignore same-project reruns (including Fast Refresh). Resetting here for
    // an unchanged project would collapse panes/tabs and then persist that layout.
    if (
      !shouldResetWorkspaceForProjectChange(
        previousProjectIdRef.current,
        projectId,
      )
    ) {
      return;
    }

    previousProjectIdRef.current = projectId;
    const defaults = defaultPersistedWorkspaceState();
    setInitialSyncDone(false);
    setWorkspaceStateLoaded(false);
    lastPersistedWorkspaceStateRef.current = null;
    setActiveFile(defaults.activeFile);
    setActivePaneId(defaults.activePaneId);
    setPaneStateById(defaults.paneStateById);
    setEditorLayout(defaults.editorLayout);
    setSidebarOpen(defaults.sidebarOpen);
    setSidebarTab(defaults.sidebarTab);
    setSidebarWidth(defaults.sidebarWidth);
    sidebarWidthRef.current = defaults.sidebarWidth;
    setPreviewOpen(defaults.previewOpen);
    setPreviewWidth(defaults.previewWidth);
    setPaneDropHint(null);
    paneIdCounterRef.current = 2;
    splitIdCounterRef.current = 1;
  }, [projectId]);

  const fileMap = useMemo(() => ydoc.getMap<string>("files"), [ydoc]);
  const [textFilePaths, setTextFilePaths] = useState<Set<string>>(new Set());
  const [allFilePaths, setAllFilePaths] = useState<Set<string>>(new Set());
  const [assetInfoByPath, setAssetInfoByPath] = useState<
    Record<string, { storageKey?: string; mimeType?: string }>
  >({});
  const openTabsRef = useRef<WorkspaceTab[]>([]);
  const availableFilePathList = useMemo(
    () =>
      Array.from(allFilePaths).sort((left, right) => left.localeCompare(right)),
    [allFilePaths],
  );
  const visibleTextFilePaths = useMemo(() => {
    const paths = new Set<string>();
    for (const pane of Object.values(paneStateById)) {
      if (pane.activePath && textFilePaths.has(pane.activePath)) {
        paths.add(pane.activePath);
      }
    }
    return Array.from(paths);
  }, [paneStateById, textFilePaths]);

  useEffect(() => {
    openTabsRef.current = openTabs;
  }, [openTabs]);

  useEffect(() => {
    if (maxTextFileSizeBytes === "unlimited") {
      setTextByteSizeByPath({});
      return;
    }

    const trackedPaths = new Set(visibleTextFilePaths);
    setTextByteSizeByPath((prev) => {
      let changed = false;
      const next: Record<string, number> = {};
      for (const [path, size] of Object.entries(prev)) {
        if (trackedPaths.has(path)) {
          next[path] = size;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    const observers: Array<{ text: Y.Text; observer: () => void }> = [];

    const refreshPathSize = (filePath: string) => {
      const text = ydoc.getText(`file:${filePath}`);
      const { sizeBytes } = evaluateUtf8Limit(
        text.length,
        maxTextFileSizeBytes,
        () => text.toString(),
      );

      setTextByteSizeByPath((prev) => {
        if (prev[filePath] === sizeBytes) {
          return prev;
        }
        return {
          ...prev,
          [filePath]: sizeBytes,
        };
      });
    };

    for (const filePath of visibleTextFilePaths) {
      const text = ydoc.getText(`file:${filePath}`);
      const observer = () => {
        refreshPathSize(filePath);
      };
      text.observe(observer);
      observers.push({ text, observer });
      refreshPathSize(filePath);
    }

    return () => {
      for (const { text, observer } of observers) {
        text.unobserve(observer);
      }
    };
  }, [ydoc, visibleTextFilePaths, maxTextFileSizeBytes]);

  useEffect(() => {
    if (
      !shouldReconcileWorkspaceFromFileMap(initialSyncDone, connectionState)
    ) {
      return;
    }

    let nextActivePathForActivePane: string | null = null;

    setPaneStateById((prev) => {
      let changed = false;
      const next: Record<string, EditorPaneState> = {};

      for (const [paneId, paneState] of Object.entries(prev)) {
        const filteredTabs = paneState.tabs.filter((tab) =>
          allFilePaths.has(tab.path),
        );
        const activePath =
          paneState.activePath && allFilePaths.has(paneState.activePath)
            ? paneState.activePath
            : (filteredTabs[0]?.path ?? "");

        if (
          filteredTabs.length !== paneState.tabs.length ||
          activePath !== paneState.activePath
        ) {
          changed = true;
          if (paneId === activePaneId && activePath !== activeFile) {
            nextActivePathForActivePane = activePath;
          }
          next[paneId] = {
            tabs: filteredTabs,
            activePath,
            showSnippetToolbar: paneState.showSnippetToolbar,
          };
          continue;
        }

        next[paneId] = paneState;
      }

      return changed ? next : prev;
    });

    if (nextActivePathForActivePane !== null) {
      setActiveFile(nextActivePathForActivePane);
    }
  }, [
    allFilePaths,
    activePaneId,
    activeFile,
    connectionState,
    initialSyncDone,
  ]);

  useEffect(() => {
    if (paneStateById[activePaneId]) {
      return;
    }
    const nextActivePaneId = collectPaneIds(editorLayout)[0] ?? ROOT_PANE_ID;
    if (nextActivePaneId !== activePaneId) {
      setActivePaneId(nextActivePaneId);
      setActiveFile(paneStateById[nextActivePaneId]?.activePath ?? "");
    }
  }, [activePaneId, paneStateById, editorLayout]);

  useEffect(() => {
    let nextLayout = editorLayout;
    let nextPaneStateById = paneStateById;
    let paneIds = collectPaneIds(nextLayout);
    let changed = false;

    while (paneIds.length > 1) {
      const emptyPaneId = paneIds.find(
        (paneId) => (nextPaneStateById[paneId]?.tabs.length ?? 0) === 0,
      );
      if (!emptyPaneId) {
        break;
      }

      const collapsed = removePaneFromLayout(nextLayout, emptyPaneId);
      if (!collapsed) {
        break;
      }

      const remainingPanes = { ...nextPaneStateById };
      delete remainingPanes[emptyPaneId];
      nextPaneStateById = remainingPanes;
      nextLayout = collapsed;
      paneIds = collectPaneIds(nextLayout);
      changed = true;
    }

    if (!changed) {
      return;
    }

    setEditorLayout(nextLayout);
    setPaneStateById(nextPaneStateById);

    if (!nextPaneStateById[activePaneId]) {
      const fallbackPaneId = collectPaneIds(nextLayout)[0] ?? ROOT_PANE_ID;
      setActivePaneId(fallbackPaneId);
      setActiveFile(nextPaneStateById[fallbackPaneId]?.activePath ?? "");
    }
  }, [paneStateById, editorLayout, activePaneId]);

  useEffect(() => {
    if (!activeFile) return;
    setOpenTabs((prev) => {
      if (prev.some((tab) => tab.path === activeFile)) {
        return prev;
      }

      const previewIndex = prev.findIndex((tab) => tab.isEphemeral);
      if (previewIndex !== -1) {
        const next = [...prev];
        next[previewIndex] = { path: activeFile, isEphemeral: true };
        return next;
      }

      return [...prev, { path: activeFile, isEphemeral: true }];
    });
  }, [activeFile, setOpenTabs]);

  useEffect(() => {
    const update = () => {
      const nextTextPaths = new Set<string>();
      const nextAllPaths = new Set<string>();
      const nextAssetInfo: Record<
        string,
        { storageKey?: string; mimeType?: string }
      > = {};
      fileMap.forEach((raw: string, filePath: string) => {
        const meta = parseFileMetadata(raw);
        if (meta.type !== "folder") {
          nextAllPaths.add(filePath);
        }
        if (meta.type === "text") {
          nextTextPaths.add(filePath);
        }
        if (meta.type === "asset") {
          nextAssetInfo[filePath] = {
            storageKey: meta.storageKey,
            mimeType: meta.mimeType,
          };
        }
      });
      setTextFilePaths(nextTextPaths);
      setAllFilePaths(nextAllPaths);
      setAssetInfoByPath(nextAssetInfo);
    };

    update();
    fileMap.observe(update);
    return () => fileMap.unobserve(update);
  }, [fileMap]);

  useEffect(() => {
    if (!initialSyncDone) return;

    const updates: Array<{ filePath: string; value: string }> = [];
    fileMap.forEach((raw: string, filePath: string) => {
      const normalized = JSON.stringify(
        withFileId(parseFileMetadata(raw)) as FileMetadata,
      );
      if (raw !== normalized) {
        updates.push({ filePath, value: normalized });
      }
    });

    if (updates.length === 0) return;

    ydoc.transact(() => {
      for (const update of updates) {
        fileMap.set(update.filePath, update.value);
      }
    }, "composure:normalize-file-metadata");
  }, [fileMap, ydoc, initialSyncDone]);

  useEffect(() => {
    if (!initialSyncDone) return;

    if (activeFile && allFilePaths.has(activeFile)) {
      return;
    }

    if (activeFile) {
      const fallback =
        openTabs.find((tab) => allFilePaths.has(tab.path))?.path ?? "";
      setActiveFile(fallback);
    }
  }, [initialSyncDone, activeFile, allFilePaths, openTabs]);

  useEffect(() => {
    setAutoCompileEnabled(autoCompileDefault);
  }, [projectId, autoCompileDefault]);

  const focusCollaborator = useCallback((clientId: number) => {
    setFocusCollaboratorRequest((prev) => ({
      clientId,
      revision: prev ? prev.revision + 1 : 1,
    }));
  }, []);

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  const shareHeaders = useMemo<Record<string, string>>(
    () =>
      shareToken
        ? { "X-Share-Token": shareToken }
        : ({} as Record<string, string>),
    [shareToken],
  );

  useEffect(() => {
    let cancelled = false;

    const loadWorkspaceState = async () => {
      let loadSucceeded = false;

      try {
        const res = await apiFetch(`/projects/${projectId}/workspace-state`, {
          headers: shareHeaders,
        });

        if (!res.ok) {
          throw new Error(`status=${res.status}`);
        }

        const body = (await res.json()) as { state?: unknown };
        loadSucceeded = true;
        const parsed = parsePersistedWorkspaceState(body.state);
        if (cancelled) {
          return;
        }

        if (!parsed) {
          lastPersistedWorkspaceStateRef.current = null;
          return;
        }

        setSidebarOpen(parsed.sidebarOpen);
        setSidebarTab(parsed.sidebarTab);
        setSidebarWidth(parsed.sidebarWidth);
        sidebarWidthRef.current = parsed.sidebarWidth;
        setPreviewOpen(parsed.previewOpen);
        setPreviewWidth(parsed.previewWidth);
        setPaneStateById(parsed.paneStateById);
        setEditorLayout(parsed.editorLayout);

        const paneIds = collectPaneIds(parsed.editorLayout);
        const nextActivePaneId = paneIds.includes(parsed.activePaneId)
          ? parsed.activePaneId
          : (paneIds[0] ?? ROOT_PANE_ID);
        const nextActiveFile =
          parsed.activeFile ||
          parsed.paneStateById[nextActivePaneId]?.activePath ||
          "";

        setActivePaneId(nextActivePaneId);
        setActiveFile(nextActiveFile);
        paneIdCounterRef.current = getNextPaneIdCounter(
          parsed.editorLayout,
          parsed.paneStateById,
        );
        splitIdCounterRef.current = getNextSplitIdCounter(parsed.editorLayout);
        lastPersistedWorkspaceStateRef.current = JSON.stringify(parsed);
      } catch (err) {
        console.warn(`[app] load-workspace-state-failed ${String(err)}`);
      } finally {
        if (shouldEnableWorkspaceStatePersistence(loadSucceeded, cancelled)) {
          setWorkspaceStateLoaded(true);
        }
      }
    };

    void loadWorkspaceState();

    return () => {
      cancelled = true;
    };
  }, [projectId, shareHeaders]);

  const canComment =
    accessRole === "owner" || accessRole === "edit" || accessRole === "comment";
  const canEdit = accessRole === "owner" || accessRole === "edit";
  const canCommentLive = canComment && connectionState === "connected";
  const canEditLive = canEdit && connectionState === "connected";
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

  const persistedWorkspaceState = useMemo(
    () =>
      buildPersistedWorkspaceState({
        sidebarOpen,
        sidebarTab,
        sidebarWidth,
        previewOpen,
        previewWidth,
        activePaneId,
        activeFile,
        paneStateById,
        editorLayout,
      }),
    [
      sidebarOpen,
      sidebarTab,
      sidebarWidth,
      previewOpen,
      previewWidth,
      activePaneId,
      activeFile,
      paneStateById,
      editorLayout,
    ],
  );

  useEffect(() => {
    if (!workspaceStateLoaded) {
      return;
    }

    const serialized = JSON.stringify(persistedWorkspaceState);
    if (serialized === lastPersistedWorkspaceStateRef.current) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await apiFetch(
            `/projects/${projectId}/workspace-state`,
            {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                ...shareHeaders,
              },
              body: JSON.stringify({ state: persistedWorkspaceState }),
            },
          );

          if (!res.ok) {
            throw new Error(`status=${res.status}`);
          }

          lastPersistedWorkspaceStateRef.current = serialized;
        } catch (err) {
          console.warn(`[app] save-workspace-state-failed ${String(err)}`);
        }
      })();
    }, 450);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [workspaceStateLoaded, persistedWorkspaceState, projectId, shareHeaders]);

  const enterHistoryMode = useCallback(
    (sha: string, filePath: string) => {
      if (!historyState) {
        setPreHistoryFile(activeFile);
      }
      setHistoryState({ commitSha: sha, filePath, diffMode });
    },
    [historyState, activeFile, diffMode],
  );

  const exitHistoryMode = useCallback(() => {
    setHistoryState(null);
    if (preHistoryFile) {
      setActiveFile(preHistoryFile);
    }
  }, [preHistoryFile]);

  const handleRestoreVersion = useCallback(
    async (sha: string) => {
      try {
        await restoreVersion(projectId, sha);
        exitHistoryMode();
        setHistoryRefreshKey((k) => k + 1);
      } catch (err) {
        onPopupAlert(getErrorMessage(err), "Restore failed");
      }
    },
    [projectId, exitHistoryMode, onPopupAlert],
  );

  useEffect(() => {
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
  }, [canEditLive, canCommentLive]);

  useEffect(() => {
    setSelectedCommentId(null);
    setHoveredCommentId(null);
    setActiveCommentRevision((prev) => prev + 1);
  }, [activeFile]);

  useEffect(() => {
    setActiveCommentRevision((prev) => prev + 1);
  }, [activeCommentId]);

  useEffect(() => {
    setCommentLineNumbersById((prev) => {
      const validIds = new Set(comments.map((comment) => comment.id));
      let changed = false;
      const next: Record<string, CommentLineNumbers> = {};

      for (const [commentId, lines] of Object.entries(prev)) {
        if (validIds.has(commentId)) {
          next[commentId] = lines;
        } else {
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [comments]);

  const beginSaving = useCallback(() => {
    inFlightSaveCountRef.current += 1;
    setSaving(true);
  }, []);

  const endSaving = useCallback(() => {
    inFlightSaveCountRef.current = Math.max(
      0,
      inFlightSaveCountRef.current - 1,
    );
    if (inFlightSaveCountRef.current === 0) {
      setSaving(false);
    }
  }, []);

  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);

  useEffect(() => {
    const wsUrl = collaborationWsUrl(shareToken);

    setConnectionState("connecting");

    console.info(
      `[app] creating provider projectId=${projectId} wsUrl=${wsUrl}`,
    );

    const prov = new HocuspocusProvider({
      url: wsUrl,
      name: projectId,
      document: ydoc,
      onOpen: () => console.info(`[app] ws-open projectId=${projectId}`),
      onClose: ({ event }) => {
        console.info(
          `[app] ws-close projectId=${projectId} code=${event.code}`,
        );
        setConnectionState("disconnected");
      },
      onConnect: () => {
        console.info(`[app] provider-connected projectId=${projectId}`);
        setConnectionState("connected");
      },
      onDisconnect: () => {
        console.info(`[app] provider-disconnected projectId=${projectId}`);
        setConnectionState("disconnected");
      },
      onAuthenticated: () =>
        console.info(`[app] provider-authenticated projectId=${projectId}`),
      onAuthenticationFailed: ({ reason }: { reason: string }) => {
        console.error(
          `[app] provider-auth-FAILED projectId=${projectId} reason=${reason}`,
        );
        setConnectionState("disconnected");
      },
      onSynced: ({ state }) => {
        console.info(
          `[app] provider-synced projectId=${projectId} state=${state}`,
        );
        if (state) setInitialSyncDone(true);
      },
      onStatus: ({ status }) => {
        console.info(
          `[app] provider-status projectId=${projectId} status=${status}`,
        );
        if (
          status === "connected" ||
          status === "connecting" ||
          status === "disconnected"
        ) {
          setConnectionState(status);
        }
      },
      onMessage: (payload: unknown) => {
        const event =
          (payload as { event?: MessageEvent }).event ??
          (payload as MessageEvent);
        const bytes =
          typeof event.data === "string"
            ? event.data.length
            : event.data instanceof ArrayBuffer
              ? event.data.byteLength
              : 0;
        console.info(
          `[app] provider-incoming-message projectId=${projectId} bytes=${bytes}`,
        );
      },
    });

    setProvider(prov);

    const handleStateless = ({ payload }: { payload: string }) => {
      try {
        const msg = JSON.parse(payload);
        if (msg.type === "history-updated") {
          setHistoryRefreshKey((k) => k + 1);
        }
      } catch {
        /* ignore malformed payloads */
      }
    };
    prov.on("stateless", handleStateless);

    return () => {
      prov.off("stateless", handleStateless);
      setConnectionState("connecting");
      prov.destroy();
    };
  }, [projectId, shareToken, ydoc]);

  useEffect(() => {
    return () => {
      ydoc.destroy();
    };
  }, [ydoc]);

  const loadAccess = useCallback(async () => {
    try {
      const res = await apiFetch(`/projects/${projectId}/access`, {
        headers: shareHeaders,
      });

      if (!res.ok) {
        throw new Error("Failed to load project access");
      }

      const body = (await res.json()) as ProjectAccessResponse;
      setPeopleWithAccess(body.people);
      setLinkEnabled(body.linkSharing.enabled);
      setLinkRole(body.linkSharing.role ?? "view");
      setLinkToken(body.linkSharing.token);
      setAccessRole(body.currentRole);
      setMaxTextFileSizeBytes(body.maxTextFileSizeBytes);
      setLargeFileThresholdChars(body.largeFileThresholdChars);
    } catch (err) {
      console.warn(`[app] load-access-failed ${String(err)}`);
    }
  }, [projectId, shareHeaders]);

  const commentsSyncMap = useMemo(
    () => ydoc.getMap<string>("comments-sync"),
    [ydoc],
  );

  const signalCommentsChanged = useCallback(
    (action: "create" | "update" | "delete") => {
      ydoc.transact(() => {
        commentsSyncMap.set(
          "lastChange",
          `${Date.now()}:${Math.random().toString(36).slice(2)}:${action}`,
        );
      }, "composure:comments-changed");
    },
    [commentsSyncMap, ydoc],
  );

  const loadComments = useCallback(async () => {
    try {
      const res = await apiFetch(`/projects/${projectId}/comments`, {
        headers: shareHeaders,
      });

      if (!res.ok) {
        throw new Error("Failed to load comments");
      }

      const body = (await res.json()) as ProjectComment[];
      setComments(body);
    } catch (err) {
      console.warn(`[app] load-comments-failed ${String(err)}`);
    }
  }, [projectId, shareHeaders]);

  useEffect(() => {
    void loadAccess();
    void loadComments();
  }, [loadAccess, loadComments]);

  useEffect(() => {
    const handleCommentsSync = () => {
      void loadComments();
    };

    commentsSyncMap.observe(handleCommentsSync);
    return () => {
      commentsSyncMap.unobserve(handleCommentsSync);
    };
  }, [commentsSyncMap, loadComments]);

  const activeFileRef = useRef(activeFile);
  activeFileRef.current = activeFile;

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
  }, [fileMap, initialSyncDone]);

  const createPaneId = useCallback(() => {
    const paneId = `pane-${paneIdCounterRef.current}`;
    paneIdCounterRef.current += 1;
    return paneId;
  }, []);

  const createSplitId = useCallback(() => {
    const splitId = `split-${splitIdCounterRef.current}`;
    splitIdCounterRef.current += 1;
    return splitId;
  }, []);

  const openFileInPane = useCallback(
    (paneId: string, path: string, mode: "ephemeral" | "persistent") => {
      setPaneStateById((prev) => {
        const pane = prev[paneId] ?? {
          tabs: [],
          activePath: "",
          showSnippetToolbar: true,
        };
        const existingIndex = pane.tabs.findIndex((tab) => tab.path === path);
        let nextTabs = pane.tabs;

        if (existingIndex !== -1) {
          if (mode === "persistent" && pane.tabs[existingIndex].isEphemeral) {
            nextTabs = [...pane.tabs];
            nextTabs[existingIndex] = { path, isEphemeral: false };
          }
        } else if (mode === "ephemeral") {
          const previewIndex = pane.tabs.findIndex((tab) => tab.isEphemeral);
          if (previewIndex !== -1) {
            nextTabs = [...pane.tabs];
            nextTabs[previewIndex] = { path, isEphemeral: true };
          } else {
            nextTabs = [...pane.tabs, { path, isEphemeral: true }];
          }
        } else {
          nextTabs = [...pane.tabs, { path, isEphemeral: false }];
        }

        if (nextTabs === pane.tabs && pane.activePath === path) {
          return prev;
        }

        return {
          ...prev,
          [paneId]: {
            tabs: nextTabs,
            activePath: path,
            showSnippetToolbar: pane.showSnippetToolbar,
          },
        };
      });
    },
    [],
  );

  const focusPane = useCallback(
    (paneId: string, preferredPath?: string) => {
      setActivePaneId(paneId);
      if (preferredPath !== undefined) {
        setActiveFile(preferredPath);
        return;
      }
      setActiveFile(paneStateById[paneId]?.activePath ?? "");
    },
    [paneStateById],
  );

  const handlePaneEditorFocusChange = useCallback(
    (paneId: string, isFocused: boolean) => {
      setFocusedEditorPaneId((current) => {
        if (isFocused) {
          return paneId;
        }
        return current === paneId ? null : current;
      });
    },
    [],
  );

  const openFileFromTree = useCallback(
    (path: string, mode: "ephemeral" | "persistent") => {
      setHistoryState(null);
      openFileInPane(activePaneId, path, mode);
      focusPane(activePaneId, path);
    },
    [activePaneId, openFileInPane, focusPane],
  );

  const activateTab = useCallback(
    (paneId: string, path: string) => {
      setPaneStateById((prev) => {
        const pane = prev[paneId];
        if (!pane || pane.activePath === path) return prev;
        return {
          ...prev,
          [paneId]: {
            ...pane,
            activePath: path,
          },
        };
      });
      setHistoryState(null);
      focusPane(paneId, path);
    },
    [focusPane],
  );

  const promoteTab = useCallback(
    (paneId: string, path: string) => {
      setPaneStateById((prev) => {
        const pane = prev[paneId];
        if (!pane) return prev;
        const tabIndex = pane.tabs.findIndex((tab) => tab.path === path);
        if (tabIndex === -1 || !pane.tabs[tabIndex].isEphemeral) {
          return prev;
        }

        const nextTabs = [...pane.tabs];
        nextTabs[tabIndex] = { path, isEphemeral: false };

        return {
          ...prev,
          [paneId]: {
            tabs: nextTabs,
            activePath: path,
            showSnippetToolbar: pane.showSnippetToolbar,
          },
        };
      });
      setHistoryState(null);
      focusPane(paneId, path);
    },
    [focusPane],
  );

  const moveTab = useCallback(
    (paneId: string, path: string, targetIndex: number) => {
      setPaneStateById((prev) => {
        const pane = prev[paneId];
        if (!pane) return prev;

        const sourceIndex = pane.tabs.findIndex((tab) => tab.path === path);
        if (sourceIndex === -1) {
          return prev;
        }

        const nextTabs = [...pane.tabs];
        const [moved] = nextTabs.splice(sourceIndex, 1);
        let insertAt = targetIndex;
        if (insertAt > sourceIndex) {
          insertAt -= 1;
        }
        insertAt = Math.max(0, Math.min(insertAt, nextTabs.length));
        nextTabs.splice(insertAt, 0, {
          path: moved.path,
          isEphemeral: false,
        });

        return {
          ...prev,
          [paneId]: {
            tabs: nextTabs,
            activePath: path,
            showSnippetToolbar: pane.showSnippetToolbar,
          },
        };
      });
      setHistoryState(null);
      focusPane(paneId, path);
    },
    [focusPane],
  );

  const closeTab = useCallback(
    (paneId: string, path: string) => {
      let nextActivePath: string | null = null;

      setPaneStateById((prev) => {
        const pane = prev[paneId];
        if (!pane) return prev;

        const closeIndex = pane.tabs.findIndex((tab) => tab.path === path);
        if (closeIndex === -1) {
          return prev;
        }

        const nextTabs = pane.tabs.filter((tab) => tab.path !== path);
        const paneActivePath =
          pane.activePath === path
            ? (nextTabs[closeIndex]?.path ??
              nextTabs[closeIndex - 1]?.path ??
              "")
            : pane.activePath;
        nextActivePath = paneActivePath;

        return {
          ...prev,
          [paneId]: {
            tabs: nextTabs,
            activePath: paneActivePath,
            showSnippetToolbar: pane.showSnippetToolbar,
          },
        };
      });

      if (nextActivePath !== null && paneId === activePaneId) {
        setActiveFile(nextActivePath);
        if (nextActivePath) {
          setHistoryState(null);
        }
      }
    },
    [activePaneId],
  );

  const handleDropPathsOnTabs = useCallback(
    (paneId: string, payload: FileTabsDropPayload) => {
      const paths = dedupePaths(payload.paths).filter((path) =>
        allFilePaths.has(path),
      );
      if (paths.length === 0) {
        return;
      }

      setPaneStateById((prev) => {
        return applyDroppedPathsToPaneState(prev, paneId, paths, {
          fromTabBar: payload.fromTabBar,
          sourcePaneId: payload.sourcePaneId,
          targetIndex: payload.targetIndex,
        });
      });

      setHistoryState(null);
      focusPane(paneId, paths[paths.length - 1]);
    },
    [allFilePaths, focusPane],
  );

  const togglePaneSnippetToolbar = useCallback((paneId: string) => {
    setPaneStateById((prev) => {
      const pane = prev[paneId] ?? {
        tabs: [],
        activePath: "",
        showSnippetToolbar: true,
      };
      return {
        ...prev,
        [paneId]: {
          ...pane,
          showSnippetToolbar: !pane.showSnippetToolbar,
        },
      };
    });
  }, []);

  useEffect(() => {
    if (!initialSyncDone) return;

    ydoc.transact(() => {
      fileMap.forEach((mapContent, filePath) => {
        const metadata = parseFileMetadata(mapContent);
        if (metadata.type !== "text") {
          return;
        }

        const key = `file:${filePath}`;
        if (!ydoc.share.has(key)) {
          const text = ydoc.getText(key);
          let legacyContent = "";
          try {
            const parsed = JSON.parse(mapContent);
            if (!(parsed && typeof parsed === "object" && "type" in parsed)) {
              legacyContent = mapContent;
            }
          } catch {
            legacyContent = mapContent;
          }

          if (legacyContent) {
            text.insert(0, legacyContent);
          }
          console.info(
            `[app] initialized-ytext key=${key} fromMapContent=${legacyContent.length}`,
          );
        }
      });
    }, "composure:sync-file-map-to-texts");
  }, [fileMap, ydoc, initialSyncDone]);

  useEffect(() => {
    const onDocUpdate = (update: Uint8Array, origin: unknown) => {
      const originLabel =
        origin === provider
          ? "provider(remote)"
          : origin === null || origin === undefined
            ? "unknown"
            : typeof origin === "string"
              ? origin
              : ((origin as { constructor?: { name?: string } })?.constructor
                  ?.name ?? String(origin));
      console.info(
        `[app] ydoc-update bytes=${update.length} origin=${originLabel} sharedTypes=${ydoc.share.size}`,
      );
    };

    ydoc.on("update", onDocUpdate);
    return () => {
      ydoc.off("update", onDocUpdate);
    };
  }, [ydoc, provider]);

  useEffect(() => {
    const awareness = provider?.awareness;
    if (!awareness) return;

    const update = () => {
      const states = awareness.getStates();
      const localId = awareness.clientID;
      const seen = new Map<string, ActiveCollaborator>();

      states.forEach((state: Record<string, unknown>, clientId: number) => {
        if (clientId === localId) return;
        const user = state.user as
          | {
              name?: string;
              color?: string;
              userId?: string;
              guestId?: string;
              profileImageUrl?: string;
            }
          | undefined;
        if (!user) return;
        const key = user.userId ?? user.guestId ?? `c:${clientId}`;
        const next = {
          clientId,
          name: user.name ?? "Guest",
          color: user.color ?? "#6366f1",
          userId: user.userId ?? null,
          profileImageUrl: user.profileImageUrl ?? null,
          hasCursor: hasAwarenessCursor((state as { cursor?: unknown }).cursor),
        };

        const existing = seen.get(key);
        if (!existing || (!existing.hasCursor && next.hasCursor)) {
          seen.set(key, next);
        }
      });

      setActiveEditors(Array.from(seen.values()));
    };

    awareness.on("change", update);
    update();

    return () => {
      awareness.off("change", update);
    };
  }, [provider]);

  const persistSnapshot = useCallback(
    async (reason: "manual" | "autosave" | "compile") => {
      const documentUpdateBase64 = uint8ArrayToBase64(
        Y.encodeStateAsUpdate(ydoc),
      );

      if (!canEdit) {
        throw new Error("You do not have edit permissions for this project");
      }

      const res = await apiFetch(`/save/${projectId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...shareHeaders,
        },
        body: JSON.stringify({ documentUpdateBase64, reason }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(String(err.error ?? "Save failed"));
      }

      const body = await res.json();
      console.info(
        `[app] save-success projectId=${projectId} bytes=${String(body.bytes ?? "n/a")} reason=${reason}`,
      );
    },
    [projectId, ydoc, canEdit, shareHeaders],
  );

  const handleSave = useCallback(async () => {
    beginSaving();
    try {
      await persistSnapshot("manual");
      setHistoryRefreshKey((k) => k + 1);
    } catch (err) {
      console.error(`[app] manual-save-failed ${String(err)}`);
      onPopupAlert(getErrorMessage(err), "Save failed");
    } finally {
      endSaving();
    }
  }, [persistSnapshot, beginSaving, endSaving, onPopupAlert]);

  const clearCompileOutputLocally = useCallback(() => {
    setPdfUrl((prev) => {
      if (prev?.startsWith("blob:")) {
        URL.revokeObjectURL(prev);
      }
      return null;
    });

    try {
      sessionStorage.removeItem(pdfPreviewStorageKey(projectId));
    } catch {
      // Ignore storage failures in private mode or constrained environments.
    }
  }, [projectId]);

  const handleClearCompileOutput = useCallback(async () => {
    if (clearingCompileOutput) {
      return;
    }

    setClearingCompileOutput(true);
    try {
      const res = await apiFetch(
        `/projects/${encodeURIComponent(projectId)}/preview.pdf`,
        {
          method: "DELETE",
          headers: shareHeaders,
        },
      );

      if (!res.ok) {
        const err = await res.json().catch(async () => {
          const fallback = await res.text().catch(() => "");
          return { error: fallback || "Failed to clear compiled output" };
        });
        throw new Error(String(err.error ?? "Failed to clear compiled output"));
      }

      clearCompileOutputLocally();
      setCompileError(null);
    } catch (err) {
      onPopupAlert(getErrorMessage(err), "Clear output failed");
    } finally {
      setClearingCompileOutput(false);
    }
  }, [
    clearingCompileOutput,
    projectId,
    shareHeaders,
    clearCompileOutputLocally,
    onPopupAlert,
  ]);

  const handleCompile = useCallback(
    async (isAutoCompile = false) => {
      // Cancel any pending auto-compile timer by marking the current revision as handled.
      lastAutoCompiledRevisionRef.current = autoCompileRevisionRef.current;

      const isHistory = historyState != null;
      const rootFile = isHistory ? historyState.filePath : activeFile;

      if (!rootFile) {
        setCompileError("Create or select a file before compiling.");
        return;
      }

      setCompiling(true);
      setCompileError(null);
      try {
        if (!isHistory) {
          const shouldSave = autoSaveOnCompile && !isAutoCompile;
          if (shouldSave) {
            await persistSnapshot("compile").catch((err) => {
              console.warn(`[app] compile-pre-save-failed ${String(err)}`);
            });
          }
        }

        const compileBody: Record<string, unknown> = {
          projectId,
          rootFile,
          responseMode: "metadata",
        };

        if (isHistory) {
          compileBody.commitSha = historyState.commitSha;
        } else {
          compileBody.documentUpdateBase64 = uint8ArrayToBase64(
            Y.encodeStateAsUpdate(ydoc),
          );
        }

        console.info(
          `[app] compile-request projectId=${projectId} rootFile=${rootFile}${isHistory ? ` commitSha=${historyState.commitSha}` : ""}`,
        );
        const res = await apiFetch("/compile", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...shareHeaders,
          },
          body: JSON.stringify(compileBody),
        });
        if (!res.ok) {
          const err = await res.json().catch(async () => {
            const fallback = await res.text().catch(() => "");
            return { error: fallback || "Compilation failed" };
          });
          console.warn(
            `[app] compile-failed status=${res.status} error=${String(err.error ?? "unknown")}`,
          );
          setCompileError(err.error || "Compilation failed");
          return;
        }
        const contentType = res.headers.get("content-type") ?? "";
        const compileIdHeader = res.headers.get("x-compile-id") ?? undefined;
        let compileId = compileIdHeader;
        if (contentType.includes("application/json")) {
          const body = (await res
            .json()
            .catch(() => ({}) as { compileId?: string })) as {
            compileId?: string;
          };
          if (typeof body.compileId === "string" && body.compileId.length > 0) {
            compileId = body.compileId;
          }
        }

        const previewParams = new URLSearchParams();
        previewParams.set("v", compileId ?? String(Date.now()));
        if (shareToken) {
          previewParams.set("shareToken", shareToken);
        }
        const url = apiUrl(
          `/projects/${encodeURIComponent(projectId)}/preview.pdf?${previewParams.toString()}`,
        );
        console.info(
          `[app] compile-success compileId=${String(compileId ?? "none")} previewUrl=${url}`,
        );
        setPdfUrl((prev) => {
          if (prev?.startsWith("blob:")) {
            URL.revokeObjectURL(prev);
          }
          return url;
        });
        try {
          sessionStorage.setItem(pdfPreviewStorageKey(projectId), url);
        } catch {
          /* quota */
        }
        setHistoryRefreshKey((k) => k + 1);
      } catch (e: unknown) {
        console.error(`[app] compile-network-error ${String(e)}`);
        setCompileError(e instanceof Error ? e.message : "Network error");
      } finally {
        setCompiling(false);
      }
    },
    [
      projectId,
      activeFile,
      historyState,
      ydoc,
      persistSnapshot,
      shareHeaders,
      shareToken,
      autoSaveOnCompile,
    ],
  );

  const handleExport = useCallback(
    async (format: string) => {
      const rootFile = historyState?.filePath ?? activeFile;
      if (!rootFile) return;
      setExporting(true);
      try {
        if (autoSaveOnExport && !historyState && canEdit) {
          await persistSnapshot("compile").catch((err) => {
            console.warn(`[app] export-pre-save-failed ${String(err)}`);
          });
        }
        const exportBody: Record<string, unknown> = { format, rootFile };
        if (historyState) {
          exportBody.commitSha = historyState.commitSha;
        }
        const res = await apiFetch(
          `/export/${encodeURIComponent(projectId)}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...shareHeaders,
            },
            body: JSON.stringify(exportBody),
          },
        );
        if (!res.ok) {
          const err = await res
            .json()
            .catch(() => ({ error: "Export failed" }));
          onPopupAlert(err.error || "Export failed", "Export Error");
          return;
        }
        const blob = await res.blob();
        const disposition = res.headers.get("content-disposition") ?? "";
        const filenameMatch = /filename="?([^";\n]+)"?/.exec(disposition);
        const filename = filenameMatch?.[1] ?? `export.${format}`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        if (autoSaveOnExport) setHistoryRefreshKey((k) => k + 1);
      } catch (e: unknown) {
        onPopupAlert(
          e instanceof Error ? e.message : "Export failed",
          "Export Error",
        );
      } finally {
        setExporting(false);
      }
    },
    [
      projectId,
      activeFile,
      historyState,
      shareHeaders,
      onPopupAlert,
      autoSaveOnExport,
      canEdit,
      persistSnapshot,
    ],
  );

  useEffect(() => {
    const onDocUpdate = (_update: Uint8Array, origin: unknown) => {
      if (!autoCompileEnabled || !canEdit || !initialSyncDone || !activeFile)
        return;
      if (origin === provider) return;
      if (typeof origin === "string" && origin.startsWith("composure:")) return;
      setAutoCompileRevision((prev) => {
        const next = prev + 1;
        autoCompileRevisionRef.current = next;
        return next;
      });
    };

    ydoc.on("update", onDocUpdate);
    return () => {
      ydoc.off("update", onDocUpdate);
    };
  }, [
    ydoc,
    provider,
    autoCompileEnabled,
    canEdit,
    initialSyncDone,
    activeFile,
  ]);

  useEffect(() => {
    if (
      !autoCompileEnabled ||
      !canEdit ||
      !initialSyncDone ||
      !activeFile ||
      compiling
    )
      return;
    if (autoCompileRevision <= lastAutoCompiledRevisionRef.current) return;

    const timeout = window.setTimeout(() => {
      lastAutoCompiledRevisionRef.current = autoCompileRevision;
      void handleCompile(true);
    }, autoCompileTimeoutSeconds * 1000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    autoCompileEnabled,
    canEdit,
    initialSyncDone,
    activeFile,
    compiling,
    autoCompileRevision,
    autoCompileTimeoutSeconds,
    handleCompile,
  ]);

  // Live Markdown/AsciiDoc preview: render on doc changes with 300ms debounce
  useEffect(() => {
    if (
      (projectFormat !== "markdown" && projectFormat !== "asciidoc") ||
      !activeFile ||
      !initialSyncDone
    )
      return;

    const renderPreview = () => {
      const textKey = `file:${activeFile}`;
      const text = ydoc.getText(textKey).toString();
      if (projectFormat === "markdown") {
        setMarkdownHtml(md.render(text));
      } else {
        setMarkdownHtml(
          adoc.convert(text, { safe: "safe", standalone: false }) as string,
        );
      }
    };

    // Initial render
    renderPreview();

    const onDocUpdate = () => {
      if (markdownDebounceTimerRef.current !== null) {
        window.clearTimeout(markdownDebounceTimerRef.current);
      }
      markdownDebounceTimerRef.current = window.setTimeout(() => {
        markdownDebounceTimerRef.current = null;
        renderPreview();
      }, 300);
    };

    ydoc.on("update", onDocUpdate);
    return () => {
      ydoc.off("update", onDocUpdate);
      if (markdownDebounceTimerRef.current !== null) {
        window.clearTimeout(markdownDebounceTimerRef.current);
        markdownDebounceTimerRef.current = null;
      }
    };
  }, [ydoc, activeFile, projectFormat, initialSyncDone, md, adoc]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.shiftKey || event.altKey) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-cz-comment-input="true"]')) {
        return;
      }

      if (target?.closest("[data-cz-project-title-edit]")) {
        return;
      }

      const isFormInput =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        Boolean(target?.isContentEditable);

      if (isFormInput && !target?.closest(".cm-editor")) {
        return;
      }

      const isCtrlEnter =
        event.key === "Enter" && event.ctrlKey && !event.metaKey;
      const isCompileSave =
        event.key.toLowerCase() === "s" && (event.ctrlKey || event.metaKey);
      if (!isCtrlEnter && !isCompileSave) {
        return;
      }

      event.preventDefault();
      void handleCompile();
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, [handleCompile]);

  const createComment = useCallback(
    async (input: {
      filePath: string;
      startLine: number | null;
      endLine: number | null;
      parentCommentId: string | null;
      body: string;
    }) => {
      if (!canInteractWithComments) {
        throw new Error("Comment actions are disabled in view mode");
      }

      const res = await apiFetch(`/projects/${projectId}/comments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...shareHeaders,
        },
        body: JSON.stringify(input),
      });

      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: "Failed to create comment" }));
        throw new Error(String(err.error ?? "Failed to create comment"));
      }

      const created = (await res.json()) as ProjectComment;
      setComments((prev) => [...prev, created]);
      signalCommentsChanged("create");
    },
    [canInteractWithComments, projectId, shareHeaders, signalCommentsChanged],
  );

  const updateComment = useCallback(
    async (commentId: string, body: string) => {
      if (!canInteractWithComments) {
        throw new Error("Comment actions are disabled in view mode");
      }

      const res = await apiFetch(
        `/projects/${projectId}/comments/${commentId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...shareHeaders,
          },
          body: JSON.stringify({ body }),
        },
      );

      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: "Failed to update comment" }));
        throw new Error(String(err.error ?? "Failed to update comment"));
      }

      const updated = (await res.json()) as ProjectComment;
      setComments((prev) =>
        prev.map((comment) => (comment.id === updated.id ? updated : comment)),
      );
      signalCommentsChanged("update");
    },
    [canInteractWithComments, projectId, shareHeaders, signalCommentsChanged],
  );

  const removeComment = useCallback(
    async (commentId: string) => {
      if (!canInteractWithComments) {
        throw new Error("Comment actions are disabled in view mode");
      }

      const res = await apiFetch(
        `/projects/${projectId}/comments/${commentId}`,
        {
          method: "DELETE",
          headers: shareHeaders,
        },
      );

      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: "Failed to delete comment" }));
        throw new Error(String(err.error ?? "Failed to delete comment"));
      }

      setComments((prev) => {
        const getDescendantIds = (parentId: string): Set<string> => {
          const directChildren = prev.filter(
            (c) => c.parentCommentId === parentId,
          );
          const ids = new Set(directChildren.map((c) => c.id));
          directChildren.forEach((child) => {
            getDescendantIds(child.id).forEach((id) => ids.add(id));
          });
          return ids;
        };

        const toRemove = new Set([commentId, ...getDescendantIds(commentId)]);
        return prev.filter((c) => !toRemove.has(c.id));
      });
      signalCommentsChanged("delete");
    },
    [canInteractWithComments, projectId, shareHeaders, signalCommentsChanged],
  );

  const inviteMember = useCallback(async () => {
    const email = inviteEmail.trim();
    if (!email) return;

    setInviting(true);
    try {
      const res = await apiFetch(`/projects/${projectId}/members`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...shareHeaders,
        },
        body: JSON.stringify({ email, role: inviteRole }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Invite failed" }));
        throw new Error(String(err.error ?? "Invite failed"));
      }

      setInviteEmail("");
      await loadAccess();
    } catch (err) {
      onPopupAlert(getErrorMessage(err), "Invite failed");
    } finally {
      setInviting(false);
    }
  }, [
    inviteEmail,
    inviteRole,
    projectId,
    shareHeaders,
    loadAccess,
    onPopupAlert,
  ]);

  const updateMemberRole = useCallback(
    async (userId: string, role: ShareRole | "remove") => {
      const res = await apiFetch(`/projects/${projectId}/members/${userId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...shareHeaders,
        },
        body: JSON.stringify(role === "remove" ? { remove: true } : { role }),
      });

      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: "Failed to update member" }));
        onPopupAlert(
          String(err.error ?? "Failed to update member"),
          "Update failed",
        );
        return;
      }

      await loadAccess();
    },
    [projectId, shareHeaders, loadAccess, onPopupAlert],
  );

  const setLinkSharing = useCallback(
    async (enabled: boolean, role: ShareRole) => {
      const res = await apiFetch(`/projects/${projectId}/link-sharing`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...shareHeaders,
        },
        body: JSON.stringify({ enabled, role }),
      });

      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: "Failed to update link sharing" }));
        onPopupAlert(
          String(err.error ?? "Failed to update link sharing"),
          "Update failed",
        );
        return;
      }

      const body = (await res.json()) as {
        enabled: boolean;
        role: ShareRole | null;
        token: string | null;
      };
      setLinkEnabled(body.enabled);
      setLinkRole(body.role ?? "view");
      setLinkToken(body.token);
    },
    [projectId, shareHeaders, onPopupAlert],
  );

  const invalidateLinkSharing = useCallback(async () => {
    const res = await apiFetch(`/projects/${projectId}/link-sharing`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...shareHeaders,
      },
      body: JSON.stringify({ invalidate: true }),
    });

    if (!res.ok) {
      const err = await res
        .json()
        .catch(() => ({ error: "Failed to rotate link" }));
      onPopupAlert(
        String(err.error ?? "Failed to rotate link"),
        "Rotate failed",
      );
      return;
    }

    const body = (await res.json()) as {
      enabled: boolean;
      role: ShareRole | null;
      token: string | null;
    };
    setLinkEnabled(body.enabled);
    setLinkRole(body.role ?? "view");
    setLinkToken(body.token);
  }, [projectId, shareHeaders, onPopupAlert]);

  const startResizeDrag = useResizeDrag();

  const resizeSidebar = useMemo(
    () =>
      createSidebarResizeHandler({
        startResizeDrag,
        sidebarWidthRef,
        setIsResizingSidebar,
        setSidebarWidth,
        setSidebarOpen,
      }),
    [startResizeDrag],
  );

  const resizePreview = useMemo(
    () =>
      createPreviewResizeHandler({
        startResizeDrag,
        previewWidth,
        layoutRef,
        setIsResizingPreview,
        setPreviewWidth,
        setPreviewOpen,
      }),
    [previewWidth, startResizeDrag],
  );

  const resizeEditorSplit = useMemo(
    () =>
      createEditorSplitResizeHandler({
        startResizeDrag,
        editorLayout,
        setEditorLayout,
      }),
    [editorLayout, startResizeDrag],
  );

  const resizeEditorCorner = useMemo(
    () =>
      createEditorCornerResizeHandler({
        startResizeDrag,
        editorLayout,
        splitGeometryById: splitGeometry.byId,
        setEditorLayout,
        setHoveredCornerKey,
        setDraggingCornerSplitIds,
        sidebarEdgeResize:
          sidebarOpen && !isMobileSidebarLayout
            ? {
                sidebarWidthRef,
                setIsResizingSidebar,
                setSidebarWidth,
                setSidebarOpen,
              }
            : undefined,
        previewEdgeResize: previewOpen
          ? {
              getPreviewWidth: () => previewWidth,
              layoutRef,
              setIsResizingPreview,
              setPreviewWidth,
              setPreviewOpen,
            }
          : undefined,
      }),
    [
      editorLayout,
      isMobileSidebarLayout,
      previewOpen,
      previewWidth,
      sidebarOpen,
      splitGeometry.byId,
      startResizeDrag,
    ],
  );

  const openDroppedPathsInPane = useCallback(
    (
      paneId: string,
      paths: string[],
      fromTabBar: boolean,
      sourcePaneId: string | null,
    ) => {
      const validPaths = dedupePaths(paths).filter((path) =>
        allFilePaths.has(path),
      );
      if (validPaths.length === 0) {
        return;
      }

      setPaneStateById((prev) => {
        return applyDroppedPathsToPaneState(prev, paneId, validPaths, {
          fromTabBar,
          sourcePaneId,
        });
      });

      setHistoryState(null);
      focusPane(paneId, validPaths[validPaths.length - 1]);
    },
    [allFilePaths, focusPane],
  );

  const splitPaneWithDroppedPaths = useCallback(
    (
      targetPaneId: string,
      orientation: SplitOrientation,
      paths: string[],
      fromTabBar: boolean,
      sourcePaneId: string | null,
    ) => {
      const validPaths = dedupePaths(paths).filter((path) =>
        allFilePaths.has(path),
      );
      if (validPaths.length === 0) {
        return;
      }

      const newPaneId = createPaneId();
      const splitId = createSplitId();

      setPaneStateById((prev) => {
        const next = fromTabBar
          ? removeDroppedTabPathsFromSource(prev, validPaths, sourcePaneId)
          : { ...prev };
        next[newPaneId] = {
          tabs: validPaths.map((path) => ({ path, isEphemeral: false })),
          activePath: validPaths[validPaths.length - 1],
          showSnippetToolbar: true,
        };
        return next;
      });

      setEditorLayout((prev) =>
        insertSplitAtPane(prev, targetPaneId, newPaneId, splitId, orientation),
      );
      setHistoryState(null);
      focusPane(newPaneId, validPaths[validPaths.length - 1]);
    },
    [allFilePaths, createPaneId, createSplitId, focusPane],
  );

  const handlePaneDragOver = useCallback(
    (event: ReactDragEvent<HTMLDivElement>, paneId: string) => {
      const payload = readDraggedFilePayload(event.dataTransfer, allFilePaths);
      if (!payload) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = "move";

      const rect = event.currentTarget.getBoundingClientRect();
      const zone = computeDropZone(rect, event.clientX, event.clientY);
      setPaneDropHint((prev) => {
        if (prev?.paneId === paneId && prev.zone === zone) {
          return prev;
        }
        return { paneId, zone };
      });
    },
    [allFilePaths],
  );

  const handlePaneDragLeave = useCallback(
    (event: ReactDragEvent<HTMLDivElement>, paneId: string) => {
      const nextTarget = event.relatedTarget;
      if (
        nextTarget instanceof Node &&
        event.currentTarget.contains(nextTarget)
      ) {
        return;
      }
      setPaneDropHint((prev) => (prev?.paneId === paneId ? null : prev));
    },
    [],
  );

  const handlePaneDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>, paneId: string) => {
      const payload = readDraggedFilePayload(event.dataTransfer, allFilePaths);
      if (!payload) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      const zone = computeDropZone(rect, event.clientX, event.clientY);
      setPaneDropHint(null);

      if (zone === "center") {
        openDroppedPathsInPane(
          paneId,
          payload.paths,
          payload.fromTabBar,
          payload.sourcePaneId,
        );
        return;
      }

      const orientation: SplitOrientation =
        zone === "right" ? "horizontal" : "vertical";
      splitPaneWithDroppedPaths(
        paneId,
        orientation,
        payload.paths,
        payload.fromTabBar,
        payload.sourcePaneId,
      );
    },
    [allFilePaths, openDroppedPathsInPane, splitPaneWithDroppedPaths],
  );

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

      if (activeFile === path) {
        setActiveFile(trimmed);
      }
      setPaneStateById((prev) => {
        let changed = false;
        const next: Record<string, EditorPaneState> = {};

        for (const [paneId, paneState] of Object.entries(prev)) {
          const nextTabs = paneState.tabs.map((tab) =>
            tab.path === path ? { ...tab, path: trimmed } : tab,
          );
          const nextActivePath =
            paneState.activePath === path ? trimmed : paneState.activePath;
          if (
            nextActivePath !== paneState.activePath ||
            nextTabs.some((tab, index) => tab !== paneState.tabs[index])
          ) {
            changed = true;
            next[paneId] = {
              tabs: nextTabs,
              activePath: nextActivePath,
              showSnippetToolbar: paneState.showSnippetToolbar,
            };
          } else {
            next[paneId] = paneState;
          }
        }

        return changed ? next : prev;
      });
      return true;
    },
    [fileMap, ydoc, activeFile],
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

      const tabIndex = openTabs.findIndex((tab) => tab.path === path);
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

      let nextActiveForCurrentPane = "";
      setPaneStateById((prev) => {
        let changed = false;
        const next: Record<string, EditorPaneState> = {};

        for (const [paneId, paneState] of Object.entries(prev)) {
          const closeIndex = paneState.tabs.findIndex(
            (tab) => tab.path === path,
          );
          const nextTabs =
            closeIndex === -1
              ? paneState.tabs
              : paneState.tabs.filter((tab) => tab.path !== path);
          const nextActivePath =
            paneState.activePath === path
              ? (nextTabs[closeIndex]?.path ??
                nextTabs[closeIndex - 1]?.path ??
                "")
              : paneState.activePath;

          if (paneId === activePaneId && paneState.activePath === path) {
            nextActiveForCurrentPane = nextActivePath;
          }

          if (
            nextTabs !== paneState.tabs ||
            nextActivePath !== paneState.activePath
          ) {
            changed = true;
            next[paneId] = {
              tabs: nextTabs,
              activePath: nextActivePath,
              showSnippetToolbar: paneState.showSnippetToolbar,
            };
          } else {
            next[paneId] = paneState;
          }
        }

        return changed ? next : prev;
      });

      if (activeFile === path) {
        setActiveFile(
          nextActiveForCurrentPane ||
            fallbackFromTabs ||
            remainingFiles[0] ||
            "",
        );
      }
      return true;
    },
    [fileMap, ydoc, activeFile, openTabs, activePaneId],
  );

  const resolveTextFileSizeBytes = useCallback(
    (filePath: string): number => {
      const cached = textByteSizeByPath[filePath];
      if (typeof cached === "number") {
        return cached;
      }

      if (maxTextFileSizeBytes === "unlimited") {
        return 0;
      }

      const text = ydoc.getText(`file:${filePath}`);
      return evaluateUtf8Limit(text.length, maxTextFileSizeBytes, () =>
        text.toString(),
      ).sizeBytes;
    },
    [textByteSizeByPath, maxTextFileSizeBytes, ydoc],
  );

  const handleTextLimitExceeded = useCallback(
    (input: { filePath: string; sizeBytes: number; limitBytes: number }) => {
      const now = Date.now();
      if (now - lastTextLimitPopupAtRef.current < 750) {
        return;
      }
      lastTextLimitPopupAtRef.current = now;

      onPopupAlert(
        `Cannot apply edit to "${input.filePath}" because it would exceed the ${formatBinarySize(input.limitBytes)} text file limit (attempted size: ~${formatBinarySize(input.sizeBytes)}).`,
        "Text File Limit Reached",
      );
    },
    [onPopupAlert],
  );

  const shareUrl = `${window.location.origin}${makeProjectUrl(projectId, linkToken ?? shareToken)}`;
  const hasProjectEntries = fileMap.size > 0;

  const renderPane = (paneId: string) => {
    const paneState = paneStateById[paneId] ?? {
      tabs: [],
      activePath: "",
      showSnippetToolbar: true,
    };
    const paneActiveFile = paneState.activePath;
    const paneHasActiveTextFile =
      paneActiveFile.length > 0 && textFilePaths.has(paneActiveFile);
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
        historyState={historyState}
        canEdit={canEdit}
        diffMode={diffMode}
        onDiffModeChange={setDiffMode}
        onExitHistoryMode={exitHistoryMode}
        onHistoryRestored={() => {
          exitHistoryMode();
          setHistoryRefreshKey((k) => k + 1);
        }}
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
        onCommentLineNumbersChange={(nextFileLineNumbers) => {
          setCommentLineNumbersById((prev) => {
            const next = { ...prev };
            for (const comment of comments) {
              if (comment.filePath === paneActiveFile) {
                delete next[comment.id];
              }
            }
            for (const [commentId, lines] of Object.entries(
              nextFileLineNumbers,
            )) {
              next[commentId] = lines;
            }
            return next;
          });
        }}
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
        <div className="flex items-center justify-between px-4 py-3 border-b border-cz-border">
          <WorkspaceProjectTitle
            className="min-w-0 flex-1 text-sm font-semibold tracking-tight text-cz-text"
            title={projectTitle}
            canRename={canEdit}
            onBack={navigateToProjects}
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
        <div className="grid grid-cols-3 border-b border-cz-border">
          <button
            onClick={() => setSidebarTab("files")}
            className={`px-3 py-2 text-xs font-medium ${sidebarTab === "files" ? "bg-cz-accent-muted text-cz-accent" : "text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text"}`}
          >
            Files
          </button>
          <button
            onClick={() => setSidebarTab("review")}
            className={`px-3 py-2 text-xs font-medium ${sidebarTab === "review" ? "bg-cz-accent-muted text-cz-accent" : "text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text"}`}
          >
            Review
          </button>
          <button
            onClick={() => setSidebarTab("history")}
            className={`px-3 py-2 text-xs font-medium ${sidebarTab === "history" ? "bg-cz-accent-muted text-cz-accent" : "text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text"}`}
          >
            History
          </button>
        </div>

        {sidebarTab === "files" ? (
          <FileTree
            fileMap={fileMap}
            ydoc={ydoc}
            projectId={projectId}
            shareHeaders={shareHeaders}
            activeFile={activeFile}
            isDocumentLoading={!initialSyncDone}
            onSelect={(path) => {
              openFileFromTree(path, "ephemeral");
            }}
            onSelectPersistent={(path) => {
              openFileFromTree(path, "persistent");
            }}
            onRename={renameFile}
            onDelete={deleteFile}
          />
        ) : sidebarTab === "history" ? (
          <HistoryPanel
            projectId={projectId}
            onViewDiff={(sha, filePath) => {
              enterHistoryMode(sha, filePath);
            }}
            canEdit={canEdit}
            refreshKey={historyRefreshKey}
            onRestoreVersion={(sha) => void handleRestoreVersion(sha)}
          />
        ) : (
          <CommentsPanel
            activeFile={activeFile}
            comments={comments}
            commentLineNumbersById={commentLineNumbersById}
            canComment={canInteractWithComments}
            canModerate={accessRole === "owner" && canInteractWithComments}
            onActivateComment={(commentId) => {
              setSelectedCommentId(commentId);
              setHoveredCommentId(null);
              setActiveCommentRevision((prev) => prev + 1);
            }}
            onHoverComment={(commentId) => {
              setHoveredCommentId(commentId);
            }}
            onHoverCommentEnd={() => {
              setHoveredCommentId(null);
            }}
            principalUserId={principal.userId}
            principalGuestId={principal.guestId}
            onReplyComment={createComment}
            onEditComment={updateComment}
            onDeleteComment={removeComment}
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
          onCompile={handleCompile}
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
          activeFile={activeFile}
          activeEditors={activeEditors}
          onFocusCollaborator={focusCollaborator}
          projectFormat={projectFormat}
          onExport={handleExport}
          exporting={exporting}
          previewOpen={previewOpen}
          onTogglePreview={() => setPreviewOpen((open) => !open)}
          projectId={projectId}
          onViewDiff={(sha, filePath) => {
            enterHistoryMode(sha, filePath);
          }}
          historyState={historyState}
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
                {projectFormat === "markdown" ||
                projectFormat === "asciidoc" ? (
                  <HtmlPreview html={markdownHtml} error={null} />
                ) : (
                  <CompilePreview
                    pdfUrl={pdfUrl}
                    error={compileError}
                    documentName="Compile"
                    compiling={compiling}
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
        onMemberRoleChange={(userId, role) => {
          void updateMemberRole(userId, role);
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
    </div>
  );
}
