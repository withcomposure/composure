import { useEffect, useMemo, useRef, useState } from "react";
import type * as Y from "yjs";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import Asciidoctor from "@asciidoctor/core";
import type { ProjectFormat } from "@/utils/project-format";

interface UseHtmlPreviewOptions {
  ydoc: Y.Doc;
  /** File rendered in the right-hand preview; empty disables rendering. */
  rightPreviewFilePath: string;
  rightPreviewFormat: ProjectFormat;
  initialSyncDone: boolean;
}

/** Live Markdown/AsciiDoc preview: renders on doc changes with 300ms debounce. */
export function useHtmlPreview({
  ydoc,
  rightPreviewFilePath,
  rightPreviewFormat,
  initialSyncDone,
}: UseHtmlPreviewOptions): string {
  const [markdownHtml, setMarkdownHtml] = useState("");
  const markdownDebounceTimerRef = useRef<number | null>(null);

  const md = useMemo(
    () => MarkdownIt({ html: false, linkify: true, typographer: true }),
    [],
  );
  const adoc = useMemo(() => Asciidoctor(), []);

  useEffect(() => {
    if (
      (rightPreviewFormat !== "markdown" && rightPreviewFormat !== "asciidoc") ||
      !rightPreviewFilePath ||
      !initialSyncDone
    )
      return;

    const renderPreview = () => {
      const textKey = `file:${rightPreviewFilePath}`;
      const text = ydoc.getText(textKey).toString();
      if (rightPreviewFormat === "markdown") {
        setMarkdownHtml(md.render(text));
      } else {
        // Asciidoctor passes raw-HTML passthrough blocks (`++++`, `pass:[]`)
        // through unescaped in every safe mode, and the preview HTML is also
        // opened as a same-origin blob document via "Open in new tab" — so
        // unsanitized output here is stored XSS with app-origin script access.
        setMarkdownHtml(
          DOMPurify.sanitize(
            adoc.convert(text, { safe: "safe", standalone: false }) as string,
          ),
        );
      }
    };

    // Initial render
    renderPreview();

    const onDocUpdate = () => {
      if (markdownDebounceTimerRef.current !== null) {
        window.clearTimeout(markdownDebounceTimerRef.current);
      }
      markdownDebounceTimerRef.current = window.setTimeout(() => {
        markdownDebounceTimerRef.current = null;
        renderPreview();
      }, 300);
    };

    ydoc.on("update", onDocUpdate);
    return () => {
      ydoc.off("update", onDocUpdate);
      if (markdownDebounceTimerRef.current !== null) {
        window.clearTimeout(markdownDebounceTimerRef.current);
        markdownDebounceTimerRef.current = null;
      }
    };
  }, [
    ydoc,
    rightPreviewFilePath,
    rightPreviewFormat,
    initialSyncDone,
    md,
    adoc,
  ]);

  return markdownHtml;
}
