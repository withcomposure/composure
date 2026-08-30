import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import type { ActiveCollaborator, ConnectionState } from "@/types";
import { hasAwarenessCursor } from "@/utils/page-utils";
import { collaborationWsUrl } from "@/utils/api-routing";
import { createHocuspocusProviderStore } from "@/utils/hocuspocus-provider-store";
import { shouldResetWorkspaceForProjectChange } from "@/editor/workspace-state";

function chatDocumentName(projectId: string): string {
  return `${projectId}:chat`;
}

interface ProviderSnapshot {
  provider: HocuspocusProvider | null;
  connectionState: ConnectionState;
}

const connectingSnapshot: ProviderSnapshot = {
  provider: null,
  connectionState: "connecting",
};

const disconnectedSnapshot: ProviderSnapshot = {
  provider: null,
  connectionState: "disconnected",
};

interface UseCollabSessionOptions {
  projectId: string;
  shareToken?: string;
  canOpenChat: boolean;
  /** Called when the server signals that project history changed. */
  onHistoryUpdated: () => void;
}

export interface CollabSession {
  ydoc: Y.Doc;
  chatYdoc: Y.Doc;
  provider: HocuspocusProvider | null;
  chatProvider: HocuspocusProvider | null;
  connectionState: ConnectionState;
  chatConnectionState: ConnectionState;
  initialSyncDone: boolean;
  activeEditors: ActiveCollaborator[];
  focusCollaboratorRequest: { clientId: number; revision: number } | null;
  focusCollaborator: (clientId: number) => void;
}

