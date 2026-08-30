import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import type * as Y from "yjs";
import { evaluateUtf8Limit, formatBinarySize } from "@/utils/text-size";

interface TextSizeStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => Record<string, number>;
}

function createTextSizeStore(
  ydoc: Y.Doc,
  visibleTextFilePaths: string[],
  maxTextFileSizeBytes: number | "unlimited",
): TextSizeStore {
  let snapshot: Record<string, number> = {};
  let dirty = true;
  const listeners = new Set<() => void>();

  const compute = (): Record<string, number> => {
    if (maxTextFileSizeBytes === "unlimited") {
      return {};
    }
    const next: Record<string, number> = {};
    for (const filePath of visibleTextFilePaths) {
      const text = ydoc.getText(`file:${filePath}`);
      next[filePath] = evaluateUtf8Limit(
        text.length,
        maxTextFileSizeBytes,
        () => text.toString(),
      ).sizeBytes;
    }
    return next;
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      // An edit may land between the render-time snapshot read and this
      // subscription; recompute on the post-subscribe consistency check.
      dirty = true;
      const observed: Array<{ text: Y.Text; observer: () => void }> = [];
      if (maxTextFileSizeBytes !== "unlimited") {
        for (const filePath of visibleTextFilePaths) {
          const text = ydoc.getText(`file:${filePath}`);
          const observer = () => {
            dirty = true;
            for (const l of [...listeners]) l();
          };
          text.observe(observer);
          observed.push({ text, observer });
        }
      }
      return () => {
        listeners.delete(listener);
        for (const { text, observer } of observed) {
          text.unobserve(observer);
        }
      };
    },
    getSnapshot() {
      if (dirty) {
        const next = compute();
        // Preserve identity when nothing changed so consumers don't re-render.
        const prevKeys = Object.keys(snapshot);
        const nextKeys = Object.keys(next);
        const unchanged =
          prevKeys.length === nextKeys.length &&
          nextKeys.every((key) => snapshot[key] === next[key]);
        if (!unchanged) {
          snapshot = next;
        }
        dirty = false;
      }
      return snapshot;
    },
  };
}

interface UseTextFileSizesOptions {
  ydoc: Y.Doc;
  /** Text files currently visible in some pane; only these are tracked. */
  visibleTextFilePaths: string[];
  maxTextFileSizeBytes: number | "unlimited";
  onPopupAlert: (message: string, title?: string) => void;
}

export interface TextFileSizes {
  resolveTextFileSizeBytes: (filePath: string) => number;
  handleTextLimitExceeded: (input: {
    filePath: string;
    sizeBytes: number;
    limitBytes: number;
  }) => void;
}

/**
 * Tracks UTF-8 byte sizes of the visible text files as an external store over
 * their Y.Text instances, so size-limit gating can read fresh values without
 * effect-driven state mirroring.
 */
export function useTextFileSizes({
  ydoc,
  visibleTextFilePaths,
  maxTextFileSizeBytes,
  onPopupAlert,
}: UseTextFileSizesOptions): TextFileSizes {
  const lastTextLimitPopupAtRef = useRef(0);

  const sizeStore = useMemo(
    () => createTextSizeStore(ydoc, visibleTextFilePaths, maxTextFileSizeBytes),
    [ydoc, visibleTextFilePaths, maxTextFileSizeBytes],
  );

  const textByteSizeByPath = useSyncExternalStore(
    sizeStore.subscribe,
    sizeStore.getSnapshot,
  );

  const resolveTextFileSizeBytes = useCallback(
    (filePath: string): number => {
      const cached = textByteSizeByPath[filePath];
      if (typeof cached === "number") {
        return cached;
      }

      if (maxTextFileSizeBytes === "unlimited") {
        return 0;
      }

      const text = ydoc.getText(`file:${filePath}`);
      return evaluateUtf8Limit(text.length, maxTextFileSizeBytes, () =>
        text.toString(),
      ).sizeBytes;
    },
    [textByteSizeByPath, maxTextFileSizeBytes, ydoc],
  );

  const handleTextLimitExceeded = useCallback(
    (input: { filePath: string; sizeBytes: number; limitBytes: number }) => {
      const now = Date.now();
      if (now - lastTextLimitPopupAtRef.current < 750) {
        return;
      }
      lastTextLimitPopupAtRef.current = now;

      onPopupAlert(
        `Cannot apply edit to "${input.filePath}" because it would exceed the ${formatBinarySize(input.limitBytes)} text file limit (attempted size: ~${formatBinarySize(input.sizeBytes)}).`,
        "Text File Limit Reached",
      );
    },
    [onPopupAlert],
  );

  return { resolveTextFileSizeBytes, handleTextLimitExceeded };
}
