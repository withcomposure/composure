import { AlertCircle, type LucideIcon } from "lucide-react";
import { CustomDropdown } from "@/components/CustomDropdown";
import { NumberStepper } from "@/components/NumberStepper";
import { PopupDialog } from "@/components/PopupDialog";
import { SegmentedControl } from "@/components/SegmentedControl";
import { ToggleSwitch } from "@/components/ToggleSwitch";

export type RoleOption = "user" | "admin";

type ProjectLimitMode = "custom" | "unlimited" | "inherit";

interface BaseUserFormModalProps {
  open: boolean;
  busy: boolean;
  error: string | null;
  roleOptions: Array<{ value: RoleOption; label: string; icon: LucideIcon }>;
  defaultProjectLimitMode: "on" | "unlimited";
  defaultProjectLimitValue: number;
  onClose: () => void;
  onSubmit: () => void;
}

interface CreateUserFormModalProps extends BaseUserFormModalProps {
  mode: "create";
  email: string;
  displayName: string;
  password: string;
  role: RoleOption;
  maxProjectsMode: ProjectLimitMode;
  maxProjectsValue: number;
  onEmailChange: (value: string) => void;
  onDisplayNameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onRoleChange: (value: RoleOption) => void;
  onMaxProjectsModeChange: (value: ProjectLimitMode) => void;
  onMaxProjectsValueChange: (value: number) => void;
}

interface EditUserFormModalProps extends BaseUserFormModalProps {
  mode: "edit";
  user: { displayName: string; email: string } | null;
  isSelfEditing: boolean;
  displayName: string;
  role: RoleOption;
  suspended: boolean;
  maxProjectsMode: ProjectLimitMode;
  maxProjectsValue: number;
  newPassword: string;
  confirmPassword: string;
  onDisplayNameChange: (value: string) => void;
  onRoleChange: (value: RoleOption) => void;
  onSuspendedChange: (value: boolean) => void;
  onMaxProjectsModeChange: (value: ProjectLimitMode) => void;
  onMaxProjectsValueChange: (value: number) => void;
  onNewPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
}

type UserFormModalProps = CreateUserFormModalProps | EditUserFormModalProps;

function projectLimitHelperText(
  mode: ProjectLimitMode,
  defaultMode: "on" | "unlimited",
  defaultValue: number,
): string {
  if (mode === "inherit") {
    return `Inherits server default (${defaultMode === "unlimited" ? "unlimited" : defaultValue}).`;
  }
  if (mode === "unlimited") {
    return "Unlimited projects for this user.";
  }
  return "Custom limit for this user.";
}

