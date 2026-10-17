/**
 * The Matrix session of the Inbox in the browser (ADR 0023 rule 9, IN4a):
 * kept with its refresh token, so the page does not log in on every load
 * (Synapse limits logins, `rc_login`). The console's sign-out deletes the
 * devices on Synapse (IN3), which kills a stored session; the client then
 * logs in again with a new JWT.
 */

export type StoredSession = Readonly<{
  homeserverUrl: string;
  userId: string;
  deviceId: string;
  accessToken: string;
  refreshToken: string | null;
}>;

const KEY = "guidu.inbox.matrix-session";

export function readSession(): StoredSession | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredSession>;
    if (
      typeof value.homeserverUrl !== "string" ||
      typeof value.userId !== "string" ||
      typeof value.deviceId !== "string" ||
      typeof value.accessToken !== "string"
    ) {
      return null;
    }
    return {
      homeserverUrl: value.homeserverUrl,
      userId: value.userId,
      deviceId: value.deviceId,
      accessToken: value.accessToken,
      refreshToken:
        typeof value.refreshToken === "string" ? value.refreshToken : null,
    };
  } catch {
    return null;
  }
}

export function writeSession(session: StoredSession): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // Private mode: the session lives only in memory for this page.
  }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing stored.
  }
}
