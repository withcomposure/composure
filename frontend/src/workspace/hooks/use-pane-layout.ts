import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from "react";
import type { FileTabsDropPayload } from "@/editor/FileTabs";
import type {
  ConnectionState,
  DiffWorkspaceTab,
  WorkspaceTab,
} from "@/types";
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
  type SidebarTab,
  type SplitOrientation,
} from "@/editor/workspace-state";
import { applyDroppedPathsToPaneState } from "@/editor/tab-drop-state";
import {
  buildDiffWorkspaceTabPath,
  createDiffWorkspaceTab,
  createFileWorkspaceTab,
  findWorkspaceTabByPath,
  isDiffWorkspaceTab,
  isDiffWorkspaceTabPath,
  isFileWorkspaceTab,
  promoteWorkspaceTab,
  renameWorkspaceTabFilePath,
  workspaceTabIsEphemeral,
  workspaceTabFilePath,
  workspaceTabReferencesFile,
} from "@/editor/workspace-tabs";
import {
  buildSplitGeometry,
  collectPaneIds,
  computeDropZone,
  dedupePaths,
  insertSplitAtPane,
  readDraggedFilePayload,
  removePaneFromLayout,
  type SplitDropZone,
} from "@/workspace/layout-utils";
import {
  createEditorCornerResizeHandler,
  createEditorSplitResizeHandler,
  createPreviewResizeHandler,
  createSidebarResizeHandler,
} from "@/workspace/resize-handlers";
import { useResizeDrag } from "@/hooks/use-resize-drag";
import { apiFetch } from "@/utils/fetch";

const emptyPaneState: EditorPaneState = {
  tabs: [],
  activePath: "",
  showSnippetToolbar: true,
};

/** Drops tabs whose files vanished and repairs each pane's active path. */
function reconcilePaneStates(
  panes: Record<string, EditorPaneState>,
  allFilePaths: Set<string>,
): { changed: boolean; next: Record<string, EditorPaneState> } {
  let changed = false;
  const next: Record<string, EditorPaneState> = {};

  for (const [paneId, paneState] of Object.entries(panes)) {
    const filteredTabs = paneState.tabs.filter(
      (tab) => isDiffWorkspaceTab(tab) || allFilePaths.has(tab.path),
    );
    const activePath =
      paneState.activePath &&
      filteredTabs.some((tab) => tab.path === paneState.activePath)
        ? paneState.activePath
        : (filteredTabs[0]?.path ?? "");

    if (
      filteredTabs.length !== paneState.tabs.length ||
      activePath !== paneState.activePath
    ) {
      changed = true;
      next[paneId] = {
        tabs: filteredTabs,
        activePath,
        showSnippetToolbar: paneState.showSnippetToolbar,
      };
      continue;
    }

    next[paneId] = paneState;
  }

  return { changed, next };
}

interface UsePaneLayoutOptions {
  projectId: string;
  shareHeaders: Record<string, string>;
  allFilePaths: Set<string>;
  initialSyncDone: boolean;
  connectionState: ConnectionState;
  isMobileSidebarLayout: boolean;
  /** Reports the file path backing a newly focused/selected editor tab. */
  onEditorFileFocused: (path: string) => void;
}

