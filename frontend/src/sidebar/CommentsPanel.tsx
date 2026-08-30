import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import type { ProjectComment } from '@/types'
import { fmtTime } from '@/utils/format-time'
import { getErrorMessage } from '@/utils/fetch'

export interface CommentLineNumbers {
  startLine: number | null
  endLine: number | null
}

interface CommentsPanelProps {
  activeFile: string
  comments: ProjectComment[]
  commentLineNumbersById?: Record<string, CommentLineNumbers>
  canComment: boolean
  canModerate: boolean
  onActivateComment: (commentId: string) => void
  onHoverComment: (commentId: string) => void
  onHoverCommentEnd: () => void
  principalUserId: string | null
  principalGuestId: string | null
  onReplyComment: (input: {
    filePath: string
    startLine: number | null
    endLine: number | null
    parentCommentId: string | null
    body: string
  }) => Promise<void>
  onEditComment: (commentId: string, body: string) => Promise<void>
  onDeleteComment: (commentId: string) => Promise<void>
}

function getEffectiveCommentLines(
  comment: ProjectComment,
  commentLineNumbersById?: Record<string, CommentLineNumbers>,
): CommentLineNumbers {
  const override = commentLineNumbersById?.[comment.id]
  const start = override?.startLine ?? comment.startLine
  const end = override?.endLine ?? comment.endLine ?? start
  return {
    startLine: start,
    endLine: end,
  }
}

function fmtLineRange(comment: ProjectComment, commentLineNumbersById?: Record<string, CommentLineNumbers>): string | null {
  const lines = getEffectiveCommentLines(comment, commentLineNumbersById)
  const start = lines.startLine
  const end = lines.endLine
  if (!start || !end) {
    return null
  }
  return start === end ? `L${start}` : `L${start}-L${end}`
}

function isOwnComment(comment: ProjectComment, principalUserId: string | null, principalGuestId: string | null): boolean {
  if (comment.authorUserId && principalUserId) {
    return comment.authorUserId === principalUserId
  }
  if (comment.authorGuestId && principalGuestId) {
    return comment.authorGuestId === principalGuestId
  }
  return false
}

