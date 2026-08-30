import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import type { DiffWorkspaceTab } from "@/types";
import { apiFetch, apiUrl, getErrorMessage } from "@/utils/fetch";
import { uint8ArrayToBase64 } from "@/utils/page-utils";

function pdfPreviewStorageKey(projectId: string): string {
  return `composure:pdfUrl:${projectId}`;
}

interface UseCompileOptions {
  projectId: string;
  shareToken?: string;
  shareHeaders: Record<string, string>;
  ydoc: Y.Doc;
  provider: HocuspocusProvider | null;
  canEdit: boolean;
  initialSyncDone: boolean;
  autoCompileDefault: boolean;
  autoCompileTimeoutSeconds: number;
  autoSaveOnCompile: boolean;
  autoSaveOnExport: boolean;
  activeDiffTab: DiffWorkspaceTab | null;
  activeFilePath: string;
  /** Root file used by "compile current file"; empty when unavailable. */
  compileCurrentFile: string;
  /** Root file used by a default compile; empty when unavailable. */
  compileDefaultRootFile: string;
  autoCompileScheduleEligible: boolean;
  onHistoryChanged: () => void;
  onPopupAlert: (message: string, title?: string) => void;
}

export interface CompileController {
  pdfUrl: string | null;
  compileError: string | null;
  compiling: boolean;
  clearingCompileOutput: boolean;
  autoCompileEnabled: boolean;
  setAutoCompileEnabled: (enabled: boolean) => void;
  exporting: boolean;
  saving: boolean;
  handleSave: () => Promise<void>;
  handleCompile: (options?: {
    isAutoCompile?: boolean;
    target?: "default" | "current";
  }) => Promise<void>;
  handleCompileCurrentFile: () => void;
  canCompileCurrentFile: boolean;
  handleExport: (format: string) => Promise<void>;
  handleClearCompileOutput: () => Promise<void>;
}