export function usePaneLayout({
  projectId,
  shareHeaders,
  allFilePaths,
  initialSyncDone,
  connectionState,
  isMobileSidebarLayout,
  onEditorFileFocused,
}: UsePaneLayoutOptions) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("files");
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
  const [previewWidth, setPreviewWidth] = useState(520);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [isResizingPreview, setIsResizingPreview] = useState(false);
  const [editorLayoutSurfaceSize, setEditorLayoutSurfaceSize] = useState({
    width: 0,
    height: 0,
  });
  const [hoveredCornerKey, setHoveredCornerKey] = useState<string | null>(null);
  const [draggingCornerSplitIds, setDraggingCornerSplitIds] = useState<
    [string, string] | null
  >(null);
  const [workspaceStateLoaded, setWorkspaceStateLoaded] = useState(false);

  const paneIdCounterRef = useRef(2);
  const splitIdCounterRef = useRef(1);
  const previousProjectIdRef = useRef(projectId);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const editorLayoutSurfaceRef = useRef<HTMLDivElement | null>(null);
  const sidebarWidthRef = useRef(sidebarWidth);
  const lastPersistedWorkspaceStateRef = useRef<string | null>(null);

  const openTabs = useMemo(
    () => paneStateById[activePaneId]?.tabs ?? [],
    [paneStateById, activePaneId],
  );
  const activeTab = useMemo(
    () => findWorkspaceTabByPath(openTabs, activeFile),
    [openTabs, activeFile],
  );
  const activeDiffTab = useMemo<DiffWorkspaceTab | null>(
    () => (isDiffWorkspaceTab(activeTab) ? activeTab : null),
    [activeTab],
  );
  const activeFilePath = useMemo(() => {
    if (activeTab) {
      return workspaceTabFilePath(activeTab);
    }

    return isDiffWorkspaceTabPath(activeFile) ? "" : activeFile;
  }, [activeTab, activeFile]);

  // Committed-state mirrors for event handlers: reading these keeps the
  // callbacks below referentially stable, so the memoized EditorPane is not
  // re-rendered by unrelated pane-state changes. Event handlers always run
  // after the commit that updated these refs.
  const paneStateByIdRef = useRef(paneStateById);
  const activePaneIdRef = useRef(activePaneId);
  const activeTabRef = useRef(activeTab);
  useEffect(() => {
    paneStateByIdRef.current = paneStateById;
    activePaneIdRef.current = activePaneId;
    activeTabRef.current = activeTab;
  });

  const readPaneState = useCallback(
    (paneId: string): EditorPaneState | undefined =>
      paneStateByIdRef.current[paneId],
    [],
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

  // A layout change can remove the corner currently hovered; drop the stale key.
  if (
    hoveredCornerKey &&
    !splitGeometry.corners.some((corner) => corner.key === hoveredCornerKey)
  ) {
    setHoveredCornerKey(null);
  }

  // When a block below queued a pane-map update this pass, the collapse
  // block must not compute from the (now stale) render snapshot; it skips
  // this pass and re-runs on the render those updates trigger.
  let paneMapWriteQueuedThisPass = false;

  // Keep the active pane's activePath in sync with the workspace-level
  // active file whenever either changes (previously an effect).
  const [prevPaneSync, setPrevPaneSync] = useState<{
    paneId: string;
    file: string;
  } | null>(null);
  if (
    prevPaneSync === null ||
    prevPaneSync.paneId !== activePaneId ||
    prevPaneSync.file !== activeFile
  ) {
    setPrevPaneSync({ paneId: activePaneId, file: activeFile });
    const pane = paneStateById[activePaneId];
    if (pane && pane.activePath !== activeFile) {
      paneMapWriteQueuedThisPass = true;
      setPaneStateById((prev) => {
        const prevPane = prev[activePaneId];
        if (!prevPane || prevPane.activePath === activeFile) {
          return prev;
        }
        return {
          ...prev,
          [activePaneId]: {
            ...prevPane,
            activePath: activeFile,
          },
        };
      });
    }
  }

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

  // Drop tabs whose files vanished and repair each pane's active path once a
  // synced file listing is authoritative (previously an effect keyed on the
  // same values as this guard tuple).
  const [prevReconcile, setPrevReconcile] = useState<{
    allFilePaths: Set<string>;
    activePaneId: string;
    activeFile: string;
    connectionState: ConnectionState;
    initialSyncDone: boolean;
  } | null>(null);
  if (
    prevReconcile === null ||
    prevReconcile.allFilePaths !== allFilePaths ||
    prevReconcile.activePaneId !== activePaneId ||
    prevReconcile.activeFile !== activeFile ||
    prevReconcile.connectionState !== connectionState ||
    prevReconcile.initialSyncDone !== initialSyncDone
  ) {
    setPrevReconcile({
      allFilePaths,
      activePaneId,
      activeFile,
      connectionState,
      initialSyncDone,
    });

    if (shouldReconcileWorkspaceFromFileMap(initialSyncDone, connectionState)) {
      const snapshotResult = reconcilePaneStates(paneStateById, allFilePaths);
      if (snapshotResult.changed) {
        paneMapWriteQueuedThisPass = true;
        setPaneStateById((prev) => {
          if (prev === paneStateById) {
            return snapshotResult.next;
          }
          const result = reconcilePaneStates(prev, allFilePaths);
          return result.changed ? result.next : prev;
        });
        // activeFile catches up via the lost-tab fallback below once the
        // reconciled tabs commit, guaranteeing it is derived from the same
        // pane state that was actually applied.
      }
    }
  }

  // The active pane can disappear (collapse/reconcile); fall back to the
  // first pane in the layout.
  if (!paneStateById[activePaneId]) {
    const nextActivePaneId = collectPaneIds(editorLayout)[0] ?? ROOT_PANE_ID;
    if (nextActivePaneId !== activePaneId) {
      setActivePaneId(nextActivePaneId);
      setActiveFile(paneStateById[nextActivePaneId]?.activePath ?? "");
    }
  }

  // Collapse empty panes out of the split layout. Skipped when a pane-map
  // update was queued this pass: the snapshot this computes from would be
  // stale, and the queued update would be clobbered by the direct writes.
  if (!paneMapWriteQueuedThisPass) {
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

    if (changed) {
      setEditorLayout(nextLayout);
      setPaneStateById(nextPaneStateById);

      if (!nextPaneStateById[activePaneId]) {
        const fallbackPaneId = collectPaneIds(nextLayout)[0] ?? ROOT_PANE_ID;
        setActivePaneId(fallbackPaneId);
        setActiveFile(nextPaneStateById[fallbackPaneId]?.activePath ?? "");
      }
    }
  }

  // An active file that exists but has no tab gets an ephemeral one.
  if (activeFile && allFilePaths.has(activeFile)) {
    const currentPane = paneStateById[activePaneId] ?? emptyPaneState;
    if (!currentPane.tabs.some((tab) => tab.path === activeFile)) {
      setPaneStateById((prev) => {
        const pane = prev[activePaneId] ?? emptyPaneState;
        if (pane.tabs.some((tab) => tab.path === activeFile)) {
          return prev;
        }
        const previewIndex = pane.tabs.findIndex((tab) =>
          workspaceTabIsEphemeral(tab),
        );
        let nextTabs: WorkspaceTab[];
        if (previewIndex !== -1) {
          nextTabs = [...pane.tabs];
          nextTabs[previewIndex] = createFileWorkspaceTab(activeFile, true);
        } else {
          nextTabs = [...pane.tabs, createFileWorkspaceTab(activeFile, true)];
        }
        return {
          ...prev,
          [activePaneId]: {
            ...pane,
            tabs: nextTabs,
          },
        };
      });
    }
  }

  // Once synced, an active file that lost its tab falls back to a live tab.
  if (
    initialSyncDone &&
    activeFile &&
    !openTabs.some((tab) => tab.path === activeFile)
  ) {
    const fallback =
      openTabs.find(
        (tab) => tab.kind === "diff" || allFilePaths.has(tab.path),
      )?.path ?? "";
    setActiveFile(fallback);
  }

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

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
          const existingTab = pane.tabs[existingIndex];
          if (
            mode === "persistent" &&
            isFileWorkspaceTab(existingTab) &&
            existingTab.isEphemeral
          ) {
            nextTabs = [...pane.tabs];
            nextTabs[existingIndex] = createFileWorkspaceTab(path, false);
          }
        } else if (mode === "ephemeral") {
          const previewIndex = pane.tabs.findIndex(
            (tab) => workspaceTabIsEphemeral(tab),
          );
          if (previewIndex !== -1) {
            nextTabs = [...pane.tabs];
            nextTabs[previewIndex] = createFileWorkspaceTab(path, true);
          } else {
            nextTabs = [...pane.tabs, createFileWorkspaceTab(path, true)];
          }
        } else {
          nextTabs = [...pane.tabs, createFileWorkspaceTab(path, false)];
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
      setActiveFile(paneStateByIdRef.current[paneId]?.activePath ?? "");
    },
    [],
  );

  const handlePaneEditorFocusChange = useCallback(
    (paneId: string, isFocused: boolean) => {
      setFocusedEditorPaneId((current) => {
        if (isFocused) {
          return paneId;
        }
        return current === paneId ? null : current;
      });

      if (isFocused) {
        const pane = paneStateByIdRef.current[paneId];
        const focusedTab = findWorkspaceTabByPath(
          pane?.tabs ?? [],
          pane?.activePath ?? "",
        );
        const focusedPath = focusedTab ? workspaceTabFilePath(focusedTab) : "";
        if (focusedPath.length > 0) {
          onEditorFileFocused(focusedPath);
        }
      }
    },
    [onEditorFileFocused],
  );

  const openDiffTab = useCallback(
    (
      sha: string,
      filePath: string,
      mode: "ephemeral" | "persistent" = "ephemeral",
      paneId = activePaneIdRef.current,
    ) => {
      setPaneStateById((prev) => {
        const pane = prev[paneId] ?? {
          tabs: [],
          activePath: "",
          showSnippetToolbar: true,
        };

        const existingIndex = pane.tabs.findIndex(
          (tab) =>
            isDiffWorkspaceTab(tab) &&
            tab.commitSha === sha &&
            tab.filePath === filePath,
        );

        let nextTabs = pane.tabs;
        let nextActivePath = "";

        if (existingIndex !== -1) {
          const existingTab = pane.tabs[existingIndex];
          nextActivePath = existingTab.path;

          if (mode === "persistent" && existingTab.isEphemeral) {
            nextTabs = [...pane.tabs];
            nextTabs[existingIndex] = promoteWorkspaceTab(existingTab);
          }
        } else {
          const nextDiffTab = createDiffWorkspaceTab({
            commitSha: sha,
            filePath,
            isEphemeral: mode === "ephemeral",
          });
          nextActivePath = nextDiffTab.path;

          if (mode === "ephemeral") {
            const previewIndex = pane.tabs.findIndex((tab) =>
              workspaceTabIsEphemeral(tab),
            );
            if (previewIndex !== -1) {
              nextTabs = [...pane.tabs];
              nextTabs[previewIndex] = nextDiffTab;
            } else {
              nextTabs = [...pane.tabs, nextDiffTab];
            }
          } else {
            nextTabs = [...pane.tabs, nextDiffTab];
          }
        }

        if (nextTabs === pane.tabs && pane.activePath === nextActivePath) {
          return prev;
        }

        return {
          ...prev,
          [paneId]: {
            ...pane,
            tabs: nextTabs,
            activePath: nextActivePath,
          },
        };
      });

      focusPane(paneId, buildDiffWorkspaceTabPath(sha, filePath));
    },
    [focusPane],
  );

  const openFileFromTree = useCallback(
    (path: string, mode: "ephemeral" | "persistent") => {
      const paneId = activePaneIdRef.current;
      openFileInPane(paneId, path, mode);
      focusPane(paneId, path);
    },
    [openFileInPane, focusPane],
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
      focusPane(paneId, path);
      const selectedTab = findWorkspaceTabByPath(
        paneStateByIdRef.current[paneId]?.tabs ?? [],
        path,
      );
      onEditorFileFocused(
        selectedTab ? workspaceTabFilePath(selectedTab) : path,
      );
    },
    [focusPane, onEditorFileFocused],
  );

  const promoteTab = useCallback(
    (paneId: string, path: string) => {
      setPaneStateById((prev) => {
        const pane = prev[paneId];
        if (!pane) return prev;
        const tabIndex = pane.tabs.findIndex((tab) => tab.path === path);
        const tab = tabIndex === -1 ? null : pane.tabs[tabIndex];
        if (!tab || !workspaceTabIsEphemeral(tab)) {
          return prev;
        }

        const nextTabs = [...pane.tabs];
        nextTabs[tabIndex] = promoteWorkspaceTab(tab);

        return {
          ...prev,
          [paneId]: {
            tabs: nextTabs,
            activePath: path,
            showSnippetToolbar: pane.showSnippetToolbar,
          },
        };
      });
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
        nextTabs.splice(
          insertAt,
          0,
          promoteWorkspaceTab(moved),
        );

        return {
          ...prev,
          [paneId]: {
            tabs: nextTabs,
            activePath: path,
            showSnippetToolbar: pane.showSnippetToolbar,
          },
        };
      });
      focusPane(paneId, path);
    },
    [focusPane],
  );

  const replaceDiffTabWithLiveFile = useCallback(
    (paneId: string, diffTabPath: string, filePath: string) => {
      setPaneStateById((prev) => {
        const pane = prev[paneId];
        if (!pane || !pane.tabs.some((tab) => tab.path === diffTabPath)) {
          return prev;
        }

        const nextTabs = pane.tabs.filter((tab) => tab.path !== diffTabPath);
        const nextActivePath =
          pane.activePath === diffTabPath ? (nextTabs[0]?.path ?? "") : pane.activePath;

        return {
          ...prev,
          [paneId]: {
            ...pane,
            tabs: nextTabs,
            activePath: nextActivePath,
          },
        };
      });

      openFileInPane(paneId, filePath, "persistent");
      focusPane(paneId, filePath);
    },
    [focusPane, openFileInPane],
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

      if (nextActivePath !== null && paneId === activePaneIdRef.current) {
        setActiveFile(nextActivePath);
      }
    },
    [],
  );

  const normalizeDroppedPaths = useCallback(
    (
      paths: string[],
      fromTabBar: boolean,
      sourcePaneId: string | null,
    ): string[] => {
      const uniquePaths = dedupePaths(paths);
      if (uniquePaths.length === 0) {
        return [];
      }

      if (!fromTabBar) {
        return uniquePaths.filter((path) => allFilePaths.has(path));
      }

      const sourcePane = sourcePaneId
        ? paneStateByIdRef.current[sourcePaneId]
        : null;
      if (sourcePane) {
        const sourcePaths = new Set(sourcePane.tabs.map((tab) => tab.path));
        return uniquePaths.filter((path) => sourcePaths.has(path));
      }

      return uniquePaths.filter((path) => allFilePaths.has(path));
    },
    [allFilePaths],
  );

  const handleDropPathsOnTabs = useCallback(
    (paneId: string, payload: FileTabsDropPayload) => {
      const paths = normalizeDroppedPaths(
        payload.paths,
        payload.fromTabBar,
        payload.sourcePaneId,
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

      focusPane(paneId, paths[paths.length - 1]);
    },
    [focusPane, normalizeDroppedPaths],
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

  const startResizeDrag = useResizeDrag();

  const resizeSidebar = useCallback<
    ReturnType<typeof createSidebarResizeHandler>
  >(
    (...args) =>
      createSidebarResizeHandler({
        startResizeDrag,
        sidebarWidthRef,
        setIsResizingSidebar,
        setSidebarWidth,
        setSidebarOpen,
      })(...args),
    [startResizeDrag],
  );

  const resizePreview = useCallback<
    ReturnType<typeof createPreviewResizeHandler>
  >(
    (...args) =>
      createPreviewResizeHandler({
        startResizeDrag,
        previewWidth,
        layoutRef,
        setIsResizingPreview,
        setPreviewWidth,
        setPreviewOpen,
      })(...args),
    [previewWidth, startResizeDrag],
  );

  const resizeEditorSplit = useCallback<
    ReturnType<typeof createEditorSplitResizeHandler>
  >(
    (...args) =>
      createEditorSplitResizeHandler({
        startResizeDrag,
        editorLayout,
        setEditorLayout,
      })(...args),
    [editorLayout, startResizeDrag],
  );

  const resizeEditorCorner = useCallback<
    ReturnType<typeof createEditorCornerResizeHandler>
  >(
    (...args) =>
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
      })(...args),
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
      const validPaths = normalizeDroppedPaths(
        paths,
        fromTabBar,
        sourcePaneId,
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

      focusPane(paneId, validPaths[validPaths.length - 1]);
    },
    [focusPane, normalizeDroppedPaths],
  );

  const splitPaneWithDroppedPaths = useCallback(
    (
      targetPaneId: string,
      orientation: SplitOrientation,
      paths: string[],
      fromTabBar: boolean,
      sourcePaneId: string | null,
    ) => {
      const validPaths = normalizeDroppedPaths(
        paths,
        fromTabBar,
        sourcePaneId,
      );
      if (validPaths.length === 0) {
        return;
      }

      const newPaneId = createPaneId();
      const splitId = createSplitId();

      setPaneStateById((prev) => {
        const next = {
          ...prev,
          [newPaneId]: {
            tabs: [],
            activePath: "",
            showSnippetToolbar: true,
          },
        };

        return applyDroppedPathsToPaneState(next, newPaneId, validPaths, {
          fromTabBar,
          sourcePaneId,
        });
      });

      setEditorLayout((prev) =>
        insertSplitAtPane(prev, targetPaneId, newPaneId, splitId, orientation),
      );
      focusPane(newPaneId, validPaths[validPaths.length - 1]);
    },
    [createPaneId, createSplitId, focusPane, normalizeDroppedPaths],
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

  const updateActiveDiffTabInPane = useCallback(
    (
      paneId: string,
      updater: (tab: DiffWorkspaceTab) => DiffWorkspaceTab,
    ) => {
      setPaneStateById((prev) => {
        const pane = prev[paneId];
        if (!pane) {
          return prev;
        }

        const activeTabInPane = findWorkspaceTabByPath(
          pane.tabs,
          pane.activePath,
        );
        if (!activeTabInPane || !isDiffWorkspaceTab(activeTabInPane)) {
          return prev;
        }

        const nextActiveDiffTab = updater(activeTabInPane);
        if (nextActiveDiffTab === activeTabInPane) {
          return prev;
        }

        const nextTabs = pane.tabs.map((tab) =>
          tab.path === activeTabInPane.path ? nextActiveDiffTab : tab,
        );

        return {
          ...prev,
          [paneId]: {
            ...pane,
            tabs: nextTabs,
          },
        };
      });
    },
    [],
  );

  const setActiveDiffModeForPane = useCallback(
    (paneId: string, mode: "side-by-side" | "inline") => {
      updateActiveDiffTabInPane(paneId, (tab) =>
        tab.diffMode === mode ? tab : { ...tab, diffMode: mode },
      );
    },
    [updateActiveDiffTabInPane],
  );

  const setActiveDiffBaseForPane = useCallback(
    (paneId: string, base: "parent" | "current") => {
      updateActiveDiffTabInPane(paneId, (tab) =>
        tab.diffBase === base ? tab : { ...tab, diffBase: base },
      );
    },
    [updateActiveDiffTabInPane],
  );

  /**
   * Applies a file rename to every pane's tabs and the active file. Callers
   * handle the Yjs/file-map side; `wasActiveTab` mirrors the pre-rename
   * check on the workspace's active tab.
   */
  const applyFileRenameToPanes = useCallback(
    (path: string, nextPath: string) => {
      const activeTabNow = activeTabRef.current;
      if (activeTabNow && workspaceTabReferencesFile(activeTabNow, path)) {
        setActiveFile(
          renameWorkspaceTabFilePath(activeTabNow, path, nextPath).path,
        );
      }
      setPaneStateById((prev) => {
        let changed = false;
        const next: Record<string, EditorPaneState> = {};

        for (const [paneId, paneState] of Object.entries(prev)) {
          const nextTabs = paneState.tabs.map((tab) =>
            renameWorkspaceTabFilePath(tab, path, nextPath),
          );
          const activeTabInPane = findWorkspaceTabByPath(
            paneState.tabs,
            paneState.activePath,
          );
          const nextActivePath =
            activeTabInPane && workspaceTabReferencesFile(activeTabInPane, path)
              ? renameWorkspaceTabFilePath(activeTabInPane, path, nextPath).path
              : paneState.activePath;
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
    },
    [],
  );

  /**
   * Closes every tab referencing a deleted file and moves the active file to
   * the best fallback (pane-local next tab, then the provided fallbacks).
   */
  const applyFileDeleteToPanes = useCallback(
    (path: string, fallbackFromTabs: string, firstRemainingFile: string) => {
      // Best-effort side-channel: React only evaluates the updater eagerly
      // when the queue is empty, which the preceding fileMap observers
      // usually prevent — in that case the fallback chain below picks the
      // adjacent tab instead, exactly as the pre-split code did.
      let nextActiveForCurrentPane = "";
      const activePaneIdNow = activePaneIdRef.current;

      setPaneStateById((prev) => {
        let changed = false;
        const next: Record<string, EditorPaneState> = {};

        for (const [paneId, paneState] of Object.entries(prev)) {
          const closeIndex = paneState.tabs.findIndex(
            (tab) => workspaceTabReferencesFile(tab, path),
          );
          const nextTabs =
            closeIndex === -1
              ? paneState.tabs
              : paneState.tabs.filter(
                (tab) => !workspaceTabReferencesFile(tab, path),
              );
          const activeTabInPane = findWorkspaceTabByPath(
            paneState.tabs,
            paneState.activePath,
          );
          const nextActivePath =
            activeTabInPane && workspaceTabReferencesFile(activeTabInPane, path)
              ? (nextTabs[closeIndex]?.path ??
                nextTabs[closeIndex - 1]?.path ??
                "")
              : paneState.activePath;

          if (
            paneId === activePaneIdNow &&
            activeTabInPane &&
            workspaceTabReferencesFile(activeTabInPane, path)
          ) {
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

      const activeTabNow = activeTabRef.current;
      if (activeTabNow && workspaceTabReferencesFile(activeTabNow, path)) {
        setActiveFile(
          nextActiveForCurrentPane ||
            fallbackFromTabs ||
            firstRemainingFile ||
            "",
        );
      }
    },
    [],
  );

  return {
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
    hoveredCornerKey,
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
  };
}
