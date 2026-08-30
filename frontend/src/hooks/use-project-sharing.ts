import { useCallback, useEffect, useState } from "react";
import type {
  AccessPerson,
  ProjectAccessResponse,
  ShareRole,
} from "@/types";
import { apiFetch, getErrorMessage } from "@/utils/fetch";
import { makeProjectUrl } from "@/utils/route";
import { shouldResetWorkspaceForProjectChange } from "@/editor/workspace-state";

interface UseProjectSharingOptions {
  projectId: string;
  shareToken?: string;
  shareHeaders: Record<string, string>;
  onPopupAlert: (message: string, title?: string) => void;
  /**
   * Clamp roles to what this surface supports (the whiteboard only offers
   * view/edit). Must be referentially stable (module-level function).
   */
  normalizeRole?: (role: ShareRole) => ShareRole;
}

export interface ProjectSharing {
  peopleWithAccess: AccessPerson[];
  linkEnabled: boolean;
  linkRole: ShareRole;
  accessRole: ShareRole | "owner" | null;
  canViewChat: boolean;
  maxTextFileSizeBytes: number | "unlimited";
  largeFileThresholdChars: number;
  chatHistoryRetentionDays: number | "unlimited" | "off";
  inviteEmail: string;
  setInviteEmail: (email: string) => void;
  inviteRole: ShareRole;
  setInviteRole: (role: ShareRole) => void;
  inviting: boolean;
  /** Optimistic local update used by the modal's role picker before the PATCH resolves. */
  setLinkRole: (role: ShareRole) => void;
  inviteMember: () => Promise<void>;
  updateMemberRole: (
    memberId: string,
    role: ShareRole | "remove",
  ) => Promise<void>;
  setLinkSharing: (enabled: boolean, role: ShareRole) => Promise<void>;
  invalidateLinkSharing: () => Promise<void>;
  shareUrl: string;
}

const identityRole = (role: ShareRole): ShareRole => role;

