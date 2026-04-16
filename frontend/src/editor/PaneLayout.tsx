import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { ResizeHandle } from "../components/ResizeHandle";
import type { EditorLayoutNode, SplitOrientation } from "./workspace-state";

interface PaneLayoutProps {
  node: EditorLayoutNode;
  renderPane: (paneId: string) => ReactNode;
  forcedActiveSplitIds: Set<string>;
  onResizeSplit: (
    event: ReactMouseEvent<HTMLDivElement>,
    splitId: string,
    orientation: SplitOrientation,
  ) => void;
}

export function PaneLayout({
  node,
  renderPane,
  forcedActiveSplitIds,
  onResizeSplit,
}: PaneLayoutProps) {
  if (node.kind === "pane") {
    return <>{renderPane(node.paneId)}</>;
  }

  const firstGrow = node.ratio;
  const secondGrow = 1 - node.ratio;
  const isHorizontal = node.orientation === "horizontal";

  return (
    <div
      className={`flex h-full min-h-0 min-w-0 ${isHorizontal ? "flex-row" : "flex-col"}`}
    >
      <div
        className="min-h-0 min-w-0 overflow-hidden"
        style={{ flexBasis: 0, flexGrow: firstGrow }}
      >
        <PaneLayout
          node={node.first}
          renderPane={renderPane}
          forcedActiveSplitIds={forcedActiveSplitIds}
          onResizeSplit={onResizeSplit}
        />
      </div>

      <ResizeHandle
        orientation={isHorizontal ? "vertical" : "horizontal"}
        ariaLabel="Resize editor split"
        onMouseDown={(event) =>
          onResizeSplit(event, node.splitId, node.orientation)
        }
        forceActive={forcedActiveSplitIds.has(node.splitId)}
        className="z-30"
      />

      <div
        className="min-h-0 min-w-0 overflow-hidden"
        style={{ flexBasis: 0, flexGrow: secondGrow }}
      >
        <PaneLayout
          node={node.second}
          renderPane={renderPane}
          forcedActiveSplitIds={forcedActiveSplitIds}
          onResizeSplit={onResizeSplit}
        />
      </div>
    </div>
  );
}
