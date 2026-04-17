import { FileQuestion } from "lucide-react";
import { ImageViewer, PdfViewer } from "./CompilePreview";

function getAssetPreviewKind(
  fileName: string,
  mimeType?: string,
): "image" | "pdf" | "none" {
  if (mimeType) {
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType === "application/pdf") return "pdf";
  }
  const ext = fileName.split(".").pop()?.toLowerCase();
  const imageExts = ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"];
  if (ext && imageExts.includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  return "none";
}

function assetUrl(projectId: string, storageKey: string, shareToken?: string): string {
  const base = `/assets/${encodeURIComponent(projectId)}/${encodeURIComponent(storageKey)}`;
  if (shareToken) return `${base}?share=${encodeURIComponent(shareToken)}`;
  return base;
}

function sidebarName(path: string): string {
  const leaf = path.split("/").pop()?.trim();
  return leaf && leaf.length > 0 ? leaf : "Preview";
}

interface AssetPreviewProps {
  projectId: string;
  fileName: string;
  storageKey?: string;
  mimeType?: string;
  shareToken?: string;
}

export function AssetPreview({
  projectId,
  fileName,
  storageKey,
  mimeType,
  shareToken,
}: AssetPreviewProps) {
  const kind = getAssetPreviewKind(fileName, mimeType);

  if (!storageKey) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-cz-text-muted">
        <div className="flex flex-col items-center gap-2">
          <FileQuestion size={32} className="text-cz-text-muted" />
          <span>Asset data is unavailable.</span>
        </div>
      </div>
    );
  }

  const url = assetUrl(projectId, storageKey, shareToken);

  if (kind === "image") {
    return (
      <ImageViewer
        url={url}
        error={null}
        documentName={sidebarName(fileName)}
      />
    );
  }

  if (kind === "pdf") {
    return (
      <PdfViewer url={url} error={null} documentName={sidebarName(fileName)} />
    );
  }

  return (
    <div className="flex h-full items-center justify-center text-sm text-cz-text-muted">
      <div className="flex flex-col items-center gap-2">
        <FileQuestion size={32} className="text-cz-text-muted" />
        <span>This file cannot be previewed.</span>
        <span className="text-xs">{fileName}</span>
      </div>
    </div>
  );
}
