import type { DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { Pin, TextCursor, Trash2 } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import type { ProjectSummary } from "@/types";
import { fmtRelativeTime } from "@/utils/format-time";
import { projectTypeLabel } from "@/utils/project-format";

interface ProjectCardProps {
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

export function ProjectCard({
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
}: ProjectCardProps) {
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
      className={`group relative rounded-xl border border-cz-border bg-cz-surface p-4 text-left transition hover:border-cz-accent/30 hover:shadow-lg hover:shadow-black/20 focus-visible:outline-2 focus-visible:outline-cz-accent ${dragging ? "scale-[0.98] opacity-70" : ""}`}
    >
      {project.topLevelCommentCount > 0 && (
        <div
          className="pointer-events-none absolute -top-2 -right-2 rounded-full border border-cz-border bg-cz-surface px-2 py-0.5 text-[10px] font-semibold text-cz-text shadow-lg"
          title={`${project.topLevelCommentCount} open comments`}
        >
          {project.topLevelCommentCount}
        </div>
      )}

      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="line-clamp-1 text-sm font-medium text-cz-text">
            {project.title}
          </div>
          <div className="mt-1">
            <span className="inline-flex items-center rounded-full border border-cz-border bg-cz-bg px-2 py-0.5 text-[10px] font-medium tracking-wide text-cz-text-muted">
              {projectTypeLabel({ engine: project.engine, rootFile: project.rootFile })}
            </span>
          </div>
        </div>

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
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="text-xs text-cz-text-muted">
          Last active {fmtRelativeTime(project.lastActiveAt)}
        </div>
        <div className="flex items-center gap-2">
          {(onRename || onDelete) && (
            <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
              {onRename && (
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onRename(project);
                  }}
                  className="rounded p-1 text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text"
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
          <Avatar
            name={project.ownerDisplayName}
            imageUrl={project.ownerProfileImageUrl}
            isGuest={project.ownerType === "guest"}
            size={26}
          />
        </div>
      </div>
    </div>
  );
}
