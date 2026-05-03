import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { getErrorMessage } from "@/utils/fetch";

export interface WorkspaceProjectTitleProps {
  title: string;
  canRename: boolean;
  onBack: () => void;
  /** When provided and `canRename`, title becomes editable on click; Enter commits. */
  onRename?: (nextTitle: string) => Promise<void>;
  onRenameError?: (message: string) => void;
  className?: string;
  backLabel?: string;
}

const chevronRevealClasses =
  "mr-0 -translate-x-1 opacity-0 pointer-events-none transition-all duration-200 group-hover:pointer-events-auto group-hover:mr-1 group-hover:translate-x-0 group-hover:opacity-100 [@media(pointer:coarse)]:pointer-events-auto [@media(pointer:coarse)]:mr-1 [@media(pointer:coarse)]:translate-x-0 [@media(pointer:coarse)]:opacity-100";

const titleSlideClasses =
  "transition-transform duration-200 group-hover:translate-x-1.5 [@media(pointer:coarse)]:translate-x-1.5";

export function WorkspaceProjectTitle({
  title,
  canRename,
  onBack,
  onRename,
  onRenameError,
  className = "",
  backLabel = "All projects",
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
      className={`group flex min-w-0 items-center text-cz-text ${className}`}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onBack();
        }}
        title={backLabel}
        aria-label={backLabel}
        className={`inline-flex shrink-0 items-center justify-center p-1 text-cz-text-muted transition-colors rounded-md ${chevronRevealClasses} hover:bg-cz-surface-hover/80 hover:text-cz-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cz-accent`}
      >
        <ChevronLeft size={14} className="shrink-0" />
      </button>

      {editing ? (
        <form
          className="min-w-0 flex-1"
          data-cz-project-title-edit=""
          onSubmit={(e) => {
            e.preventDefault();
            void commitRename();
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={draft}
            disabled={renaming}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleEditKeyDown}
            onBlur={handleBlur}
            className="box-border w-full min-w-0 border border-cz-border bg-cz-bg px-2 py-0.5 text-sm text-cz-text outline-none ring-cz-accent focus:ring-2"
            aria-label="Project name"
          />
        </form>
      ) : (
        <span className="min-w-0 flex-1">
          {canRename && onRename ? (
            <button
              type="button"
              onClick={handleTitleClick}
              title={title ? `Rename “${title}”` : "Rename project"}
              className={`w-full min-w-0 max-w-full whitespace-normal break-words text-left ${titleSlideClasses} px-1.5 py-0.5 -mx-1.5 rounded-md text-cz-text transition-colors hover:bg-cz-surface-hover/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cz-accent`}
            >
              {title || "Untitled project"}
            </button>
          ) : (
            <span
              title={title || undefined}
              className={`block w-full min-w-0 max-w-full whitespace-normal break-words ${titleSlideClasses} px-1.5 py-0.5 -mx-1.5`}
            >
              {title || "Untitled project"}
            </span>
          )}
        </span>
      )}
    </div>
  );
}
