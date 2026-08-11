import { useSyncExternalStore } from "react";
import { getRefreshToken } from "./auth";

/**
 * Whether a session exists, as subscribable state.
 *
 * The auth gate previously read storage once in a mount effect. Signing in
 * stored a token but nothing told the gate, so its state still said "signed
 * out" and it redirected straight back to /login — sign-in appeared to fail
 * even though the server had returned 200 and issued tokens.
 *
 * Credentials live outside React (Keychain / localStorage), so they are external
 * state and belong behind useSyncExternalStore rather than in a component's
 * useState. `login()` and `logout()` publish here, and every subscriber updates.
 *
 * `null` means "not checked yet", which the gate must treat as "wait" rather
 * than "signed out" — otherwise it redirects during the first frame of a cold
 * launch, before storage has been read.
 */

type SessionState = boolean | null;

let state: SessionState = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => state;
/** The server has no credential storage; the gate resolves it after hydration. */
const getServerSnapshot = (): SessionState => null;

/** Re-reads storage. Call once at startup. */
export async function loadSession(): Promise<void> {
  try {
    const token = await getRefreshToken();
    state = Boolean(token);
  } catch {
    state = false;
  }
  emit();
}

export function markSignedIn() {
  state = true;
  emit();
}

export function markSignedOut() {
  state = false;
  emit();
}

export function useSession(): SessionState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
