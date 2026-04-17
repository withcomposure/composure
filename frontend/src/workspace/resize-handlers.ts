import type { MouseEvent as ReactMouseEvent } from "react";
import type { StartResizeDrag } from "@/hooks/useResizeDrag";
import type { EditorLayoutNode, SplitOrientation } from "@/editor/workspace-state";
import {
  clampSplitRatio,
  findSplitRatio,
  type SplitCornerTarget,
  type SplitHandleGeometry,
  updateSplitRatio,
} from "./layout-utils";

interface SidebarResizeFactoryOptions {
  startResizeDrag: StartResizeDrag;
  sidebarWidthRef: { current: number };
  setIsResizingSidebar: (resizing: boolean) => void;
  setSidebarWidth: (width: number) => void;
}

export function createSidebarResizeHandler({
  startResizeDrag,
  sidebarWidthRef,
  setIsResizingSidebar,
  setSidebarWidth,
}: SidebarResizeFactoryOptions) {
  return (event: ReactMouseEvent<HTMLDivElement>) => {
    const startX = event.clientX;
    const startWidth = sidebarWidthRef.current;
    startResizeDrag(event, {
      cursor: "col-resize",
      onStart: () => {
        setIsResizingSidebar(true);
      },
      onMove: (moveEvent) => {
        const delta = moveEvent.clientX - startX;
        const nextWidth = Math.min(420, Math.max(180, startWidth + delta));
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
}

export function createPreviewResizeHandler({
  startResizeDrag,
  previewWidth,
  layoutRef,
  setIsResizingPreview,
  setPreviewWidth,
}: PreviewResizeFactoryOptions) {
  return (event: ReactMouseEvent<HTMLDivElement>) => {
    const startX = event.clientX;
    const startWidth = previewWidth;
    startResizeDrag(event, {
      cursor: "col-resize",
      onStart: () => {
        setIsResizingPreview(true);
      },
      onMove: (moveEvent) => {
        const delta = startX - moveEvent.clientX;
        const layoutWidth = layoutRef.current?.clientWidth ?? window.innerWidth;
        const maxWidth = Math.max(380, layoutWidth - 380);
        setPreviewWidth(Math.min(maxWidth, Math.max(300, startWidth + delta)));
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
    event: ReactMouseEvent<HTMLDivElement>,
    splitId: string,
    orientation: SplitOrientation,
  ) => {
    event.stopPropagation();
    const container = event.currentTarget.parentElement;
    if (!container) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const startRatio = findSplitRatio(editorLayout, splitId);
    if (startRatio === null) {
      return;
    }

    const startX = event.clientX;
    const startY = event.clientY;
    startResizeDrag(event, {
      cursor: orientation === "horizontal" ? "col-resize" : "row-resize",
      onMove: (moveEvent) => {
        const axisSize =
          orientation === "horizontal"
            ? Math.max(1, containerRect.width)
            : Math.max(1, containerRect.height);
        const delta =
          orientation === "horizontal"
            ? moveEvent.clientX - startX
            : moveEvent.clientY - startY;
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
  return (event: ReactMouseEvent<HTMLDivElement>, corner: SplitCornerTarget) => {
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

    const startX = event.clientX;
    const startY = event.clientY;
    const xAxisSize = Math.max(1, xSplitGeometry.rect.width);
    const yAxisSize = Math.max(1, ySplitGeometry.rect.height);

    startResizeDrag(event, {
      cursor: "move",
      onStart: () => {
        setHoveredCornerKey(corner.key);
        setDraggingCornerSplitIds([corner.xSplitId, corner.ySplitId]);
      },
      onMove: (moveEvent) => {
        const nextXRatio = clampSplitRatio(
          (startXRatio * xAxisSize + (moveEvent.clientX - startX)) / xAxisSize,
        );
        const nextYRatio = clampSplitRatio(
          (startYRatio * yAxisSize + (moveEvent.clientY - startY)) / yAxisSize,
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
