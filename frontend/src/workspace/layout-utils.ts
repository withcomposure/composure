import type { EditorLayoutNode, SplitOrientation } from "@/editor/workspace-state";
import {
  readComposureDragData,
  TAB_SINGLE_PATH_MIME,
  TAB_SOURCE_PANE_MIME,
  TREE_MULTI_PATHS_MIME,
  TREE_SINGLE_PATH_MIME,
} from "@/utils/drag-data";

export type SplitDropZone = "center" | "right" | "bottom";

export interface DraggedFilePayload {
  paths: string[];
  fromTabBar: boolean;
  sourcePaneId: string | null;
}

interface LayoutRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SplitHandleGeometry {
  splitId: string;
  orientation: SplitOrientation;
  rect: LayoutRect;
  line: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };
}

export interface SplitCornerTarget {
  key: string;
  x: number;
  y: number;
  xSplitId: string;
  ySplitId: string;
}

const splitRatioMin = 0.15;
const splitRatioMax = 0.85;
const intersectionTolerancePx = 1.5;

export function dedupePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.filter((path) => path.trim().length > 0)));
}

export function collectPaneIds(node: EditorLayoutNode): string[] {
  if (node.kind === "pane") {
    return [node.paneId];
  }
  return [...collectPaneIds(node.first), ...collectPaneIds(node.second)];
}

export function updateSplitRatio(
  node: EditorLayoutNode,
  splitId: string,
  ratio: number,
): EditorLayoutNode {
  if (node.kind === "pane") {
    return node;
  }
  if (node.splitId === splitId) {
    return {
      ...node,
      ratio,
    };
  }
  return {
    ...node,
    first: updateSplitRatio(node.first, splitId, ratio),
    second: updateSplitRatio(node.second, splitId, ratio),
  };
}

export function findSplitRatio(
  node: EditorLayoutNode,
  splitId: string,
): number | null {
  if (node.kind === "pane") {
    return null;
  }
  if (node.splitId === splitId) {
    return node.ratio;
  }
  return (
    findSplitRatio(node.first, splitId) ?? findSplitRatio(node.second, splitId)
  );
}

export function insertSplitAtPane(
  node: EditorLayoutNode,
  targetPaneId: string,
  newPaneId: string,
  splitId: string,
  orientation: SplitOrientation,
): EditorLayoutNode {
  if (node.kind === "pane") {
    if (node.paneId !== targetPaneId) {
      return node;
    }
    return {
      kind: "split",
      splitId,
      orientation,
      ratio: 0.5,
      first: node,
      second: { kind: "pane", paneId: newPaneId },
    };
  }

  return {
    ...node,
    first: insertSplitAtPane(
      node.first,
      targetPaneId,
      newPaneId,
      splitId,
      orientation,
    ),
    second: insertSplitAtPane(
      node.second,
      targetPaneId,
      newPaneId,
      splitId,
      orientation,
    ),
  };
}

export function removePaneFromLayout(
  node: EditorLayoutNode,
  paneId: string,
): EditorLayoutNode | null {
  if (node.kind === "pane") {
    return node.paneId === paneId ? null : node;
  }

  const nextFirst = removePaneFromLayout(node.first, paneId);
  const nextSecond = removePaneFromLayout(node.second, paneId);

  if (!nextFirst && !nextSecond) {
    return null;
  }
  if (!nextFirst) {
    return nextSecond;
  }
  if (!nextSecond) {
    return nextFirst;
  }

  return {
    ...node,
    first: nextFirst,
    second: nextSecond,
  };
}

export function readDraggedFilePayload(
  dataTransfer: DataTransfer,
  allFilePaths: Set<string>,
): DraggedFilePayload | null {
  const tabPath = readComposureDragData(dataTransfer, TAB_SINGLE_PATH_MIME);
  if (tabPath) {
    const nextPaths = dedupePaths([tabPath]).filter((path) =>
      allFilePaths.has(path),
    );
    if (nextPaths.length > 0) {
      return {
        paths: nextPaths,
        fromTabBar: true,
        sourcePaneId:
          readComposureDragData(dataTransfer, TAB_SOURCE_PANE_MIME) || null,
      };
    }
    return null;
  }

  const multiRaw = readComposureDragData(dataTransfer, TREE_MULTI_PATHS_MIME);
  if (multiRaw) {
    try {
      const parsed = JSON.parse(multiRaw) as unknown;
      if (Array.isArray(parsed)) {
        const nextPaths = dedupePaths(
          parsed.filter((value): value is string => typeof value === "string"),
        ).filter((path) => allFilePaths.has(path));
        if (nextPaths.length > 0) {
          return {
            paths: nextPaths,
            fromTabBar: false,
            sourcePaneId: null,
          };
        }
      }
    } catch {
      // Ignore malformed payload.
    }
  }

  const singlePath = readComposureDragData(dataTransfer, TREE_SINGLE_PATH_MIME);
  if (singlePath && allFilePaths.has(singlePath)) {
    return {
      paths: [singlePath],
      fromTabBar: false,
      sourcePaneId: null,
    };
  }

  return null;
}