export function CommentsPanel({
  activeFile,
  comments,
  commentLineNumbersById,
  canComment,
  canModerate,
  onActivateComment,
  onHoverComment,
  onHoverCommentEnd,
  principalUserId,
  principalGuestId,
  onReplyComment,
  onEditComment,
  onDeleteComment,
}: CommentsPanelProps) {
  const [replyById, setReplyById] = useState<Record<string, string>>({})
  const [editById, setEditById] = useState<Record<string, string>>({})
  const [busyById, setBusyById] = useState<Record<string, boolean>>({})
  const [replyFocusId, setReplyFocusId] = useState<string | null>(null)
  const [editFocusId, setEditFocusId] = useState<string | null>(null)
  const replyInputByIdRef = useRef<Record<string, HTMLTextAreaElement | null>>({})
  const editInputByIdRef = useRef<Record<string, HTMLTextAreaElement | null>>({})

  const fileComments = useMemo(
    () => comments.filter((comment) => comment.filePath === activeFile),
    [comments, activeFile],
  )

  const repliesByParent = useMemo(() => {
    const map = new Map<string, ProjectComment[]>()
    for (const comment of fileComments) {
      if (!comment.parentCommentId) continue
      const group = map.get(comment.parentCommentId) ?? []
      group.push(comment)
      map.set(comment.parentCommentId, group)
    }
    return map
  }, [fileComments])

  const rootComments = useMemo(
    () => fileComments
      .filter((comment) => comment.parentCommentId === null)
      .sort((a, b) => {
        const aStart = getEffectiveCommentLines(a, commentLineNumbersById).startLine ?? Number.MAX_SAFE_INTEGER
        const bStart = getEffectiveCommentLines(b, commentLineNumbersById).startLine ?? Number.MAX_SAFE_INTEGER
        if (aStart !== bStart) {
          return aStart - bStart
        }
        return a.createdAt - b.createdAt
      }),
    [fileComments, commentLineNumbersById],
  )

  useEffect(() => {
    if (!replyFocusId) return
    const textarea = replyInputByIdRef.current[replyFocusId]
    if (!textarea) return
    textarea.focus()
    textarea.selectionStart = textarea.value.length
    textarea.selectionEnd = textarea.value.length
    setReplyFocusId(null)
  }, [replyById, replyFocusId])

  useEffect(() => {
    if (!editFocusId) return
    const textarea = editInputByIdRef.current[editFocusId]
    if (!textarea) return
    textarea.focus()
    textarea.selectionStart = textarea.value.length
    textarea.selectionEnd = textarea.value.length
    setEditFocusId(null)
  }, [editById, editFocusId])

  // Losing comment permission discards in-progress drafts (previously an
  // effect keyed on canComment).
  const [prevCanComment, setPrevCanComment] = useState(canComment)
  if (prevCanComment !== canComment) {
    setPrevCanComment(canComment)
    if (!canComment) {
      setReplyById({})
      setEditById({})
      setReplyFocusId(null)
      setEditFocusId(null)
    }
  }

  const [actionError, setActionError] = useState<string | null>(null)

  const submitReply = async (parent: ProjectComment) => {
    const draft = (replyById[parent.id] ?? '').trim()
    if (!draft) return

    setBusyById((prev) => ({ ...prev, [parent.id]: true }))
    try {
      const parentLines = getEffectiveCommentLines(parent, commentLineNumbersById)
      const startLine = parentLines.startLine
      const endLine = parentLines.endLine ?? startLine
      await onReplyComment({
        filePath: activeFile,
        startLine,
        endLine,
        parentCommentId: parent.id,
        body: draft,
      })
      setReplyById((prev) => {
        const next = { ...prev }
        delete next[parent.id]
        return next
      })
      setActionError(null)
    } catch (err) {
      setActionError(getErrorMessage(err))
    } finally {
      setBusyById((prev) => ({ ...prev, [parent.id]: false }))
    }
  }

  const submitEdit = async (comment: ProjectComment) => {
    const draft = (editById[comment.id] ?? comment.body).trim()
    if (!draft) return

    setBusyById((prev) => ({ ...prev, [comment.id]: true }))
    try {
      await onEditComment(comment.id, draft)
      setEditById((prev) => {
        const next = { ...prev }
        delete next[comment.id]
        return next
      })
      setActionError(null)
    } catch (err) {
      setActionError(getErrorMessage(err))
    } finally {
      setBusyById((prev) => ({ ...prev, [comment.id]: false }))
    }
  }

  const removeComment = async (commentId: string) => {
    setBusyById((prev) => ({ ...prev, [commentId]: true }))
    try {
      await onDeleteComment(commentId)
      setActionError(null)
    } catch (err) {
      setActionError(getErrorMessage(err))
    } finally {
      setBusyById((prev) => ({ ...prev, [commentId]: false }))
    }
  }

  const clearEditDraft = (commentId: string) => {
    setEditById((prev) => {
      const next = { ...prev }
      delete next[commentId]
      return next
    })
  }

  const clearReplyDraft = (commentId: string) => {
    setReplyById((prev) => {
      const next = { ...prev }
      delete next[commentId]
      return next
    })
  }

  const isSubmitShortcut = (event: ReactKeyboardEvent<HTMLTextAreaElement>): boolean => {
    return event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-cz-surface/30">
      <div className="mb-2 px-3 pt-2">
        <div className="text-[10px] font-medium uppercase tracking-widest text-cz-text-muted">Review</div>
        <div
          className="mt-1 truncate text-xs text-cz-text-muted"
          title={activeFile || 'No file selected'}
        >
          {activeFile || 'No file selected'}
        </div>
        {actionError && (
          <div className="mt-1 text-[11px] text-red-300">{actionError}</div>
        )}
      </div>

      <div className="h-full overflow-y-auto px-3 pb-3">
        {rootComments.length === 0 ? (
          <div className="rounded-md border border-cz-border-subtle bg-cz-bg/60 p-3 text-xs text-cz-text-muted">
            No comments for this file yet.
          </div>
        ) : (
          <div className="space-y-3">
            {rootComments.map((comment) => {
              const replies = [...(repliesByParent.get(comment.id) ?? [])].sort((a, b) => a.createdAt - b.createdAt)
              const own = isOwnComment(comment, principalUserId, principalGuestId)
              const canManageThisComment = canComment && (own || canModerate)
              const editing = Object.prototype.hasOwnProperty.call(editById, comment.id)
              const lineLabel = fmtLineRange(comment, commentLineNumbersById)

              return (
                <div key={comment.id} className="rounded-md border border-cz-border-subtle bg-cz-bg/60 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <Avatar
                      name={comment.authorDisplayName}
                      imageUrl={comment.authorProfileImageUrl}
                      isGuest={!comment.authorUserId}
                      size={24}
                    />
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-cz-text">{comment.authorDisplayName}</div>
                      <div className="text-[11px] text-cz-text-muted">{fmtTime(comment.createdAt)}</div>
                    </div>
                    {lineLabel ? (
                      <button
                        type="button"
                        onClick={() => onActivateComment(comment.id)}
                        onMouseEnter={() => onHoverComment(comment.id)}
                        onMouseLeave={onHoverCommentEnd}
                        className="ml-auto rounded border border-cz-border px-1.5 py-0.5 text-[10px] text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text"
                      >
                        {lineLabel}
                      </button>
                    ) : null}
                  </div>

                  {editing ? (
                    <div className="space-y-2">
                      <textarea
                        data-cz-comment-input="true"
                        ref={(node) => {
                          editInputByIdRef.current[comment.id] = node
                        }}
                        value={editById[comment.id] ?? comment.body}
                        onChange={(e) => setEditById((prev) => ({ ...prev, [comment.id]: e.target.value }))}
                        onKeyDown={(event) => {
                          if (isSubmitShortcut(event)) {
                            event.preventDefault()
                            void submitEdit(comment)
                            return
                          }
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            clearEditDraft(comment.id)
                          }
                        }}
                        className="h-20 w-full resize-none rounded-md border border-cz-border bg-cz-bg px-2 py-1.5 text-xs text-cz-text outline-none focus:border-cz-accent"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            void submitEdit(comment)
                          }}
                          disabled={busyById[comment.id] || (editById[comment.id] ?? comment.body).trim().length === 0}
                          className="rounded-md bg-cz-accent px-2 py-1 text-[11px] text-white disabled:opacity-60"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => clearEditDraft(comment.id)}
                          className="rounded-md border border-cz-border px-2 py-1 text-[11px] text-cz-text-muted hover:bg-cz-surface-hover"
                        >
                          Cancel
                        </button>
                        {canManageThisComment && (
                          <button
                            onClick={() => {
                              void removeComment(comment.id)
                            }}
                            disabled={busyById[comment.id]}
                            className="ml-auto rounded border border-red-500/30 px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/10 disabled:opacity-60"
                            title="Delete"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap text-xs text-cz-text">{comment.body}</p>
                  )}

                  <div className="mt-2 flex items-center gap-2">
                    {canComment && !editing && (
                      <button
                        onClick={() => {
                          setReplyById((prev) => ({ ...prev, [comment.id]: prev[comment.id] ?? '' }))
                          setReplyFocusId(comment.id)
                        }}
                        className="rounded border border-cz-border px-2 py-0.5 text-[11px] text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text"
                      >
                        Reply
                      </button>
                    )}
                    {canManageThisComment && !editing && (
                      <button
                        onClick={() => {
                          setEditById((prev) => ({ ...prev, [comment.id]: comment.body }))
                          setEditFocusId(comment.id)
                        }}
                        className="rounded border border-cz-border px-2 py-0.5 text-[11px] text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text"
                      >
                        Edit
                      </button>
                    )}
                    {canManageThisComment && !editing && (
                      <button
                        onClick={() => {
                          void removeComment(comment.id)
                        }}
                        disabled={busyById[comment.id]}
                        className="ml-auto rounded border border-red-500/30 px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/10 disabled:opacity-60"
                        title="Delete"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>

                  {replies.length > 0 && (
                    <div className="mt-3 space-y-2 border-l border-cz-border pl-3">
                      {replies.map((reply) => {
                        const replyOwn = isOwnComment(reply, principalUserId, principalGuestId)
                        const canManageReply = canComment && (replyOwn || canModerate)
                        const replyEditing = Object.prototype.hasOwnProperty.call(editById, reply.id)

                        return (
                          <div key={reply.id} className="rounded border border-cz-border-subtle bg-cz-surface p-2">
                            <div className="mb-1 flex items-center gap-2">
                              <Avatar
                                name={reply.authorDisplayName}
                                imageUrl={reply.authorProfileImageUrl}
                                isGuest={!reply.authorUserId}
                                size={20}
                              />
                              <div className="text-[11px] text-cz-text-muted">
                                {reply.authorDisplayName} · {fmtTime(reply.createdAt)}
                              </div>
                            </div>

                            {replyEditing ? (
                              <div className="space-y-2">
                                <textarea
                                  data-cz-comment-input="true"
                                  ref={(node) => {
                                    editInputByIdRef.current[reply.id] = node
                                  }}
                                  value={editById[reply.id] ?? reply.body}
                                  onChange={(e) => setEditById((prev) => ({ ...prev, [reply.id]: e.target.value }))}
                                  onKeyDown={(event) => {
                                    if (isSubmitShortcut(event)) {
                                      event.preventDefault()
                                      void submitEdit(reply)
                                      return
                                    }
                                    if (event.key === 'Escape') {
                                      event.preventDefault()
                                      clearEditDraft(reply.id)
                                    }
                                  }}
                                  className="h-16 w-full resize-none rounded-md border border-cz-border bg-cz-bg px-2 py-1.5 text-xs text-cz-text outline-none focus:border-cz-accent"
                                />
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => {
                                      void submitEdit(reply)
                                    }}
                                    disabled={busyById[reply.id] || (editById[reply.id] ?? reply.body).trim().length === 0}
                                    className="rounded-md bg-cz-accent px-2 py-1 text-[11px] text-white disabled:opacity-60"
                                  >
                                    Save
                                  </button>
                                  <button
                                    onClick={() => clearEditDraft(reply.id)}
                                    className="rounded-md border border-cz-border px-2 py-1 text-[11px] text-cz-text-muted hover:bg-cz-surface-hover"
                                  >
                                    Cancel
                                  </button>
                                  {canManageReply && (
                                    <button
                                      onClick={() => {
                                        void removeComment(reply.id)
                                      }}
                                      disabled={busyById[reply.id]}
                                      className="ml-auto rounded border border-red-500/30 px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/10 disabled:opacity-60"
                                      title="Delete"
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <p className="whitespace-pre-wrap text-xs text-cz-text">{reply.body}</p>
                            )}

                            {canManageReply && !replyEditing && (
                              <div className="mt-2 flex items-center gap-2">
                                <button
                                  onClick={() => {
                                    setEditById((prev) => ({ ...prev, [reply.id]: reply.body }))
                                    setEditFocusId(reply.id)
                                  }}
                                  className="rounded border border-cz-border px-2 py-0.5 text-[11px] text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => {
                                    void removeComment(reply.id)
                                  }}
                                  disabled={busyById[reply.id]}
                                  className="ml-auto rounded border border-red-500/30 px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/10 disabled:opacity-60"
                                  title="Delete"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {canComment && Object.prototype.hasOwnProperty.call(replyById, comment.id) && (
                    <div className="mt-2 space-y-2 rounded border border-cz-border bg-cz-surface p-2">
                      <textarea
                        data-cz-comment-input="true"
                        ref={(node) => {
                          replyInputByIdRef.current[comment.id] = node
                        }}
                        value={replyById[comment.id] ?? ''}
                        onChange={(e) => setReplyById((prev) => ({ ...prev, [comment.id]: e.target.value }))}
                        onKeyDown={(event) => {
                          if (isSubmitShortcut(event)) {
                            event.preventDefault()
                            void submitReply(comment)
                            return
                          }
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            clearReplyDraft(comment.id)
                          }
                        }}
                        className="h-16 w-full resize-none rounded-md border border-cz-border bg-cz-bg px-2 py-1.5 text-xs text-cz-text outline-none focus:border-cz-accent"
                        placeholder="Write a reply"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            void submitReply(comment)
                          }}
                          disabled={busyById[comment.id] || (replyById[comment.id] ?? '').trim().length === 0}
                          className="rounded-md bg-cz-accent px-2 py-1 text-[11px] text-white disabled:opacity-60"
                        >
                          Reply
                        </button>
                        <button
                          onClick={() => {
                            clearReplyDraft(comment.id)
                          }}
                          className="rounded-md border border-cz-border px-2 py-1 text-[11px] text-cz-text-muted hover:bg-cz-surface-hover"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
