import { useCallback, useEffect, useMemo, useState } from "react";
import type * as Y from "yjs";
import type { CommentLineNumbers } from "@/sidebar/CommentsPanel";
import type { ProjectComment } from "@/types";
import { apiFetch } from "@/utils/fetch";

interface UseProjectCommentsOptions {
  projectId: string;
  shareHeaders: Record<string, string>;
  ydoc: Y.Doc;
  canInteractWithComments: boolean;
  /** The workspace's active file path; changing it clears the selection. */
  activeFile: string;
}

export interface ProjectComments {
  comments: ProjectComment[];
  activeCommentId: string | null;
  activeCommentRevision: number;
  commentLineNumbersById: Record<string, CommentLineNumbers>;
  activateComment: (commentId: string | null) => void;
  hoverComment: (commentId: string | null) => void;
  endHoverComment: () => void;
  setCommentLineNumbersForFile: (
    filePath: string,
    nextFileLineNumbers: Record<string, CommentLineNumbers>,
  ) => void;
  createComment: (input: {
    filePath: string;
    startLine: number | null;
    endLine: number | null;
    parentCommentId: string | null;
    body: string;
  }) => Promise<void>;
  updateComment: (commentId: string, body: string) => Promise<void>;
  removeComment: (commentId: string) => Promise<void>;
}

export function useProjectComments({
  projectId,
  shareHeaders,
  ydoc,
  canInteractWithComments,
  activeFile,
}: UseProjectCommentsOptions): ProjectComments {
  const [comments, setComments] = useState<ProjectComment[]>([]);
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(
    null,
  );
  const [hoveredCommentId, setHoveredCommentId] = useState<string | null>(null);
  const [activeCommentRevision, setActiveCommentRevision] = useState(0);
  const [commentLineNumbersById, setCommentLineNumbersById] = useState<
    Record<string, CommentLineNumbers>
  >({});

  const activeCommentId = hoveredCommentId ?? selectedCommentId;

  // Selecting a different file clears the comment selection (previously an
  // effect; adjusted during render so the cleared state paints immediately).
  const [prevActiveFile, setPrevActiveFile] = useState(activeFile);
  if (prevActiveFile !== activeFile) {
    setPrevActiveFile(activeFile);
    setSelectedCommentId(null);
    setHoveredCommentId(null);
    setActiveCommentRevision((prev) => prev + 1);
  }

  // Every active-comment change bumps the revision so the editor re-anchors
  // its highlight even when the same comment is re-activated elsewhere.
  const [prevActiveCommentId, setPrevActiveCommentId] =
    useState(activeCommentId);
  if (prevActiveCommentId !== activeCommentId) {
    setPrevActiveCommentId(activeCommentId);
    setActiveCommentRevision((prev) => prev + 1);
  }

  // Drop line-number entries for comments that no longer exist (previously
  // an effect keyed on the comment list).
  const [prevPruneComments, setPrevPruneComments] = useState<
    ProjectComment[] | null
  >(null);
  if (prevPruneComments !== comments) {
    setPrevPruneComments(comments);
    const validIds = new Set(comments.map((comment) => comment.id));
    setCommentLineNumbersById((prev) => {
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
  }

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

  const loadComments = useCallback(() => {
    return apiFetch(`/projects/${projectId}/comments`, {
      headers: shareHeaders,
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error("Failed to load comments");
        }

        const body = (await res.json()) as ProjectComment[];
        setComments(body);
      })
      .catch((err: unknown) => {
        console.warn(`[app] load-comments-failed ${String(err)}`);
      });
  }, [projectId, shareHeaders]);

  useEffect(() => {
    void loadComments();
  }, [loadComments]);

  useEffect(() => {
    const handleCommentsSync = () => {
      void loadComments();
    };

    commentsSyncMap.observe(handleCommentsSync);
    return () => {
      commentsSyncMap.unobserve(handleCommentsSync);
    };
  }, [commentsSyncMap, loadComments]);

  const activateComment = useCallback((commentId: string | null) => {
    setSelectedCommentId(commentId);
    setHoveredCommentId(null);
    setActiveCommentRevision((prev) => prev + 1);
  }, []);

  const hoverComment = useCallback((commentId: string | null) => {
    setHoveredCommentId(commentId);
  }, []);

  const endHoverComment = useCallback(() => {
    setHoveredCommentId(null);
  }, []);

  const setCommentLineNumbersForFile = useCallback(
    (
      filePath: string,
      nextFileLineNumbers: Record<string, CommentLineNumbers>,
    ) => {
      setCommentLineNumbersById((prev) => {
        const next = { ...prev };
        for (const comment of comments) {
          if (comment.filePath === filePath) {
            delete next[comment.id];
          }
        }
        for (const [commentId, lines] of Object.entries(nextFileLineNumbers)) {
          next[commentId] = lines;
        }
        return next;
      });
    },
    [comments],
  );

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

  return {
    comments,
    activeCommentId,
    activeCommentRevision,
    commentLineNumbersById,
    activateComment,
    hoverComment,
    endHoverComment,
    setCommentLineNumbersForFile,
    createComment,
    updateComment,
    removeComment,
  };
}