export function computeDropZone(
  rect: DOMRect,
  clientX: number,
  clientY: number,
): SplitDropZone {
  const rightThreshold = rect.left + rect.width * 0.75;
  const bottomThreshold = rect.top + rect.height * 0.75;
  const inRight = clientX >= rightThreshold;
  const inBottom = clientY >= bottomThreshold;

  if (inRight && inBottom) {
    const rightDistance = (rect.right - clientX) / Math.max(1, rect.width);
    const bottomDistance = (rect.bottom - clientY) / Math.max(1, rect.height);
    return rightDistance <= bottomDistance ? "right" : "bottom";
  }
  if (inRight) return "right";
  if (inBottom) return "bottom";
  return "center";
}

export function clampSplitRatio(ratio: number): number {
  return Math.max(splitRatioMin, Math.min(splitRatioMax, ratio));
}

function collectSplitHandleGeometry(
  node: EditorLayoutNode,
  rect: LayoutRect,
  out: SplitHandleGeometry[],
): void {
  if (node.kind === "pane") {
    return;
  }

  if (node.orientation === "horizontal") {
    const firstWidth = rect.width * node.ratio;
    const dividerX = rect.left + firstWidth;
    out.push({
      splitId: node.splitId,
      orientation: node.orientation,
      rect,
      line: {
        x1: dividerX,
        y1: rect.top,
        x2: dividerX,
        y2: rect.top + rect.height,
      },
    });

    collectSplitHandleGeometry(
      node.first,
      {
        left: rect.left,
        top: rect.top,
        width: firstWidth,
        height: rect.height,
      },
      out,
    );
    collectSplitHandleGeometry(
      node.second,
      {
        left: dividerX,
        top: rect.top,
        width: rect.width - firstWidth,
        height: rect.height,
      },
      out,
    );
    return;
  }

  const firstHeight = rect.height * node.ratio;
  const dividerY = rect.top + firstHeight;
  out.push({
    splitId: node.splitId,
    orientation: node.orientation,
    rect,
    line: {
      x1: rect.left,
      y1: dividerY,
      x2: rect.left + rect.width,
      y2: dividerY,
    },
  });

  collectSplitHandleGeometry(
    node.first,
    {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: firstHeight,
    },
    out,
  );
  collectSplitHandleGeometry(
    node.second,
    {
      left: rect.left,
      top: dividerY,
      width: rect.width,
      height: rect.height - firstHeight,
    },
    out,
  );
}

function isWithinRange(value: number, a: number, b: number): boolean {
  const min = Math.min(a, b) - intersectionTolerancePx;
  const max = Math.max(a, b) + intersectionTolerancePx;
  return value >= min && value <= max;
}

function isNear(value: number, target: number): boolean {
  return Math.abs(value - target) <= intersectionTolerancePx;
}

function collectSplitCorners(handles: SplitHandleGeometry[]): SplitCornerTarget[] {
  const xSplitHandles = handles.filter(
    (handle) => handle.orientation === "horizontal",
  );
  const ySplitHandles = handles.filter(
    (handle) => handle.orientation === "vertical",
  );
  const corners: SplitCornerTarget[] = [];
  const seen = new Set<string>();

  for (const xSplit of xSplitHandles) {
    const x = xSplit.line.x1;
    for (const ySplit of ySplitHandles) {
      const y = ySplit.line.y1;
      if (
        !isWithinRange(x, ySplit.line.x1, ySplit.line.x2) ||
        !isWithinRange(y, xSplit.line.y1, xSplit.line.y2)
      ) {
        continue;
      }

      const xSplitEndsAtCorner =
        isNear(y, xSplit.line.y1) || isNear(y, xSplit.line.y2);
      const ySplitEndsAtCorner =
        isNear(x, ySplit.line.x1) || isNear(x, ySplit.line.x2);
      if (!xSplitEndsAtCorner && !ySplitEndsAtCorner) {
        continue;
      }

      const roundedX = Math.round(x * 100) / 100;
      const roundedY = Math.round(y * 100) / 100;
      const key = `${xSplit.splitId}:${ySplit.splitId}:${roundedX}:${roundedY}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      corners.push({
        key,
        x,
        y,
        xSplitId: xSplit.splitId,
        ySplitId: ySplit.splitId,
      });
    }
  }

  return corners;
}

export function buildSplitGeometry(
  layout: EditorLayoutNode,
  width: number,
  height: number,
): { byId: Record<string, SplitHandleGeometry>; corners: SplitCornerTarget[] } {
  if (layout.kind === "pane" || width <= 0 || height <= 0) {
    return {
      byId: {},
      corners: [],
    };
  }

  const handles: SplitHandleGeometry[] = [];
  collectSplitHandleGeometry(
    layout,
    {
      left: 0,
      top: 0,
      width,
      height,
    },
    handles,
  );

  const byId: Record<string, SplitHandleGeometry> = {};
  for (const handle of handles) {
    byId[handle.splitId] = handle;
  }

  return {
    byId,
    corners: collectSplitCorners(handles),
  };
}
