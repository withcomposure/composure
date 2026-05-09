export interface ServerSettings {
  passwordResetExpiryHours: number;
  signupMode: "open" | "invite-only";
  guestSignupsEnabled: boolean;
  inviteExpiryHours: number;
  maxProjectsPerUser: string;
  maxConcurrentJobs: number;
  maxUploadFileSizeBytes: number | "unlimited";
  maxTextFileSizeBytes: number | "unlimited";
  maxFilesPerProject: number | "unlimited";
  trashRetentionDays: number;
  largeFileThresholdChars: number;
  chatHistoryRetentionDays: number | "unlimited" | "off";
}

export interface ServerSettingsFormState {
  signupMode: "open" | "invite-only";
  guestSignupsEnabled: boolean;
  inviteExpiryHours: number;
  passwordResetExpiryHours: number;
  maxConcurrentJobs: number;
  defaultProjectLimitMode: "on" | "unlimited";
  defaultProjectLimitValue: number;
  maxUploadMode: "on" | "unlimited";
  maxUploadValue: number;
  maxTextMode: "on" | "unlimited";
  maxTextValue: number;
  maxFilesMode: "on" | "unlimited";
  maxFilesValue: number;
  trashRetentionDays: number;
  largeFileThreshold: number;
  chatHistoryRetentionMode: "on" | "unlimited" | "off";
  chatHistoryRetentionValue: number;
}

export const DEFAULT_SERVER_SETTINGS_FORM_STATE: ServerSettingsFormState = {
  signupMode: "open",
  guestSignupsEnabled: true,
  inviteExpiryHours: 72,
  passwordResetExpiryHours: 24,
  maxConcurrentJobs: 3,
  defaultProjectLimitMode: "unlimited",
  defaultProjectLimitValue: 50,
  maxUploadMode: "on",
  maxUploadValue: 50,
  maxTextMode: "on",
  maxTextValue: 5,
  maxFilesMode: "on",
  maxFilesValue: 200,
  trashRetentionDays: 30,
  largeFileThreshold: 500,
  chatHistoryRetentionMode: "unlimited",
  chatHistoryRetentionValue: 30,
};

export function toServerSettingsFormState(
  response: ServerSettings,
): ServerSettingsFormState {
  const defaultProjectLimitMode =
    response.maxProjectsPerUser !== "unlimited" ? "on" : "unlimited";
  const defaultProjectLimitValue =
    response.maxProjectsPerUser !== "unlimited"
      ? Number.parseInt(response.maxProjectsPerUser, 10) || 50
      : 50;

  const maxUploadMode =
    response.maxUploadFileSizeBytes === "unlimited" ? "unlimited" : "on";
  const maxUploadValue =
    typeof response.maxUploadFileSizeBytes === "number"
      ? Math.round(response.maxUploadFileSizeBytes / (1024 * 1024))
      : 50;

  const maxTextMode =
    response.maxTextFileSizeBytes === "unlimited" ? "unlimited" : "on";
  const maxTextValue =
    typeof response.maxTextFileSizeBytes === "number"
      ? Math.round(response.maxTextFileSizeBytes / (1024 * 1024))
      : 5;

  const maxFilesMode =
    response.maxFilesPerProject === "unlimited" ? "unlimited" : "on";
  const maxFilesValue =
    typeof response.maxFilesPerProject === "number"
      ? response.maxFilesPerProject
      : 200;

  const chatHistoryRetentionMode =
    response.chatHistoryRetentionDays === "off"
      ? "off"
      : response.chatHistoryRetentionDays === "unlimited"
        ? "unlimited"
        : "on";
  const chatHistoryRetentionValue =
    typeof response.chatHistoryRetentionDays === "number"
      ? response.chatHistoryRetentionDays
      : 30;

  return {
    signupMode: response.signupMode,
    guestSignupsEnabled: response.guestSignupsEnabled,
    inviteExpiryHours: response.inviteExpiryHours,
    passwordResetExpiryHours: response.passwordResetExpiryHours,
    maxConcurrentJobs: response.maxConcurrentJobs,
    defaultProjectLimitMode,
    defaultProjectLimitValue,
    maxUploadMode,
    maxUploadValue,
    maxTextMode,
    maxTextValue,
    maxFilesMode,
    maxFilesValue,
    trashRetentionDays: response.trashRetentionDays ?? 30,
    largeFileThreshold: Math.round(
      (response.largeFileThresholdChars ?? 500_000) / 1000,
    ),
    chatHistoryRetentionMode,
    chatHistoryRetentionValue,
  };
}

export function toServerSettingsPayload(
  state: ServerSettingsFormState,
): Omit<ServerSettings, "maxProjectsPerUser"> & { maxProjectsPerUser: string } {
  return {
    signupMode: state.signupMode,
    guestSignupsEnabled: state.guestSignupsEnabled,
    inviteExpiryHours: state.inviteExpiryHours,
    passwordResetExpiryHours: state.passwordResetExpiryHours,
    maxConcurrentJobs: state.maxConcurrentJobs,
    maxProjectsPerUser:
      state.defaultProjectLimitMode === "unlimited"
        ? "unlimited"
        : String(state.defaultProjectLimitValue),
    maxUploadFileSizeBytes:
      state.maxUploadMode === "unlimited"
        ? "unlimited"
        : state.maxUploadValue * 1024 * 1024,
    maxTextFileSizeBytes:
      state.maxTextMode === "unlimited"
        ? "unlimited"
        : state.maxTextValue * 1024 * 1024,
    maxFilesPerProject:
      state.maxFilesMode === "unlimited"
        ? "unlimited"
        : state.maxFilesValue,
    trashRetentionDays: state.trashRetentionDays,
    largeFileThresholdChars: state.largeFileThreshold * 1000,
    chatHistoryRetentionDays:
      state.chatHistoryRetentionMode === "unlimited"
        ? "unlimited"
        : state.chatHistoryRetentionMode === "off"
          ? "off"
          : state.chatHistoryRetentionValue,
  };
}