export function UserFormModal(props: UserFormModalProps) {
  const isCreate = props.mode === "create";
  const title = isCreate
    ? "Create User"
    : props.user
      ? `Edit ${props.user.displayName}`
      : "Edit User";
  const message = isCreate
    ? "Create an account with a temporary password."
    : `Changes apply on save. Suspending ${props.user?.displayName || "the user"} takes effect on their next login. Changing their password will sign them out of all active sessions immediately.`;

  return (
    <PopupDialog
      open={props.open}
      title={title}
      message={message}
      panelWidth="2xl"
      dismiss={{
        label: isCreate ? "Cancel" : "Close",
        onClick: () => {
          if (props.busy) return;
          props.onClose();
        },
        disabled: props.busy,
      }}
      actions={[
        {
          label: props.busy
            ? isCreate
              ? "Creating..."
              : "Saving..."
            : isCreate
              ? "Create user"
              : "Save changes",
          onClick: props.onSubmit,
          disabled:
            props.busy || (!isCreate && props.mode === "edit" && !props.user),
        },
      ]}
    >
      {isCreate ? (
        <div className="space-y-4">
          <div>
            <div className="mb-1 text-xs uppercase tracking-wider text-cz-text-muted">
              Email
            </div>
            <input
              value={props.email}
              onChange={(event) => props.onEmailChange(event.target.value)}
              className="w-full rounded-md border border-cz-border bg-cz-bg px-3 py-2 text-sm text-cz-text outline-none focus:border-cz-accent"
              placeholder="new.user@example.com"
            />
          </div>
          <div>
            <div className="mb-1 text-xs uppercase tracking-wider text-cz-text-muted">
              Display name
            </div>
            <input
              value={props.displayName}
              onChange={(event) =>
                props.onDisplayNameChange(event.target.value)
              }
              className="w-full rounded-md border border-cz-border bg-cz-bg px-3 py-2 text-sm text-cz-text outline-none focus:border-cz-accent"
              placeholder="Composure User"
            />
          </div>
          <div>
            <div className="mb-1 text-xs uppercase tracking-wider text-cz-text-muted">
              Temporary password
            </div>
            <input
              type="password"
              value={props.password}
              onChange={(event) => props.onPasswordChange(event.target.value)}
              className="w-full rounded-md border border-cz-border bg-cz-bg px-3 py-2 text-sm text-cz-text outline-none focus:border-cz-accent"
            />
          </div>
          <div className="overflow-hidden rounded-md border border-cz-border bg-cz-bg/30">
            <div className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm text-cz-text">Role</div>
                <div className="text-xs text-cz-text-muted">
                  Controls administration permissions for this user.
                </div>
              </div>
              <CustomDropdown
                value={props.role}
                options={props.roleOptions}
                onChange={props.onRoleChange}
              />
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-cz-border px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm text-cz-text">Project limit</div>
                <div className="text-xs text-cz-text-muted">
                  {projectLimitHelperText(
                    props.maxProjectsMode,
                    props.defaultProjectLimitMode,
                    props.defaultProjectLimitValue,
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {props.maxProjectsMode === "custom" && (
                  <NumberStepper
                    value={props.maxProjectsValue}
                    min={1}
                    max={10000}
                    ariaLabel="Project limit for new user"
                    widthClass="w-16"
                    onChange={props.onMaxProjectsValueChange}
                  />
                )}
                <SegmentedControl
                  value={props.maxProjectsMode}
                  options={["custom", "unlimited", "inherit"] as const}
                  onChange={props.onMaxProjectsModeChange}
                  ariaLabel="Project limit mode"
                />
              </div>
            </div>
          </div>
          {props.error && <div className="text-sm text-red-300">{props.error}</div>}
        </div>
      ) : props.user ? (
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wider text-cz-text-muted">
            Profile
          </div>
          <div className="overflow-hidden rounded-md border border-cz-border bg-cz-bg/30">
            <div className="grid gap-3 px-3 py-3 md:grid-cols-2">
              <input
                value={props.displayName}
                onChange={(event) =>
                  props.onDisplayNameChange(event.target.value)
                }
                className="w-full rounded-md border border-cz-border bg-cz-bg px-3 py-2 text-sm text-cz-text outline-none focus:border-cz-accent"
                placeholder="Display name"
              />
              <input
                value={props.user.email}
                disabled
                className="w-full rounded-md border border-cz-border bg-cz-bg/70 px-3 py-2 text-sm text-cz-text-muted"
              />
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-cz-border px-3 py-2">
              <div>
                <div className="text-sm text-cz-text">Role</div>
                <div className="text-xs text-cz-text-muted">
                  {props.isSelfEditing
                    ? "Controls administration permissions. You cannot demote your own account."
                    : "Controls administration permissions for this user."}
                </div>
              </div>
              <CustomDropdown
                value={props.role}
                options={props.roleOptions}
                onChange={props.onRoleChange}
                className={props.isSelfEditing ? "pointer-events-none opacity-60" : ""}
              />
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-cz-border px-3 py-2">
              <div>
                <div className="text-sm text-cz-text">Project limit</div>
                <div className="text-xs text-cz-text-muted">
                  {projectLimitHelperText(
                    props.maxProjectsMode,
                    props.defaultProjectLimitMode,
                    props.defaultProjectLimitValue,
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {props.maxProjectsMode === "custom" && (
                  <NumberStepper
                    value={props.maxProjectsValue}
                    min={1}
                    max={10000}
                    ariaLabel="Project limit for user"
                    widthClass="w-16"
                    onChange={props.onMaxProjectsValueChange}
                  />
                )}
                <SegmentedControl
                  value={props.maxProjectsMode}
                  options={["custom", "unlimited", "inherit"] as const}
                  onChange={props.onMaxProjectsModeChange}
                  ariaLabel="Project limit mode"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-cz-border px-3 py-2">
              <div>
                <div className="text-sm text-cz-text">Suspended</div>
                <div className="text-xs text-cz-text-muted">
                  {props.isSelfEditing
                    ? "Suspended users cannot log in. You cannot suspend your own account."
                    : "Suspended users cannot log in."}
                </div>
              </div>
              <ToggleSwitch
                checked={props.suspended}
                onChange={(next) => {
                  if (props.isSelfEditing && next) return;
                  props.onSuspendedChange(next);
                }}
                ariaLabel="Toggle user suspension"
                disabled={props.isSelfEditing}
              />
            </div>
          </div>

          <div className="mt-4 text-xs uppercase tracking-wider text-cz-text-muted">
            Change Password
          </div>
          <div className="rounded-md border border-cz-border bg-cz-bg/50 p-3">
            <div className="grid gap-2 md:grid-cols-2">
              <input
                type="password"
                value={props.newPassword}
                onChange={(event) => props.onNewPasswordChange(event.target.value)}
                className="w-full rounded-md border border-cz-border bg-cz-bg px-3 py-2 text-sm text-cz-text outline-none focus:border-cz-accent"
                placeholder="New password"
              />
              <input
                type="password"
                value={props.confirmPassword}
                onChange={(event) =>
                  props.onConfirmPasswordChange(event.target.value)
                }
                className="w-full rounded-md border border-cz-border bg-cz-bg px-3 py-2 text-sm text-cz-text outline-none focus:border-cz-accent"
                placeholder="Confirm password"
              />
            </div>
          </div>

          {props.error && (
            <div className="flex items-center gap-2 text-sm text-red-300">
              <AlertCircle size={14} />
              {props.error}
            </div>
          )}
        </div>
      ) : null}
    </PopupDialog>
  );
}