export function useProjectSharing({
  projectId,
  shareToken,
  shareHeaders,
  onPopupAlert,
  normalizeRole = identityRole,
}: UseProjectSharingOptions): ProjectSharing {
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRoleState] = useState<ShareRole>("view");
  const [inviting, setInviting] = useState(false);
  const [peopleWithAccess, setPeopleWithAccess] = useState<AccessPerson[]>([]);
  const [linkEnabled, setLinkEnabled] = useState(false);
  const [linkRole, setLinkRole] = useState<ShareRole>("view");
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [accessRole, setAccessRole] = useState<ShareRole | "owner" | null>(
    null,
  );
  const [canViewChat, setCanViewChat] = useState(false);
  const [maxTextFileSizeBytes, setMaxTextFileSizeBytes] = useState<
    number | "unlimited"
  >(5 * 1024 * 1024);
  const [largeFileThresholdChars, setLargeFileThresholdChars] =
    useState(500_000);
  const [chatHistoryRetentionDays, setChatHistoryRetentionDays] = useState<
    number | "unlimited" | "off"
  >("unlimited");

  // Nothing loaded for the previous project may leak across a project
  // change while the fresh /access response is in flight: chat access (as
  // before), and also the people list, link token and role — otherwise the
  // share modal could briefly show the old project's link token and members.
  const [prevProjectId, setPrevProjectId] = useState(projectId);
  if (shouldResetWorkspaceForProjectChange(prevProjectId, projectId)) {
    setPrevProjectId(projectId);
    setCanViewChat(false);
    setChatHistoryRetentionDays("unlimited");
    setPeopleWithAccess([]);
    setLinkEnabled(false);
    setLinkRole("view");
    setLinkToken(null);
    setAccessRole(null);
  }

  const setInviteRole = useCallback(
    (role: ShareRole) => {
      setInviteRoleState(normalizeRole(role));
    },
    [normalizeRole],
  );

  const setLinkRoleNormalized = useCallback(
    (role: ShareRole) => {
      setLinkRole(normalizeRole(role));
    },
    [normalizeRole],
  );

  const loadAccess = useCallback(() => {
    return apiFetch(`/projects/${projectId}/access`, {
      headers: shareHeaders,
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error("Failed to load project access");
        }

        const body = (await res.json()) as ProjectAccessResponse;
        setPeopleWithAccess(body.people);
        setLinkEnabled(body.linkSharing.enabled);
        setLinkRole(
          body.linkSharing.role ? normalizeRole(body.linkSharing.role) : "view",
        );
        setLinkToken(body.linkSharing.token);
        setAccessRole(body.currentRole);
        setCanViewChat(body.canViewChat);
        setMaxTextFileSizeBytes(body.maxTextFileSizeBytes);
        setLargeFileThresholdChars(body.largeFileThresholdChars);
        setChatHistoryRetentionDays(body.chatHistoryRetentionDays);
      })
      .catch((err: unknown) => {
        console.warn(`[app] load-access-failed ${String(err)}`);
      });
  }, [projectId, shareHeaders, normalizeRole]);

  useEffect(() => {
    void loadAccess();
  }, [loadAccess]);

  const inviteMember = useCallback(async () => {
    const email = inviteEmail.trim();
    if (!email) return;

    setInviting(true);
    try {
      const res = await apiFetch(`/projects/${projectId}/members`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...shareHeaders,
        },
        body: JSON.stringify({ email, role: normalizeRole(inviteRole) }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Invite failed" }));
        throw new Error(String(err.error ?? "Invite failed"));
      }

      setInviteEmail("");
      await loadAccess();
    } catch (err) {
      onPopupAlert(getErrorMessage(err), "Invite failed");
    } finally {
      setInviting(false);
    }
  }, [
    inviteEmail,
    inviteRole,
    normalizeRole,
    projectId,
    shareHeaders,
    loadAccess,
    onPopupAlert,
  ]);

  const updateMemberRole = useCallback(
    async (memberId: string, role: ShareRole | "remove") => {
      const encodedMemberId = encodeURIComponent(memberId);
      const res = await apiFetch(
        `/projects/${projectId}/members/${encodedMemberId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...shareHeaders,
          },
          body: JSON.stringify(
            role === "remove"
              ? { remove: true }
              : { role: normalizeRole(role) },
          ),
        },
      );

      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: "Failed to update member" }));
        onPopupAlert(
          String(err.error ?? "Failed to update member"),
          "Update failed",
        );
        return;
      }

      await loadAccess();
    },
    [projectId, shareHeaders, normalizeRole, loadAccess, onPopupAlert],
  );

  const applyLinkSharingResponse = useCallback(
    (body: {
      enabled: boolean;
      role: ShareRole | null;
      token: string | null;
    }) => {
      setLinkEnabled(body.enabled);
      setLinkRole(body.role ? normalizeRole(body.role) : "view");
      setLinkToken(body.token);
    },
    [normalizeRole],
  );

  const setLinkSharing = useCallback(
    async (enabled: boolean, role: ShareRole) => {
      const res = await apiFetch(`/projects/${projectId}/link-sharing`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...shareHeaders,
        },
        body: JSON.stringify({ enabled, role: normalizeRole(role) }),
      });

      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: "Failed to update link sharing" }));
        onPopupAlert(
          String(err.error ?? "Failed to update link sharing"),
          "Update failed",
        );
        return;
      }

      const body = (await res.json()) as {
        enabled: boolean;
        role: ShareRole | null;
        token: string | null;
      };
      applyLinkSharingResponse(body);
    },
    [
      projectId,
      shareHeaders,
      normalizeRole,
      onPopupAlert,
      applyLinkSharingResponse,
    ],
  );

  const invalidateLinkSharing = useCallback(async () => {
    const res = await apiFetch(`/projects/${projectId}/link-sharing`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...shareHeaders,
      },
      body: JSON.stringify({ invalidate: true }),
    });

    if (!res.ok) {
      const err = await res
        .json()
        .catch(() => ({ error: "Failed to rotate link" }));
      onPopupAlert(String(err.error ?? "Failed to rotate link"), "Rotate failed");
      return;
    }

    const body = (await res.json()) as {
      enabled: boolean;
      role: ShareRole | null;
      token: string | null;
    };
    applyLinkSharingResponse(body);
  }, [projectId, shareHeaders, onPopupAlert, applyLinkSharingResponse]);

  const shareUrl = `${window.location.origin}${makeProjectUrl(projectId, linkToken ?? shareToken)}`;

  return {
    peopleWithAccess,
    linkEnabled,
    linkRole,
    accessRole,
    canViewChat,
    maxTextFileSizeBytes,
    largeFileThresholdChars,
    chatHistoryRetentionDays,
    inviteEmail,
    setInviteEmail,
    inviteRole,
    setInviteRole,
    inviting,
    setLinkRole: setLinkRoleNormalized,
    inviteMember,
    updateMemberRole,
    setLinkSharing,
    invalidateLinkSharing,
    shareUrl,
  };
}
