import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { db } from "@/lib/db";
import { unauthenticated } from "@/lib/errors";

/**
 * Token authentication for native clients.
 *
 * Cookie sessions cannot work outside a browser, so mobile uses:
 *   - a short-lived access JWT (15 min), sent as `Authorization: Bearer`
 *   - a long-lived opaque refresh token (60 days), held in the iOS Keychain
 *
 * Only a SHA-256 hash of the refresh token is stored. A database leak then
 * yields nothing usable — the same reasoning as password hashing. The token is
 * high-entropy random rather than a memorised secret, so a plain hash is
 * sufficient; bcrypt's work factor would buy nothing against 256 bits of entropy.
 *
 * Rotation and reuse detection are deliberately NOT implemented. On a flaky
 * connection the server rotates, the response drops, and the client is left
 * holding an invalidated token — a permanent logout with no recovery path. For a
 * single-user personal app that trade is not worth it; revocation is per-device
 * and immediate, which covers the realistic threat. See docs/decisions.md.
 *
 * jose is already present as an Auth.js dependency, so this adds none.
 */

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_DAYS = 60;
const ISSUER = "lifeos";
const AUDIENCE = "lifeos-mobile";

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(value);
}

/** Refresh tokens are looked up by hash; the plaintext is never stored. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires, so the client can pre-emptively refresh. */
  expiresIn: number;
}

export interface AccessTokenClaims {
  userId: string;
  tokenId: string;
}

async function signAccessToken(userId: string, tokenId: string): Promise<string> {
  return new SignJWT({ tokenId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secret());
}

/**
 * Verifies a bearer token.
 *
 * Audience is checked so a web session JWT can never be replayed as a mobile
 * access token, and vice versa — they are signed with the same secret.
 */
export async function verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (!payload.sub || typeof payload.tokenId !== "string") return null;
    return { userId: payload.sub, tokenId: payload.tokenId };
  } catch {
    // Expired, tampered, or wrong audience — all indistinguishable to the caller.
    return null;
  }
}

export async function issueTokens(
  userId: string,
  device?: { name?: string; installId?: string },
): Promise<AuthTokens> {
  const refreshToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86_400_000);

  const record = await db.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(refreshToken),
      deviceName: device?.name?.slice(0, 100) ?? null,
      deviceId: device?.installId ?? null,
      expiresAt,
    },
    select: { id: true },
  });

  return {
    accessToken: await signAccessToken(userId, record.id),
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  };
}

/**
 * Exchanges a refresh token for a new access token.
 *
 * The refresh token itself is reused rather than rotated (see the module note),
 * so a dropped response costs the client nothing.
 */
export async function refreshTokens(refreshToken: string): Promise<AuthTokens> {
  const record = await db.refreshToken.findUnique({
    where: { tokenHash: hashToken(refreshToken) },
    select: { id: true, userId: true, expiresAt: true, revokedAt: true },
  });

  // One message for every failure mode: unknown, revoked, expired. Telling the
  // caller which would let it probe for valid tokens.
  if (!record || record.revokedAt || record.expiresAt.getTime() < Date.now()) {
    throw unauthenticated("Your session has expired. Please sign in again.");
  }

  await db.refreshToken.update({
    where: { id: record.id },
    data: { lastUsedAt: new Date() },
  });

  return {
    accessToken: await signAccessToken(record.userId, record.id),
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  };
}

/**
 * Revokes one device's refresh token.
 *
 * Scoped to the single token on purpose: signing out on the phone must not end
 * the browser session. Revoking is idempotent — signing out twice is not an error.
 */
export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  await db.refreshToken.updateMany({
    where: { tokenHash: hashToken(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Revokes every refresh token for a user — for "sign out everywhere". */
export async function revokeAllForUser(userId: string): Promise<number> {
  const result = await db.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/** Housekeeping: drop tokens that expired or were revoked long ago. */
export async function pruneRefreshTokens(): Promise<number> {
  const cutoff = new Date(Date.now() - 30 * 86_400_000);
  const result = await db.refreshToken.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: cutoff } }],
    },
  });
  return result.count;
}
