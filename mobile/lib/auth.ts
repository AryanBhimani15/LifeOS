import * as SecureStore from "expo-secure-store";
import * as Application from "expo-application";
import type { AuthTokens, SessionUser } from "./types";

/**
 * Credential storage.
 *
 * Tokens go in the iOS Keychain via expo-secure-store, never AsyncStorage —
 * AsyncStorage is plaintext on disk and survives in device backups.
 *
 * `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` means the token is unavailable until the
 * phone has been unlocked once after boot, and never migrates to a new device
 * through an iCloud backup restore. Background refresh still works, which
 * `WHEN_UNLOCKED` would break.
 */

const ACCESS_KEY = "lifeos.accessToken";
const REFRESH_KEY = "lifeos.refreshToken";
const USER_KEY = "lifeos.user";
const INSTALL_KEY = "lifeos.installId";

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export async function saveTokens(tokens: AuthTokens, user?: SessionUser) {
  await SecureStore.setItemAsync(ACCESS_KEY, tokens.accessToken, OPTIONS);
  await SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken, OPTIONS);
  if (user) await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user), OPTIONS);
}

export async function saveAccessToken(accessToken: string) {
  await SecureStore.setItemAsync(ACCESS_KEY, accessToken, OPTIONS);
}

export const getAccessToken = () => SecureStore.getItemAsync(ACCESS_KEY, OPTIONS);
export const getRefreshToken = () => SecureStore.getItemAsync(REFRESH_KEY, OPTIONS);

export async function getStoredUser(): Promise<SessionUser | null> {
  const raw = await SecureStore.getItemAsync(USER_KEY, OPTIONS);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

export async function clearTokens() {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_KEY, OPTIONS),
    SecureStore.deleteItemAsync(REFRESH_KEY, OPTIONS),
    SecureStore.deleteItemAsync(USER_KEY, OPTIONS),
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
  const existing = await SecureStore.getItemAsync(INSTALL_KEY, OPTIONS);
  if (existing) return existing;

  const generated =
    (await Application.getIosIdForVendorAsync().catch(() => null)) ??
    `install-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

  await SecureStore.setItemAsync(INSTALL_KEY, generated, OPTIONS);
  return generated;
}
