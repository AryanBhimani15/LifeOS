import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/**
 * Credential storage, per platform.
 *
 * On iOS/Android this is the Keychain via expo-secure-store, with
 * `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` so the token is unavailable until the
 * device has been unlocked once after boot and never migrates to another device
 * through an iCloud backup.
 *
 * ON WEB THERE IS NO KEYCHAIN. expo-secure-store's web build is literally
 * `export default {}` — every call is undefined, so tokens would appear to save
 * and silently vanish. This falls back to localStorage instead.
 *
 * localStorage is NOT secure storage: any script running on the origin can read
 * it, so it is vulnerable to XSS in a way the Keychain is not. That is an
 * acceptable trade for running the app on your own laptop against a local
 * server; it would not be acceptable for a deployed web client. If this app is
 * ever hosted, tokens should move to an httpOnly cookie set by the server.
 */

const isWeb = Platform.OS === "web";

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export async function setItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Private browsing can reject writes; the session then lasts only as long
      // as the tab, which is inconvenient rather than broken.
    }
    return;
  }
  await SecureStore.setItemAsync(key, value, OPTIONS);
}

export async function getItem(key: string): Promise<string | null> {
  if (isWeb) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key, OPTIONS);
}

export async function deleteItem(key: string): Promise<void> {
  if (isWeb) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* nothing to do */
    }
    return;
  }
  await SecureStore.deleteItemAsync(key, OPTIONS);
}

/** True when credentials are in real secure storage rather than localStorage. */
export const storageIsSecure = !isWeb;
