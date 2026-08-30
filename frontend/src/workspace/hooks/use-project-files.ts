import { useEffect, useMemo, useState } from "react";
import type * as Y from "yjs";
import {
  parseFileMetadata,
  withFileId,
  type FileMetadata,
} from "@/utils/file-metadata";

interface UseProjectFilesOptions {
  ydoc: Y.Doc;
  initialSyncDone: boolean;
}

export interface ProjectFiles {
  fileMap: Y.Map<string>;
  textFilePaths: Set<string>;
  allFilePaths: Set<string>;
  assetInfoByPath: Record<string, { storageKey?: string; mimeType?: string }>;
  availableFilePathList: string[];
}

/**
 * Derives the file listing (text files, all files, asset info) from the Yjs
 * file map, normalizes stored metadata, and initializes Y.Text instances for
 * legacy documents that stored content directly in the map.
 */
export function useProjectFiles({
  ydoc,
  initialSyncDone,
}: UseProjectFilesOptions): ProjectFiles {
  const fileMap = useMemo(() => ydoc.getMap<string>("files"), [ydoc]);
  const [textFilePaths, setTextFilePaths] = useState<Set<string>>(new Set());
  const [allFilePaths, setAllFilePaths] = useState<Set<string>>(new Set());
  const [assetInfoByPath, setAssetInfoByPath] = useState<
    Record<string, { storageKey?: string; mimeType?: string }>
  >({});

  const availableFilePathList = useMemo(
    () =>
      Array.from(allFilePaths).sort((left, right) => left.localeCompare(right)),
    [allFilePaths],
  );

  useEffect(() => {
    const update = () => {
      const nextTextPaths = new Set<string>();
      const nextAllPaths = new Set<string>();
      const nextAssetInfo: Record<
        string,
        { storageKey?: string; mimeType?: string }
      > = {};
      fileMap.forEach((raw: string, filePath: string) => {
        const meta = parseFileMetadata(raw);
        if (meta.type !== "folder") {
          nextAllPaths.add(filePath);
        }
        if (meta.type === "text") {
          nextTextPaths.add(filePath);
        }
        if (meta.type === "asset") {
          nextAssetInfo[filePath] = {
            storageKey: meta.storageKey,
            mimeType: meta.mimeType,
          };
        }
      });
      setTextFilePaths(nextTextPaths);
      setAllFilePaths(nextAllPaths);
      setAssetInfoByPath(nextAssetInfo);
    };

    update();
    fileMap.observe(update);
    return () => fileMap.unobserve(update);
  }, [fileMap]);

  useEffect(() => {
    if (!initialSyncDone) return;

    const updates: Array<{ filePath: string; value: string }> = [];
    fileMap.forEach((raw: string, filePath: string) => {
      const normalized = JSON.stringify(
        withFileId(parseFileMetadata(raw)) as FileMetadata,
      );
      if (raw !== normalized) {
        updates.push({ filePath, value: normalized });
      }
    });

    if (updates.length === 0) return;

    ydoc.transact(() => {
      for (const update of updates) {
        fileMap.set(update.filePath, update.value);
      }
    }, "composure:normalize-file-metadata");
  }, [fileMap, ydoc, initialSyncDone]);

  useEffect(() => {
    if (!initialSyncDone) return;

    ydoc.transact(() => {
      fileMap.forEach((mapContent, filePath) => {
        const metadata = parseFileMetadata(mapContent);
        if (metadata.type !== "text") {
          return;
        }

        const key = `file:${filePath}`;
        if (!ydoc.share.has(key)) {
          const text = ydoc.getText(key);
          let legacyContent = "";
          try {
            const parsed = JSON.parse(mapContent);
            if (!(parsed && typeof parsed === "object" && "type" in parsed)) {
              legacyContent = mapContent;
            }
          } catch {
            legacyContent = mapContent;
          }

          if (legacyContent) {
            text.insert(0, legacyContent);
          }
          console.info(
            `[app] initialized-ytext key=${key} fromMapContent=${legacyContent.length}`,
          );
        }
      });
    }, "composure:sync-file-map-to-texts");
  }, [fileMap, ydoc, initialSyncDone]);

  return {
    fileMap,
    textFilePaths,
    allFilePaths,
    assetInfoByPath,
    availableFilePathList,
  };
}
