import type React from "react";
import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from "react";
import type { StartResizeDrag } from "@/hooks/use-resize-drag";
import type { EditorLayoutNode, SplitOrientation } from "@/editor/workspace-state";
import {
  clampSplitRatio,
  findSplitRatio,
  type SplitCornerTarget,
  type SplitHandleGeometry,
  updateSplitRatio,
} from "./layout-utils";

function getClientPos(event: MouseEvent | TouchEvent | React.MouseEvent | React.TouchEvent): { clientX: number; clientY: number } {
  const e = 'nativeEvent' in event ? event.nativeEvent : event;
  if ('touches' in e) {
    const touch = e.touches[0] ?? e.changedTouches[0];
    return { clientX: touch?.clientX ?? 0, clientY: touch?.clientY ?? 0 };
  }
  return { clientX: (e as MouseEvent).clientX, clientY: (e as MouseEvent).clientY };
}

interface SidebarResizeFactoryOptions {
  startResizeDrag: StartResizeDrag;
  sidebarWidthRef: { current: number };
  setIsResizingSidebar: (resizing: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setSidebarOpen: (open: boolean) => void;
}

export function createSidebarResizeHandler({
  startResizeDrag,
  sidebarWidthRef,
  setIsResizingSidebar,
  setSidebarWidth,
  setSidebarOpen,
}: SidebarResizeFactoryOptions) {
  const collapseThreshold = 56;
  return (event: ReactMouseEvent<HTMLDivElement> | ReactTouchEvent<HTMLDivElement>) => {
    const { clientX: startX } = getClientPos(event.nativeEvent);
    const startWidth = sidebarWidthRef.current;
    let collapsedByDrag = false;

    const applySidebarOpen = (open: boolean) => {
      if (collapsedByDrag === !open) {
        return;
      }
      collapsedByDrag = !open;
      setSidebarOpen(open);
    };

    startResizeDrag(event, {
      cursor: "col-resize",
      onStart: () => {
        setIsResizingSidebar(true);
      },
      onMove: (moveEvent) => {
        const { clientX } = getClientPos(moveEvent);
        const delta = clientX - startX;
        const rawWidth = startWidth + delta;
        if (rawWidth <= collapseThreshold) {
          applySidebarOpen(false);
          return;
        }

        applySidebarOpen(true);
        const nextWidth = Math.min(420, Math.max(180, rawWidth));
        if (nextWidth !== sidebarWidthRef.current) {
          sidebarWidthRef.current = nextWidth;
          setSidebarWidth(nextWidth);
        }
      },
      onEnd: () => {
        setIsResizingSidebar(false);
      },
    });
  };
}

interface PreviewResizeFactoryOptions {
  startResizeDrag: StartResizeDrag;
  previewWidth: number;
  layoutRef: { current: HTMLDivElement | null };
  setIsResizingPreview: (resizing: boolean) => void;
  setPreviewWidth: (width: number) => void;
  setPreviewOpen: (open: boolean) => void;
}

export function createPreviewResizeHandler({
  startResizeDrag,
  previewWidth,
  layoutRef,
  setIsResizingPreview,
  setPreviewWidth,
  setPreviewOpen,
}: PreviewResizeFactoryOptions) {
  const collapseThreshold = 84;
  return (event: ReactMouseEvent<HTMLDivElement> | ReactTouchEvent<HTMLDivElement>) => {
    const { clientX: startX } = getClientPos(event.nativeEvent);
    const startWidth = previewWidth;
    let collapsedByDrag = false;

    const applyPreviewOpen = (open: boolean) => {
      if (collapsedByDrag === !open) {
        return;
      }
      collapsedByDrag = !open;
      setPreviewOpen(open);
    };

    startResizeDrag(event, {
      cursor: "col-resize",
      onStart: () => {
        setIsResizingPreview(true);
      },
      onMove: (moveEvent) => {
        const { clientX } = getClientPos(moveEvent);
        const delta = startX - clientX;
        const rawWidth = startWidth + delta;
        if (rawWidth <= collapseThreshold) {
          applyPreviewOpen(false);
          return;
        }

        applyPreviewOpen(true);
        const layoutWidth = layoutRef.current?.clientWidth ?? window.innerWidth;
        const maxWidth = Math.max(380, layoutWidth - 380);
        setPreviewWidth(Math.min(maxWidth, Math.max(300, rawWidth)));
      },
      onEnd: () => {
        setIsResizingPreview(false);
      },
    });
  };
}

interface SplitResizeFactoryOptions {
  startResizeDrag: StartResizeDrag;
  editorLayout: EditorLayoutNode;
  setEditorLayout: (updater: (prev: EditorLayoutNode) => EditorLayoutNode) => void;
}

export function createEditorSplitResizeHandler({
  startResizeDrag,
  editorLayout,
  setEditorLayout,
}: SplitResizeFactoryOptions) {
  return (
    event: ReactMouseEvent<HTMLDivElement> | ReactTouchEvent<HTMLDivElement>,
    splitId: string,
    orientation: SplitOrientation,
  ) => {
    event.stopPropagation();
    const container = (event.target as HTMLElement).parentElement;
    if (!container) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const startRatio = findSplitRatio(editorLayout, splitId);
    if (startRatio === null) {
      return;
    }

    const { clientX: startX, clientY: startY } = getClientPos(event.nativeEvent);
    startResizeDrag(event, {
      cursor: orientation === "horizontal" ? "col-resize" : "row-resize",
      onMove: (moveEvent) => {
        const { clientX, clientY } = getClientPos(moveEvent);
        const axisSize =
          orientation === "horizontal"
            ? Math.max(1, containerRect.width)
            : Math.max(1, containerRect.height);
        const delta =
          orientation === "horizontal"
            ? clientX - startX
            : clientY - startY;
        const nextRatio = clampSplitRatio(
          (startRatio * axisSize + delta) / axisSize,
        );
        setEditorLayout((prev) => updateSplitRatio(prev, splitId, nextRatio));
      },
    });
  };
}

interface CornerResizeFactoryOptions {
  startResizeDrag: StartResizeDrag;
  editorLayout: EditorLayoutNode;
  splitGeometryById: Record<string, SplitHandleGeometry>;
  setEditorLayout: (updater: (prev: EditorLayoutNode) => EditorLayoutNode) => void;
  setHoveredCornerKey: (key: string | null) => void;
  setDraggingCornerSplitIds: (ids: [string, string] | null) => void;
}

export function createEditorCornerResizeHandler({
  startResizeDrag,
  editorLayout,
  splitGeometryById,
  setEditorLayout,
  setHoveredCornerKey,
  setDraggingCornerSplitIds,
}: CornerResizeFactoryOptions) {
  return (event: ReactMouseEvent<HTMLDivElement> | ReactTouchEvent<HTMLDivElement>, corner: SplitCornerTarget) => {
    event.stopPropagation();

    const xSplitGeometry = splitGeometryById[corner.xSplitId];
    const ySplitGeometry = splitGeometryById[corner.ySplitId];
    if (!xSplitGeometry || !ySplitGeometry) {
      return;
    }

    const startXRatio = findSplitRatio(editorLayout, corner.xSplitId);
    const startYRatio = findSplitRatio(editorLayout, corner.ySplitId);
    if (startXRatio === null || startYRatio === null) {
      return;
    }

    const { clientX: startX, clientY: startY } = getClientPos(event.nativeEvent);
    const xAxisSize = Math.max(1, xSplitGeometry.rect.width);
    const yAxisSize = Math.max(1, ySplitGeometry.rect.height);

    startResizeDrag(event, {
      cursor: "move",
      onStart: () => {
        setHoveredCornerKey(corner.key);
        setDraggingCornerSplitIds([corner.xSplitId, corner.ySplitId]);
      },
      onMove: (moveEvent) => {
        const { clientX, clientY } = getClientPos(moveEvent);
        const nextXRatio = clampSplitRatio(
          (startXRatio * xAxisSize + (clientX - startX)) / xAxisSize,
        );
        const nextYRatio = clampSplitRatio(
          (startYRatio * yAxisSize + (clientY - startY)) / yAxisSize,
        );

        setEditorLayout((prev) => {
          const withX = updateSplitRatio(prev, corner.xSplitId, nextXRatio);
          return updateSplitRatio(withX, corner.ySplitId, nextYRatio);
        });
      },
      onEnd: () => {
        setDraggingCornerSplitIds(null);
      },
    });
  };
}