export function useCollabSession({
  projectId,
  shareToken,
  canOpenChat,
  onHistoryUpdated,
}: UseCollabSessionOptions): CollabSession {
  const [ydoc, setYdoc] = useState(() => new Y.Doc());
  const [chatYdoc, setChatYdoc] = useState(() => new Y.Doc());
  const [initialSyncDone, setInitialSyncDone] = useState(false);
  const [activeEditors, setActiveEditors] = useState<ActiveCollaborator[]>([]);
  const [focusCollaboratorRequest, setFocusCollaboratorRequest] = useState<{
    clientId: number;
    revision: number;
  } | null>(null);

  const onHistoryUpdatedRef = useRef(onHistoryUpdated);

  useEffect(() => {
    onHistoryUpdatedRef.current = onHistoryUpdated;
  }, [onHistoryUpdated]);

  // The docs and the sync flag reset during render on a project change (Fast
  // Refresh re-runs with the same ID and must keep the current docs). Doing
  // this synchronously means no render pass ever pairs the new project's
  // metadata with the previous project's sync/file state, and the provider
  // store below never sees a (projectId, ydoc) mismatch.
  const [prevDocsProjectId, setPrevDocsProjectId] = useState(projectId);
  if (shouldResetWorkspaceForProjectChange(prevDocsProjectId, projectId)) {
    setPrevDocsProjectId(projectId);
    setYdoc(() => new Y.Doc());
    setChatYdoc(() => new Y.Doc());
    setInitialSyncDone(false);
  }

  const providerStore = useMemo(
    () =>
      createHocuspocusProviderStore<ProviderSnapshot>((update) => {
        const wsUrl = collaborationWsUrl(shareToken);

        console.info(
          `[app] creating provider projectId=${projectId} wsUrl=${wsUrl}`,
        );

        const prov = new HocuspocusProvider({
          url: wsUrl,
          name: projectId,
          document: ydoc,
          onOpen: () => console.info(`[app] ws-open projectId=${projectId}`),
          onClose: ({ event }) => {
            console.info(
              `[app] ws-close projectId=${projectId} code=${event.code}`,
            );
            update({ connectionState: "disconnected" });
          },
          onConnect: () => {
            console.info(`[app] provider-connected projectId=${projectId}`);
            update({ connectionState: "connected" });
          },
          onDisconnect: () => {
            console.info(`[app] provider-disconnected projectId=${projectId}`);
            update({ connectionState: "disconnected" });
          },
          onAuthenticated: () =>
            console.info(`[app] provider-authenticated projectId=${projectId}`),
          onAuthenticationFailed: ({ reason }: { reason: string }) => {
            console.error(
              `[app] provider-auth-FAILED projectId=${projectId} reason=${reason}`,
            );
            update({ connectionState: "disconnected" });
          },
          onSynced: ({ state }) => {
            console.info(
              `[app] provider-synced projectId=${projectId} state=${state}`,
            );
            if (state) setInitialSyncDone(true);
          },
          onStatus: ({ status }) => {
            console.info(
              `[app] provider-status projectId=${projectId} status=${status}`,
            );
            if (
              status === "connected" ||
              status === "connecting" ||
              status === "disconnected"
            ) {
              update({ connectionState: status });
            }
          },
          onMessage: (payload: unknown) => {
            const event =
              (payload as { event?: MessageEvent }).event ??
              (payload as MessageEvent);
            const bytes =
              typeof event.data === "string"
                ? event.data.length
                : event.data instanceof ArrayBuffer
                  ? event.data.byteLength
                  : 0;
            console.info(
              `[app] provider-incoming-message projectId=${projectId} bytes=${bytes}`,
            );
          },
        });

        return prov;
      }, connectingSnapshot),
    [projectId, shareToken, ydoc],
  );

  const { provider, connectionState } = useSyncExternalStore(
    providerStore.subscribe,
    providerStore.getSnapshot,
  );

  useEffect(() => {
    if (!provider) return;

    const handleStateless = ({ payload }: { payload: string }) => {
      try {
        const msg = JSON.parse(payload);
        if (msg.type === "history-updated") {
          onHistoryUpdatedRef.current();
        }
      } catch {
        /* ignore malformed payloads */
      }
    };
    provider.on("stateless", handleStateless);

    return () => {
      provider.off("stateless", handleStateless);
    };
  }, [provider]);

  const chatProviderStore = useMemo(
    () =>
      createHocuspocusProviderStore<ProviderSnapshot>(
        canOpenChat
          ? (update) => {
              const wsUrl = collaborationWsUrl(shareToken);
              const documentName = chatDocumentName(projectId);

              console.info(
                `[chat] creating provider projectId=${projectId} document=${documentName} wsUrl=${wsUrl}`,
              );

              return new HocuspocusProvider({
                url: wsUrl,
                name: documentName,
                document: chatYdoc,
                onConnect: () => {
                  console.info(
                    `[chat] provider-connected projectId=${projectId}`,
                  );
                  update({ connectionState: "connected" });
                },
                onDisconnect: () => {
                  console.info(
                    `[chat] provider-disconnected projectId=${projectId}`,
                  );
                  update({ connectionState: "disconnected" });
                },
                onAuthenticationFailed: ({ reason }: { reason: string }) => {
                  console.error(
                    `[chat] provider-auth-FAILED projectId=${projectId} reason=${reason}`,
                  );
                  update({ connectionState: "disconnected" });
                },
                onStatus: ({ status }) => {
                  if (
                    status === "connected" ||
                    status === "connecting" ||
                    status === "disconnected"
                  ) {
                    update({ connectionState: status });
                  }
                },
              });
            }
          : null,
        connectingSnapshot,
        disconnectedSnapshot,
      ),
    [canOpenChat, chatYdoc, projectId, shareToken],
  );

  const { provider: chatProvider, connectionState: chatConnectionState } =
    useSyncExternalStore(
      chatProviderStore.subscribe,
      chatProviderStore.getSnapshot,
    );

  useEffect(() => {
    return () => {
      ydoc.destroy();
    };
  }, [ydoc]);

  useEffect(() => {
    return () => {
      chatYdoc.destroy();
    };
  }, [chatYdoc]);

  useEffect(() => {
    const onDocUpdate = (update: Uint8Array, origin: unknown) => {
      const originLabel =
        origin === provider
          ? "provider(remote)"
          : origin === null || origin === undefined
            ? "unknown"
            : typeof origin === "string"
              ? origin
              : ((origin as { constructor?: { name?: string } })?.constructor
                  ?.name ?? String(origin));
      console.info(
        `[app] ydoc-update bytes=${update.length} origin=${originLabel} sharedTypes=${ydoc.share.size}`,
      );
    };

    ydoc.on("update", onDocUpdate);
    return () => {
      ydoc.off("update", onDocUpdate);
    };
  }, [ydoc, provider]);

  useEffect(() => {
    const awareness = provider?.awareness;
    if (!awareness) return;

    const update = () => {
      const states = awareness.getStates();
      const localId = awareness.clientID;
      const seen = new Map<string, ActiveCollaborator>();

      states.forEach((state: Record<string, unknown>, clientId: number) => {
        if (clientId === localId) return;
        const user = state.user as
          | {
              name?: string;
              color?: string;
              userId?: string;
              guestId?: string;
              profileImageUrl?: string;
            }
          | undefined;
        if (!user) return;
        const key = user.userId ?? user.guestId ?? `c:${clientId}`;
        const next = {
          clientId,
          name: user.name ?? "Guest",
          color: user.color ?? "#6366f1",
          userId: user.userId ?? null,
          profileImageUrl: user.profileImageUrl ?? null,
          hasCursor: hasAwarenessCursor((state as { cursor?: unknown }).cursor),
        };

        const existing = seen.get(key);
        if (!existing || (!existing.hasCursor && next.hasCursor)) {
          seen.set(key, next);
        }
      });

      // Awareness fires on every remote cursor move; only re-render when the
      // collaborator list itself actually changed.
      setActiveEditors((prev) => {
        const next = Array.from(seen.values());
        const unchanged =
          prev.length === next.length &&
          prev.every((p, i) => {
            const n = next[i];
            return (
              p.clientId === n.clientId &&
              p.name === n.name &&
              p.color === n.color &&
              p.userId === n.userId &&
              p.profileImageUrl === n.profileImageUrl &&
              p.hasCursor === n.hasCursor
            );
          });
        return unchanged ? prev : next;
      });
    };

    awareness.on("change", update);
    update();

    return () => {
      awareness.off("change", update);
    };
  }, [provider]);

  const focusCollaborator = useCallback((clientId: number) => {
    setFocusCollaboratorRequest((prev) => ({
      clientId,
      revision: prev ? prev.revision + 1 : 1,
    }));
  }, []);

  return {
    ydoc,
    chatYdoc,
    provider,
    chatProvider,
    connectionState,
    chatConnectionState,
    initialSyncDone,
    activeEditors,
    focusCollaboratorRequest,
    focusCollaborator,
  };
}
