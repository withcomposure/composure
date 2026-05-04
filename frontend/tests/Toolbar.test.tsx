import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Toolbar } from "../src/workspace/Toolbar";

const defaults = {
  sidebarOpen: true,
  onToggleSidebar: () => {},
  onOpenSettings: () => {},
  onLogout: () => {},
  onLogin: () => {},
  accountLabel: "Test User",
  accountEmail: "test@test.com",
  accountImageUrl: null,
  accountIsGuest: false,
  canEdit: true,
  canComment: true,
  mode: "edit" as const,
  onModeChange: () => {},
  onOpenShare: () => {},
  onCompile: () => {},
  onCompileCurrentFile: () => {},
  canCompileCurrentFile: false,
  onClearCompileOutput: () => {},
  hasCompiledOutput: false,
  clearingCompileOutput: false,
  autoCompileEnabled: false,
  autoCompileTimeoutSeconds: 2,
  onAutoCompileChange: () => {},
  onSave: () => {},
  saving: false,
  connectionState: "connected" as const,
  compiling: false,
  activeFile: "",
  activeEditors: [],
  onFocusCollaborator: () => {},
  onOpenReferenceLookup: () => {},
  projectFormat: "latex" as const,
  onExport: () => {},
  exporting: false,
  previewOpen: true,
  onTogglePreview: () => {},
  projectId: "test-project",
  onViewDiff: () => {},
  historyState: null,
};

describe("Toolbar", () => {
  it("shows reference lookup button when no file is selected", () => {
    render(<Toolbar {...defaults} activeFile="" />);
    expect(screen.getByRole('button', { name: 'Open reference lookup' })).toBeInTheDocument()
  });

  it("shows breadcrumbs when a file is selected", () => {
    render(<Toolbar {...defaults} activeFile="src/main.tex" />);
    expect(screen.getByRole('button', { name: 'Open reference lookup' })).toBeInTheDocument()
  });

  it("shows single segment for root-level file", () => {
    render(<Toolbar {...defaults} activeFile="main.tex" />);
    expect(screen.getByRole('button', { name: 'Open reference lookup' })).toBeInTheDocument()
  });

  it("renders clear output action in compile menu and disables it without compiled output", () => {
    render(<Toolbar {...defaults} hasCompiledOutput={false} />);

    fireEvent.click(screen.getByLabelText("Compile options"));

    const clearButton = screen.getByRole("button", {
      name: "Clear compile output",
    });
    expect(clearButton).toBeDisabled();
  });

  it("invokes clear output action when clicked with compiled output present", () => {
    const onClearCompileOutput = vi.fn<() => void>();

    render(
      <Toolbar
        {...defaults}
        hasCompiledOutput={true}
        onClearCompileOutput={onClearCompileOutput}
      />,
    );

    fireEvent.click(screen.getByLabelText("Compile options"));
    fireEvent.click(
      screen.getByRole("button", { name: "Clear compile output" }),
    );

    expect(onClearCompileOutput).toHaveBeenCalledTimes(1);
  });

  it('invokes compile current file action when enabled in compile menu', () => {
    const onCompileCurrentFile = vi.fn<() => void>()

    render(
      <Toolbar
        {...defaults}
        canCompileCurrentFile={true}
        onCompileCurrentFile={onCompileCurrentFile}
      />,
    )

    fireEvent.click(screen.getByLabelText('Compile options'))
    fireEvent.click(screen.getByRole('button', { name: 'Compile current file' }))

    expect(onCompileCurrentFile).toHaveBeenCalledTimes(1)
  })
});
