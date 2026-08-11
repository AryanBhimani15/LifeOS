import { vi } from "vitest";

/**
 * Stubs for the native modules the API client pulls in.
 *
 * expo-secure-store talks to the iOS Keychain and cannot run under Node, so it
 * is replaced with an in-memory map. Everything else in the client — the fetch
 * calls, the refresh handling, the error mapping — is plain JavaScript and runs
 * for real against a real server.
 */
const store = new Map<string, string>();

vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: "afu",
  setItemAsync: async (k: string, v: string) => void store.set(k, v),
  getItemAsync: async (k: string) => store.get(k) ?? null,
  deleteItemAsync: async (k: string) => void store.delete(k),
}));

vi.mock("expo-application", () => ({
  getIosIdForVendorAsync: async () => "install-vitest-000001",
  nativeApplicationVersion: "1.0.0",
}));

vi.mock("expo-constants", () => ({
  default: { expoConfig: { extra: { apiBaseUrl: process.env.LIFEOS_API ?? "http://localhost:3000" } } },
}));

export const __store = store;
