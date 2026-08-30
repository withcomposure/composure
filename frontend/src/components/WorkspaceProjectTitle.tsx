import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { getErrorMessage } from "@/utils/fetch";

export interface WorkspaceProjectTitleProps {
  title: string;
  canRename: boolean;
  /** When provided, a back button is rendered before the title. Omit to hide it. */
  onBack?: () => void;
  /** When provided and `canRename`, title becomes editable on click; Enter commits. */
  onRename?: (nextTitle: string) => Promise<void>;
  onRenameError?: (message: string) => void;
  className?: string;
  backLabel?: string;
  /** Stretch the title box to fill the available width (used in the editor sidebar). */
  fillWidth?: boolean;
}

export function WorkspaceProjectTitle({
  title,
  canRename,
  onBack,
  onRename,
  onRenameError,
  className = "",
  backLabel = "All projects",
  fillWidth = false,
}: WorkspaceProjectTitleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [renaming, setRenaming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  /** True for the whole async rename; blur must not cancel while set (state updates lag). */
  const commitLockRef = useRef(false);

  useEffect(() => {
    if (!editing) {
      setDraft(title);
    }
  }, [title, editing]);

  useEffect(() => {
    if (!editing) {
      return;
    }
    const el = inputRef.current;
    if (!el) {
      return;
    }
    el.focus();
    el.select();
  }, [editing]);

  const cancelEdit = useCallback(() => {
    setDraft(title);
    setEditing(false);
  }, [title]);

  const commitRename = useCallback(async () => {
    if (!onRename || commitLockRef.current) {
      return;
    }
    const next = draft.trim();
    if (!next || next === title) {
      cancelEdit();
      return;
    }
    commitLockRef.current = true;
    setRenaming(true);
    try {
      await onRename(next);
      setEditing(false);
    } catch (err) {
      onRenameError?.(getErrorMessage(err));
    } finally {
      setRenaming(false);
      // Defer unlock until after blur/unmount microtasks so onBlur does not cancel a successful save.
      window.setTimeout(() => {
        commitLockRef.current = false;
      }, 0);
    }
  }, [cancelEdit, draft, onRename, onRenameError, title]);

  const handleTitleClick = () => {
    if (!canRename || !onRename || editing) {
      return;
    }
    setEditing(true);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) {
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  };

  const handleBlur = useCallback(() => {
    queueMicrotask(() => {
      if (commitLockRef.current) {
        return;
      }
      cancelEdit();
    });
  }, [cancelEdit]);

  return (
    <div
      className={`flex min-w-0 items-center text-cz-text ${className}`}
    >
      {onBack && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onBack();
          }}
          title={backLabel}
          aria-label={backLabel}
          className="mr-1 inline-flex shrink-0 items-center justify-center rounded-md p-1 text-cz-text-muted transition-colors hover:bg-cz-accent-muted hover:text-cz-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cz-accent"
        >
          <ChevronLeft size={14} className="shrink-0" />
        </button>
      )}

      {editing ? (
        <form
          className={`${fillWidth ? "grid w-full pr-3" : "inline-grid w-max shrink overflow-x-auto"} max-w-full font-inherit`}
          data-cz-project-title-edit=""
          onSubmit={(e) => {
            e.preventDefault();
            void commitRename();
          }}
        >
          {/* Sizer: same typography/padding as input so width tracks text in one paint (no resize flash). */}
          <span
            className={`invisible col-start-1 row-start-1 box-border ${fillWidth ? "" : "min-w-[16ch]"} whitespace-pre border border-transparent px-2 py-0.5 text-sm font-inherit leading-snug`}
            aria-hidden
          >
            {draft.length > 0 ? draft : "\u00a0"}
          </span>
          <input
            ref={inputRef}
            type="text"
            size={1}
            value={draft}
            disabled={renaming}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleEditKeyDown}
            onBlur={handleBlur}
            className="col-start-1 row-start-1 box-border min-h-0 w-full min-w-0 rounded-md border border-cz-accent/40 bg-cz-bg px-2 py-0.5 text-sm font-inherit leading-snug text-cz-text outline-none ring-0 transition-[border-color] duration-150 focus:border-cz-accent/75 focus:ring-0 focus:outline-none"
            aria-label="Project name"
          />
        </form>
      ) : (
        <span className={fillWidth ? "min-w-0 flex-1 pr-3" : "min-w-0 max-w-full"}>
          {canRename && onRename ? (
            <button
              type="button"
              onClick={handleTitleClick}
              title={title ? `Rename “${title}”` : "Rename project"}
              className={`${fillWidth ? "block w-full" : "inline-block min-w-[16ch] max-w-full"} truncate rounded-md border border-transparent box-border px-2 py-0.5 text-left text-cz-text transition-colors hover:bg-cz-accent-muted hover:text-cz-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cz-accent`}
            >
              {title || "Untitled project"}
            </button>
          ) : (
            <span
              title={title || undefined}
              className={`${fillWidth ? "block w-full" : "inline-block min-w-[40ch] max-w-full"} truncate px-2 py-0.5 text-left`}
            >
              {title || "Untitled project"}
            </span>
          )}
        </span>
      )}
    </div>
  );
}
