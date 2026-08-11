import bcrypt from "bcryptjs";

/**
 * Password hashing, deliberately kept free of any Auth.js import.
 *
 * Auth.js pulls in `next/server`, which does not resolve outside a Next runtime.
 * Keeping hashing here lets tests and scripts hash passwords without booting
 * half the framework.
 */

/** Cost factor 12 ≈ 250ms per hash on modern hardware — slow enough to matter. */
export const BCRYPT_ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * A bcrypt hash of a throwaway value, compared against when no user exists.
 *
 * Without it, "email not found" returns immediately while "wrong password"
 * takes ~250ms, and that timing gap reveals which addresses are registered.
 */
export const DUMMY_HASH = "$2b$12$Ck6Xm7BwqOHwvE8SgnQd4uxvxwlrQoJPMkuLGaWnfhx8jsMuFrOqO";
