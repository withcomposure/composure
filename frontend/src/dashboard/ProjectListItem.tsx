import type { DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { Pin, TextCursor, Trash2 } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import type { ProjectSummary } from "@/types";
import { fmtRelativeTime } from "@/utils/format-time";
import { projectTypeLabelFromRootFile } from "@/utils/project-format";

interface ProjectListItemProps {
  project: ProjectSummary;
  pinned: boolean;
  onOpen: (id: string, shareToken?: string) => void;
  onKeyDown: (
    event: ReactKeyboardEvent<HTMLDivElement>,
    projectId: string,
    shareToken?: string,
  ) => void;
  onTogglePin: (projectId: string) => void;
  onRename?: (project: ProjectSummary) => void;
  onDelete?: (project: ProjectSummary) => void;
  draggable?: boolean;
  dragging?: boolean;
  onDragStart?: (projectId: string) => void;
  onDragEnd?: () => void;
  onDragOver?: (event: ReactDragEvent<HTMLDivElement>, projectId: string) => void;
}

export function ProjectListItem({
  project,
  pinned,
  onOpen,
  onKeyDown,
  onTogglePin,
  onRename,
  onDelete,
  draggable = false,
  dragging = false,
  onDragStart,
  onDragEnd,
  onDragOver,
}: ProjectListItemProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(project.id, project.shareToken)}
      onKeyDown={(event) => onKeyDown(event, project.id, project.shareToken)}
      draggable={draggable}
      onDragStart={() => onDragStart?.(project.id)}
      onDragEnd={() => onDragEnd?.()}
      onDragOver={(event) => onDragOver?.(event, project.id)}
      className={`group flex w-full items-center justify-between border-b border-cz-border px-4 py-3 text-left transition last:border-b-0 hover:bg-cz-surface-hover focus-visible:outline-2 focus-visible:outline-cz-accent ${dragging ? "opacity-70" : ""}`}
    >
      <div className="min-w-0">
        <div className="flex items-center">
          <div className="truncate text-sm text-cz-text">{project.title}</div>
          {project.topLevelCommentCount > 0 && (
            <span
              className="ml-3 inline-flex shrink-0 items-center rounded-full border border-cz-border bg-cz-bg px-1.5 py-0.5 text-[10px] font-semibold text-cz-text-muted"
              title={`${project.topLevelCommentCount} open comments`}
            >
              {project.topLevelCommentCount}
            </span>
          )}
        </div>
        <div className="text-xs text-cz-text-muted">
          {projectTypeLabelFromRootFile(project.rootFile)} · Last active{" "}
          {fmtRelativeTime(project.lastActiveAt)}
        </div>
      </div>

      <div className="ml-3 flex items-center gap-2">
        {(onRename || onDelete) && (
          <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
            {onRename && (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onRename(project);
                }}
                className="rounded p-1 text-cz-text-muted hover:bg-cz-bg hover:text-cz-text"
                title="Rename"
              >
                <TextCursor size={13} />
              </button>
            )}
            {onDelete && (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(project);
                }}
                className="rounded p-1 text-cz-text-muted hover:bg-red-500/15 hover:text-red-200"
                title="Delete"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onTogglePin(project.id);
          }}
          className={`rounded p-1 transition ${pinned ? "text-cz-accent" : "text-cz-text-muted opacity-0 group-hover:opacity-100 hover:bg-cz-surface-hover hover:text-cz-text"}`}
          title={pinned ? "Unpin" : "Pin"}
        >
          <Pin size={13} className={pinned ? "fill-current" : ""} />
        </button>

        <Avatar
          name={project.ownerDisplayName}
          imageUrl={project.ownerProfileImageUrl}
          isGuest={project.ownerType === "guest"}
          size={26}
        />
      </div>
    </div>
  );
}