export function useCompile({
  projectId,
  shareToken,
  shareHeaders,
  ydoc,
  provider,
  canEdit,
  initialSyncDone,
  autoCompileDefault,
  autoCompileTimeoutSeconds,
  autoSaveOnCompile,
  autoSaveOnExport,
  activeDiffTab,
  activeFilePath,
  compileCurrentFile,
  compileDefaultRootFile,
  autoCompileScheduleEligible,
  onHistoryChanged,
  onPopupAlert,
}: UseCompileOptions): CompileController {
  const [pdfUrl, setPdfUrl] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(pdfPreviewStorageKey(projectId));
    } catch {
      return null;
    }
  });
  const [compileError, setCompileError] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [clearingCompileOutput, setClearingCompileOutput] = useState(false);
  const [autoCompileEnabled, setAutoCompileEnabled] =
    useState(autoCompileDefault);
  const [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false);

  const inFlightSaveCountRef = useRef(0);
  const lastAutoCompiledRevisionRef = useRef(0);
  const autoCompileRevisionRef = useRef(0);
  const autoCompileTimerRef = useRef<number | null>(null);
  const runAutoCompileRef = useRef<() => void>(() => {});

  // The auto-compile toggle follows the user preference whenever the project
  // or the preference itself changes (previously an effect).
  const [prevAutoCompileKey, setPrevAutoCompileKey] = useState({
    projectId,
    autoCompileDefault,
  });
  if (
    prevAutoCompileKey.projectId !== projectId ||
    prevAutoCompileKey.autoCompileDefault !== autoCompileDefault
  ) {
    setPrevAutoCompileKey({ projectId, autoCompileDefault });
    setAutoCompileEnabled(autoCompileDefault);
  }

  const beginSaving = useCallback(() => {
    inFlightSaveCountRef.current += 1;
    setSaving(true);
  }, []);

  const endSaving = useCallback(() => {
    inFlightSaveCountRef.current = Math.max(
      0,
      inFlightSaveCountRef.current - 1,
    );
    if (inFlightSaveCountRef.current === 0) {
      setSaving(false);
    }
  }, []);

  const persistSnapshot = useCallback(
    async (reason: "manual" | "autosave" | "compile") => {
      const documentUpdateBase64 = uint8ArrayToBase64(
        Y.encodeStateAsUpdate(ydoc),
      );

      if (!canEdit) {
        throw new Error("You do not have edit permissions for this project");
      }

      const res = await apiFetch(`/save/${projectId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...shareHeaders,
        },
        body: JSON.stringify({ documentUpdateBase64, reason }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(String(err.error ?? "Save failed"));
      }

      const body = await res.json();
      console.info(
        `[app] save-success projectId=${projectId} bytes=${String(body.bytes ?? "n/a")} reason=${reason}`,
      );
    },
    [projectId, ydoc, canEdit, shareHeaders],
  );

  const handleSave = useCallback(async () => {
    beginSaving();
    try {
      await persistSnapshot("manual");
      onHistoryChanged();
    } catch (err) {
      console.error(`[app] manual-save-failed ${String(err)}`);
      onPopupAlert(getErrorMessage(err), "Save failed");
    } finally {
      endSaving();
    }
  }, [persistSnapshot, beginSaving, endSaving, onHistoryChanged, onPopupAlert]);

  const clearCompileOutputLocally = useCallback(() => {
    setPdfUrl((prev) => {
      if (prev?.startsWith("blob:")) {
        URL.revokeObjectURL(prev);
      }
      return null;
    });

    try {
      sessionStorage.removeItem(pdfPreviewStorageKey(projectId));
    } catch {
      // Ignore storage failures in private mode or constrained environments.
    }
  }, [projectId]);

  const handleClearCompileOutput = useCallback(async () => {
    if (clearingCompileOutput) {
      return;
    }

    setClearingCompileOutput(true);
    try {
      const res = await apiFetch(
        `/projects/${encodeURIComponent(projectId)}/preview.pdf`,
        {
          method: "DELETE",
          headers: shareHeaders,
        },
      );

      if (!res.ok) {
        const err = await res.json().catch(async () => {
          const fallback = await res.text().catch(() => "");
          return { error: fallback || "Failed to clear compiled output" };
        });
        throw new Error(String(err.error ?? "Failed to clear compiled output"));
      }

      clearCompileOutputLocally();
      setCompileError(null);
    } catch (err) {
      onPopupAlert(getErrorMessage(err), "Clear output failed");
    } finally {
      setClearingCompileOutput(false);
    }
  }, [
    clearingCompileOutput,
    projectId,
    shareHeaders,
    clearCompileOutputLocally,
    onPopupAlert,
  ]);

  const handleCompile = useCallback(
    async (options?: {
      isAutoCompile?: boolean;
      target?: "default" | "current";
    }) => {
      const isAutoCompile = options?.isAutoCompile ?? false;
      const target = options?.target ?? "default";

      // Cancel any pending auto-compile timer by marking the current revision as handled.
      lastAutoCompiledRevisionRef.current = autoCompileRevisionRef.current;

      const isDiffCompile = activeDiffTab != null && target === "default";
      const rootFile = isDiffCompile
        ? activeDiffTab.filePath
        : target === "current"
          ? compileCurrentFile
          : compileDefaultRootFile;

      if (!rootFile) {
        setCompileError(
          target === "current"
            ? "Open or select a file before compiling."
            : "Create or select a file before compiling.",
        );
        return;
      }

      setCompiling(true);
      setCompileError(null);
      try {
        if (!isDiffCompile) {
          const shouldSave = autoSaveOnCompile && !isAutoCompile;
          if (shouldSave) {
            await persistSnapshot("compile").catch((err) => {
              console.warn(`[app] compile-pre-save-failed ${String(err)}`);
            });
          }
        }

        const compileBody: Record<string, unknown> = {
          projectId,
          rootFile,
          responseMode: "metadata",
        };

        if (isDiffCompile) {
          compileBody.commitSha = activeDiffTab.commitSha;
        } else {
          compileBody.documentUpdateBase64 = uint8ArrayToBase64(
            Y.encodeStateAsUpdate(ydoc),
          );
        }

        console.info(
          `[app] compile-request projectId=${projectId} rootFile=${rootFile}${isDiffCompile ? ` commitSha=${activeDiffTab.commitSha}` : ""}`,
        );
        const res = await apiFetch("/compile", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...shareHeaders,
          },
          body: JSON.stringify(compileBody),
        });
        if (!res.ok) {
          const err = await res.json().catch(async () => {
            const fallback = await res.text().catch(() => "");
            return { error: fallback || "Compilation failed" };
          });
          console.warn(
            `[app] compile-failed status=${res.status} error=${String(err.error ?? "unknown")}`,
          );
          setCompileError(err.error || "Compilation failed");
          return;
        }
        const contentType = res.headers.get("content-type") ?? "";
        const compileIdHeader = res.headers.get("x-compile-id") ?? undefined;
        let compileId = compileIdHeader;
        if (contentType.includes("application/json")) {
          const body = (await res
            .json()
            .catch(() => ({}) as { compileId?: string })) as {
            compileId?: string;
          };
          if (typeof body.compileId === "string" && body.compileId.length > 0) {
            compileId = body.compileId;
          }
        }

        const previewParams = new URLSearchParams();
        previewParams.set("v", compileId ?? String(Date.now()));
        if (shareToken) {
          previewParams.set("shareToken", shareToken);
        }
        const url = apiUrl(
          `/projects/${encodeURIComponent(projectId)}/preview.pdf?${previewParams.toString()}`,
        );
        console.info(
          `[app] compile-success compileId=${String(compileId ?? "none")} previewUrl=${url}`,
        );
        setPdfUrl((prev) => {
          if (prev?.startsWith("blob:")) {
            URL.revokeObjectURL(prev);
          }
          return url;
        });
        try {
          sessionStorage.setItem(pdfPreviewStorageKey(projectId), url);
        } catch {
          /* quota */
        }
        onHistoryChanged();
      } catch (e: unknown) {
        console.error(`[app] compile-network-error ${String(e)}`);
        setCompileError(e instanceof Error ? e.message : "Network error");
      } finally {
        setCompiling(false);
      }
    },
    [
      projectId,
      compileDefaultRootFile,
      activeDiffTab,
      ydoc,
      persistSnapshot,
      shareHeaders,
      shareToken,
      autoSaveOnCompile,
      compileCurrentFile,
      onHistoryChanged,
    ],
  );

  const handleCompileCurrentFile = useCallback(() => {
    void handleCompile({ target: "current" });
  }, [handleCompile]);

  const canCompileCurrentFile = useMemo(
    () => compileCurrentFile.length > 0,
    [compileCurrentFile],
  );

  const handleExport = useCallback(
    async (format: string) => {
      const rootFile = activeDiffTab?.filePath ?? activeFilePath;
      if (!rootFile) return;
      setExporting(true);
      try {
        if (autoSaveOnExport && !activeDiffTab && canEdit) {
          await persistSnapshot("compile").catch((err) => {
            console.warn(`[app] export-pre-save-failed ${String(err)}`);
          });
        }
        const exportBody: Record<string, unknown> = { format, rootFile };
        if (activeDiffTab) {
          exportBody.commitSha = activeDiffTab.commitSha;
        }
        const res = await apiFetch(
          `/export/${encodeURIComponent(projectId)}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...shareHeaders,
            },
            body: JSON.stringify(exportBody),
          },
        );
        if (!res.ok) {
          const err = await res
            .json()
            .catch(() => ({ error: "Export failed" }));
          onPopupAlert(err.error || "Export failed", "Export Error");
          return;
        }
        const blob = await res.blob();
        const disposition = res.headers.get("content-disposition") ?? "";
        const filenameMatch = /filename="?([^";\n]+)"?/.exec(disposition);
        const filename = filenameMatch?.[1] ?? `export.${format}`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        if (autoSaveOnExport) onHistoryChanged();
      } catch (e: unknown) {
        onPopupAlert(
          e instanceof Error ? e.message : "Export failed",
          "Export Error",
        );
      } finally {
        setExporting(false);
      }
    },
    [
      projectId,
      activeDiffTab,
      activeFilePath,
      shareHeaders,
      onPopupAlert,
      autoSaveOnExport,
      canEdit,
      persistSnapshot,
      onHistoryChanged,
    ],
  );

  // Auto-compile scheduling lives entirely in refs and a timer: bumping React
  // state per keystroke re-rendered the whole workspace tree.
  useEffect(() => {
    runAutoCompileRef.current = () => {
      if (
        !autoCompileEnabled ||
        !canEdit ||
        !initialSyncDone ||
        !autoCompileScheduleEligible
      )
        return;
      // While a compile runs, leave the pending revision in place; the effect
      // watching `compiling` below reschedules once it finishes.
      if (compiling) return;
      if (autoCompileRevisionRef.current <= lastAutoCompiledRevisionRef.current)
        return;
      lastAutoCompiledRevisionRef.current = autoCompileRevisionRef.current;
      void handleCompile({ isAutoCompile: true });
    };
  });

  const scheduleAutoCompile = useCallback(() => {
    if (autoCompileTimerRef.current !== null) {
      window.clearTimeout(autoCompileTimerRef.current);
    }
    autoCompileTimerRef.current = window.setTimeout(() => {
      autoCompileTimerRef.current = null;
      runAutoCompileRef.current();
    }, autoCompileTimeoutSeconds * 1000);
  }, [autoCompileTimeoutSeconds]);

  useEffect(() => {
    const onDocUpdate = (_update: Uint8Array, origin: unknown) => {
      if (
        !autoCompileEnabled ||
        !canEdit ||
        !initialSyncDone ||
        !autoCompileScheduleEligible
      )
        return;
      if (origin === provider) return;
      if (typeof origin === "string" && origin.startsWith("composure:")) return;
      autoCompileRevisionRef.current += 1;
      scheduleAutoCompile();
    };

    ydoc.on("update", onDocUpdate);
    // Changes that arrived while this effect was unsubscribed still need a run.
    if (autoCompileRevisionRef.current > lastAutoCompiledRevisionRef.current) {
      scheduleAutoCompile();
    }
    return () => {
      ydoc.off("update", onDocUpdate);
      if (autoCompileTimerRef.current !== null) {
        window.clearTimeout(autoCompileTimerRef.current);
        autoCompileTimerRef.current = null;
      }
    };
  }, [
    ydoc,
    provider,
    autoCompileEnabled,
    canEdit,
    initialSyncDone,
    autoCompileScheduleEligible,
    scheduleAutoCompile,
  ]);

  // When a compile finishes, edits typed in the meantime get a fresh debounce
  // window (matching the previous state-driven behavior).
  useEffect(() => {
    if (compiling) return;
    if (autoCompileRevisionRef.current > lastAutoCompiledRevisionRef.current) {
      scheduleAutoCompile();
    }
  }, [compiling, scheduleAutoCompile]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.shiftKey || event.altKey) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-cz-comment-input="true"]')) {
        return;
      }

      if (target?.closest("[data-cz-project-title-edit]")) {
        return;
      }

      const isFormInput =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        Boolean(target?.isContentEditable);

      if (isFormInput && !target?.closest(".cm-editor")) {
        return;
      }

      const isCtrlEnter =
        event.key === "Enter" && event.ctrlKey && !event.metaKey;
      const isCompileSave =
        event.key.toLowerCase() === "s" && (event.ctrlKey || event.metaKey);
      if (!isCtrlEnter && !isCompileSave) {
        return;
      }

      event.preventDefault();
      void handleCompile();
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, [handleCompile]);

  return {
    pdfUrl,
    compileError,
    compiling,
    clearingCompileOutput,
    autoCompileEnabled,
    setAutoCompileEnabled,
    exporting,
    saving,
    handleSave,
    handleCompile,
    handleCompileCurrentFile,
    canCompileCurrentFile,
    handleExport,
    handleClearCompileOutput,
  };
}
