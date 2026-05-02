import { useCallback, useState } from "react";
import { AmbientBackground } from "@/components/AmbientBackground";
import { oauthIntentUrl } from "@/utils/oauth";

const providerLabels: Record<string, string> = {
  github: "GitHub",
  google: "Google",
};

const providerIcons: Record<string, React.ReactNode> = {
  github: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0112 6.844a9.59 9.59 0 012.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
    </svg>
  ),
  google: (
    <svg viewBox="0 0 24 24" className="h-4 w-4">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  ),
};

interface AuthEntryViewProps {
  busy: boolean;
  error: string | null;
  guestRetentionDays: number;
  guestSignupsEnabled: boolean;
  userCount: number;
  signupMode: "open" | "invite-only";
  initialMode: "login" | "signup";
  enabledLoginProviders: string[];
  inviteToken?: string;
  onLogin: (input: { email: string; password: string }) => void;
  onSignup: (input: {
    displayName: string;
    email: string;
    password: string;
    inviteToken?: string;
  }) => void;
  onPasswordReset: (input: { token: string; newPassword: string }) => void;
  onContinueAsGuest: () => void;
  resetToken?: string;
  resetEmail?: string;
}

export function AuthEntryView({
  busy,
  error,
  guestRetentionDays,
  guestSignupsEnabled,
  userCount,
  signupMode,
  initialMode,
  enabledLoginProviders,
  inviteToken,
  onLogin,
  onSignup,
  onPasswordReset,
  onContinueAsGuest,
  resetToken,
  resetEmail,
}: AuthEntryViewProps) {
  const isNoUsersBootstrap = userCount === 0 && !resetToken;
  const isPasswordResetMode = Boolean(resetToken);
  const isInviteMode = Boolean(inviteToken);
  const canShowCreateAccount =
    isNoUsersBootstrap || isInviteMode || signupMode === "open";

  const [mode, setMode] = useState<"login" | "signup">(
    isInviteMode ? "signup" : initialMode,
  );
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const effectiveMode: "login" | "signup" =
    isNoUsersBootstrap || isInviteMode
      ? "signup"
      : canShowCreateAccount
        ? mode
        : "login";
  const effectiveEmail = isPasswordResetMode ? (resetEmail ?? "") : email;

  const hasOAuthProviders = enabledLoginProviders.length > 0;
  const showSignupOAuth = hasOAuthProviders && !isNoUsersBootstrap && !isInviteMode;

  const submitAuth = useCallback(() => {
    if (isPasswordResetMode && resetToken) {
      onPasswordReset({ token: resetToken, newPassword: password });
      return;
    }

    if (effectiveMode === "login") {
      onLogin({ email: effectiveEmail, password });
      return;
    }
    if (effectiveMode === "signup" && displayName.trim().length < 2) {
      return;
    }
    onSignup({ displayName, email: effectiveEmail, password, inviteToken });
  }, [
    displayName,
    effectiveEmail,
    effectiveMode,
    inviteToken,
    isPasswordResetMode,
    onLogin,
    onPasswordReset,
    onSignup,
    password,
    resetToken,
  ]);

  const passwordMismatch =
    isPasswordResetMode &&
    confirmPassword.trim().length > 0 &&
    confirmPassword !== password;
  const invalidSignupDisplayName =
    !isPasswordResetMode &&
    effectiveMode === "signup" &&
    displayName.trim().length < 2;

  // Shared OAuth button list
  const oauthButtons = () =>
    enabledLoginProviders.map((provider) => (
      <a
        key={provider}
        href={oauthIntentUrl(provider, "login")}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-cz-border px-3 py-2 text-sm text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text"
      >
        {providerIcons[provider] ?? null}
        Continue with{" "}
        {providerLabels[provider] ?? provider}
      </a>
    ));

  // Divider between email + OAuth
  const oauthDivider = hasOAuthProviders ? (
    <div className="my-5 flex items-center gap-3">
      <div className="h-px flex-1 bg-cz-border" />
      <span className="text-xs uppercase tracking-[0.2em] text-cz-text-muted">
        or
      </span>
      <div className="h-px flex-1 bg-cz-border" />
    </div>
  ) : null;

  const canContinueAsGuest =
    !isNoUsersBootstrap && !isInviteMode && guestSignupsEnabled;

  const guestCta = canContinueAsGuest ? (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={onContinueAsGuest}
        className="mt-3 w-full rounded-md border border-cz-border px-3 py-2 text-sm text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text disabled:opacity-70"
      >
        Continue as Guest
      </button>
      <div className="mt-3 text-center text-xs text-cz-text-muted">
        Guest documents are retained for {guestRetentionDays} days of
        inactivity.
      </div>
    </>
  ) : null;

  return (
    <AmbientBackground className="text-cz-text">
      <div className="w-full max-w-md rounded-2xl border border-cz-border bg-cz-surface p-6 shadow-2xl">
        <div className="mb-6 text-center">
          <div className="text-xl font-semibold tracking-tight">
            <span className="text-cz-accent">C</span>omposure
          </div>
          <p className="mt-4 text-sm text-cz-text-muted">
            {isPasswordResetMode
              ? "Set a new password for your account."
              : effectiveMode === "signup"
                ? "Create an account to sync your projects across devices."
                : "Sign in to sync your projects across devices."}
          </p>
        </div>

        {isNoUsersBootstrap ? (
          <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-sm text-amber-100">
            No accounts exist yet. The first account created will automatically
            become a server administrator.
          </div>
        ) : isInviteMode ? (
          <div className="mb-4 rounded-md border border-cz-accent/40 bg-cz-accent/10 px-3 py-3 text-sm text-cz-text">
            You have been invited to create an account.
          </div>
        ) : !isPasswordResetMode && canShowCreateAccount ? (
          <div className="mb-5 rounded-xl border border-cz-border bg-cz-bg/80 p-1 shadow-inner">
            <div className="grid grid-cols-2 gap-1 text-sm">
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                }}
                className={`rounded-lg px-3 py-2.5 transition ${effectiveMode === "login" ? "bg-cz-surface text-cz-text shadow-sm ring-1 ring-cz-accent/45" : "text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text"}`}
              >
                Log in
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                }}
                className={`rounded-lg px-3 py-2.5 transition ${effectiveMode === "signup" ? "bg-cz-surface text-cz-text shadow-sm ring-1 ring-cz-accent/45" : "text-cz-text-muted hover:bg-cz-surface-hover hover:text-cz-text"}`}
              >
                Create account
              </button>
            </div>
          </div>
        ) : null}

        {/* ---- Login mode ---- */}
        {effectiveMode === "login" && !isPasswordResetMode && (
          <>
            {hasOAuthProviders && <div className="space-y-2">{oauthButtons()}</div>}
            {oauthDivider}

            <form
              onSubmit={(event) => {
                event.preventDefault();
                submitAuth();
              }}
            >
              <label className="block text-xs uppercase tracking-wider text-cz-text-muted">
                Email
              </label>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1 mb-3 w-full rounded-md border border-cz-border bg-cz-bg px-3 py-2 text-sm text-cz-text outline-none focus:border-cz-accent"
                placeholder="you@example.com"
              />

              <label className="block text-xs uppercase tracking-wider text-cz-text-muted">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1 w-full rounded-md border border-cz-border bg-cz-bg px-3 py-2 text-sm text-cz-text outline-none focus:border-cz-accent"
              />

              {error && (
                <div className="mt-3 text-sm text-red-300">{error}</div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="mt-6 w-full rounded-md bg-cz-accent px-3 py-2 text-sm text-white hover:bg-cz-accent-hover disabled:opacity-70"
              >
                {busy ? "Please wait..." : "Log in"}
              </button>
            </form>

            {guestCta}
          </>
        )}

        {/* ---- Signup mode ---- */}
        {effectiveMode === "signup" && !isPasswordResetMode && (
          <>
            {showSignupOAuth && (
              <div className="space-y-2">{oauthButtons()}</div>
            )}
            {showSignupOAuth ? oauthDivider : null}

            <form
              onSubmit={(event) => {
                event.preventDefault();
                submitAuth();
              }}
            >
              <label className="block text-xs uppercase tracking-wider text-cz-text-muted">
                Display name
              </label>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                className="mt-1 mb-3 w-full rounded-md border border-cz-border bg-cz-bg px-3 py-2 text-sm text-cz-text outline-none focus:border-cz-accent"
                placeholder="Ada Lovelace"
              />
              {displayName.trim().length > 0 &&
                displayName.trim().length < 2 && (
                  <div className="-mt-2 mb-3 text-sm text-red-300">
                    Display name must be at least 2 characters.
                  </div>
                )}

              <label className="block text-xs uppercase tracking-wider text-cz-text-muted">
                Email
              </label>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1 mb-3 w-full rounded-md border border-cz-border bg-cz-bg px-3 py-2 text-sm text-cz-text outline-none focus:border-cz-accent"
                placeholder="you@example.com"
              />

              <label className="block text-xs uppercase tracking-wider text-cz-text-muted">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1 w-full rounded-md border border-cz-border bg-cz-bg px-3 py-2 text-sm text-cz-text outline-none focus:border-cz-accent"
              />

              {error && (
                <div className="mt-3 text-sm text-red-300">{error}</div>
              )}

              <button
                type="submit"
                disabled={busy || invalidSignupDisplayName}
                className="mt-6 w-full rounded-md bg-cz-accent px-3 py-2 text-sm text-white hover:bg-cz-accent-hover disabled:opacity-70"
              >
                {busy ? "Please wait..." : "Create account"}
              </button>
            </form>

            {guestCta}
          </>
        )}

        {/* ---- Password reset mode ---- */}
        {isPasswordResetMode && (
          <>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                submitAuth();
              }}
            >
              <label className="block text-xs uppercase tracking-wider text-cz-text-muted">
                Email
              </label>
              <input
                value={effectiveEmail}
                disabled
                className="mt-1 mb-3 w-full rounded-md border border-cz-border bg-cz-bg px-3 py-2 text-sm text-cz-text outline-none focus:border-cz-accent"
                placeholder="you@example.com"
              />

              <label className="block text-xs uppercase tracking-wider text-cz-text-muted">
                New password
              </label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1 w-full rounded-md border border-cz-border bg-cz-bg px-3 py-2 text-sm text-cz-text outline-none focus:border-cz-accent"
              />

              <label className="mt-3 block text-xs uppercase tracking-wider text-cz-text-muted">
                Confirm password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="mt-1 w-full rounded-md border border-cz-border bg-cz-bg px-3 py-2 text-sm text-cz-text outline-none focus:border-cz-accent"
              />

              {passwordMismatch && (
                <div className="mt-3 text-sm text-red-300">
                  Passwords must match.
                </div>
              )}

              {error && (
                <div className="mt-3 text-sm text-red-300">{error}</div>
              )}

              <button
                type="submit"
                disabled={busy || passwordMismatch}
                className="mt-6 w-full rounded-md bg-cz-accent px-3 py-2 text-sm text-white hover:bg-cz-accent-hover disabled:opacity-70"
              >
                {busy ? "Please wait..." : "Set new password"}
              </button>
            </form>

            {hasOAuthProviders && (
              <>
                {oauthDivider}
                <div className="space-y-2">{oauthButtons()}</div>
              </>
            )}
          </>
        )}
      </div>
    </AmbientBackground>
  );
}
