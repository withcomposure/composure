import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompilePreview } from "../src/preview/MediaViewer";

describe("CompilePreview", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the shortcut prompt when not compiling", () => {
    render(
      <CompilePreview
        pdfUrl={null}
        error={null}
        documentName="Compile"
        compiling={false}
      />,
    );

    expect(screen.getByText("Ctrl+Enter")).toBeInTheDocument();
    expect(screen.queryByText("Compiling...")).toBeNull();
  });

  it("shows compiling state and delayed initial-compile hint", () => {
    vi.useFakeTimers();

    render(
      <CompilePreview
        pdfUrl={null}
        error={null}
        documentName="Compile"
        compiling
      />,
    );

    expect(screen.getByText("Compiling...")).toBeInTheDocument();
    expect(screen.queryByText("Ctrl+Enter")).toBeNull();
    expect(screen.queryByText("This is taking longer than usual.")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(
      screen.getByText("This is taking longer than usual."),
    ).toBeInTheDocument();
  });
});
