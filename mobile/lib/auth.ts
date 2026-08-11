import * as Application from "expo-application";
import { deleteItem, getItem, setItem } from "./storage";
import type { AuthTokens, SessionUser } from "./types";

/**
 * Credential storage.
 *
 * The platform-appropriate backing store lives in ./storage — Keychain on
 * device, localStorage on web (with the caveats documented there). This module
 * only decides WHAT is stored, not where.
 */

const ACCESS_KEY = "lifeos.accessToken";
const REFRESH_KEY = "lifeos.refreshToken";
const USER_KEY = "lifeos.user";
const INSTALL_KEY = "lifeos.installId";

export async function saveTokens(tokens: AuthTokens, user?: SessionUser) {
  await setItem(ACCESS_KEY, tokens.accessToken);
  await setItem(REFRESH_KEY, tokens.refreshToken);
  if (user) await setItem(USER_KEY, JSON.stringify(user));
}

export async function saveAccessToken(accessToken: string) {
  await setItem(ACCESS_KEY, accessToken);
}

export const getAccessToken = () => getItem(ACCESS_KEY);
export const getRefreshToken = () => getItem(REFRESH_KEY);

export async function getStoredUser(): Promise<SessionUser | null> {
  const raw = await getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

export async function clearTokens() {
  await Promise.all([
    deleteItem(ACCESS_KEY),
    deleteItem(REFRESH_KEY),
    deleteItem(USER_KEY),
  ]);
}

/**
 * A stable identifier for this install.
 *
 * Deliberately NOT a device serial or advertising id: this only needs to be
 * consistent for one install so the server can recognise the same phone across
 * sign-ins, and it should disappear when the app is deleted.
 */
export async function getInstallId(): Promise<string> {
  const existing = await getItem(INSTALL_KEY);
  if (existing) return existing;

  // getIosIdForVendorAsync does not exist on web, hence the guarded call.
  const generated =
    (await Application.getIosIdForVendorAsync?.().catch(() => null)) ??
    `install-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

  await setItem(INSTALL_KEY, generated);
  return generated;
}
