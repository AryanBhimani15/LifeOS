import { beforeEach, describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import {
  hashToken,
  issueTokens,
  refreshTokens,
  revokeAllForUser,
  revokeRefreshToken,
  verifyAccessToken,
} from "@/lib/mobile-auth";
import { FakeProvider } from "@/lib/ai/provider";
import { planCommand } from "@/lib/ai/planner";
import { executePlan } from "@/lib/ai/executor";
import { makeTask, makeTwoUsers, resetDatabase } from "./helpers/factories";

/**
 * Mobile authentication contract.
 *
 * The mobile client gets exactly the same authorization as the web client and
 * no more, so these tests are about proving the new door is not weaker than the
 * existing one.
 */

const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET!);

beforeEach(async () => {
  await resetDatabase();
});

describe("token issuance", () => {
  it("issues a usable access token and stores only a hash of the refresh token", async () => {
    const { alice } = await makeTwoUsers();
    const tokens = await issueTokens(alice.id, { name: "iPhone", installId: "install-abc123" });

    const claims = await verifyAccessToken(tokens.accessToken);
    expect(claims?.userId).toBe(alice.id);

    const stored = await db.refreshToken.findFirstOrThrow({ where: { userId: alice.id } });
    // The plaintext must never be recoverable from the database.
    expect(stored.tokenHash).not.toBe(tokens.refreshToken);
    expect(stored.tokenHash).toBe(hashToken(tokens.refreshToken));
    expect(stored.deviceName).toBe("iPhone");
  });

  it("rejects a tampered access token", async () => {
    const { alice } = await makeTwoUsers();
    const { accessToken } = await issueTokens(alice.id);
    const tampered = accessToken.slice(0, -4) + "aaaa";
    expect(await verifyAccessToken(tampered)).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const forged = await new SignJWT({ tokenId: "x" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("someone")
      .setIssuer("lifeos")
      .setAudience("lifeos-mobile")
      .setExpirationTime("15m")
      .sign(new TextEncoder().encode("a-completely-different-secret-value"));

    expect(await verifyAccessToken(forged)).toBeNull();
  });

  it("rejects a token with the wrong audience", async () => {
    // The web session JWT is signed with the SAME secret. Without an audience
    // check it would be replayable as a mobile access token.
    const webShaped = await new SignJWT({ tokenId: "x" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("some-user")
      .setIssuer("lifeos")
      .setAudience("lifeos-web")
      .setExpirationTime("15m")
      .sign(secret());

    expect(await verifyAccessToken(webShaped)).toBeNull();
  });

  it("rejects an expired access token", async () => {
    const expired = await new SignJWT({ tokenId: "x" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("some-user")
      .setIssuer("lifeos")
      .setAudience("lifeos-mobile")
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(secret());

    expect(await verifyAccessToken(expired)).toBeNull();
  });
});

describe("refresh", () => {
  it("exchanges a refresh token for a new access token", async () => {
    const { alice } = await makeTwoUsers();
    const first = await issueTokens(alice.id);
    const second = await refreshTokens(first.refreshToken);

    expect((await verifyAccessToken(second.accessToken))?.userId).toBe(alice.id);
    // Not rotated, on purpose — a dropped response must not strand the client.
    expect(second.refreshToken).toBe(first.refreshToken);
  });

  it("records last use so stale devices are identifiable", async () => {
    const { alice } = await makeTwoUsers();
    const { refreshToken } = await issueTokens(alice.id);
    await refreshTokens(refreshToken);

    const stored = await db.refreshToken.findFirstOrThrow({ where: { userId: alice.id } });
    expect(stored.lastUsedAt).not.toBeNull();
  });

  it("rejects unknown, revoked and expired tokens identically", async () => {
    const { alice } = await makeTwoUsers();
    const { refreshToken } = await issueTokens(alice.id);
    await revokeRefreshToken(refreshToken);

    const expired = await issueTokens(alice.id);
    await db.refreshToken.updateMany({
      where: { tokenHash: hashToken(expired.refreshToken) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const messages: string[] = [];
    for (const token of ["totally-unknown-token-value-padding", refreshToken, expired.refreshToken]) {
      await refreshTokens(token).catch((e: AppError) => messages.push(e.message));
    }

    expect(messages).toHaveLength(3);
    // One message for all three: a distinct one would let a caller probe.
    expect(new Set(messages).size).toBe(1);
  });
});

describe("revocation", () => {
  it("revokes only the presented device", async () => {
    const { alice } = await makeTwoUsers();
    const phone = await issueTokens(alice.id, { name: "iPhone" });
    const tablet = await issueTokens(alice.id, { name: "iPad" });

    await revokeRefreshToken(phone.refreshToken);

    await expect(refreshTokens(phone.refreshToken)).rejects.toThrow(AppError);
    // Signing out on one device must not sign the others out.
    await expect(refreshTokens(tablet.refreshToken)).resolves.toBeTruthy();
  });

  it("is idempotent", async () => {
    const { alice } = await makeTwoUsers();
    const { refreshToken } = await issueTokens(alice.id);
    await revokeRefreshToken(refreshToken);
    await expect(revokeRefreshToken(refreshToken)).resolves.toBeUndefined();
  });

  it("can revoke everything for one user without touching another", async () => {
    const { alice, bob } = await makeTwoUsers();
    await issueTokens(alice.id);
    await issueTokens(alice.id);
    const bobToken = await issueTokens(bob.id);

    const count = await revokeAllForUser(alice.id);
    expect(count).toBe(2);
    await expect(refreshTokens(bobToken.refreshToken)).resolves.toBeTruthy();
  });
});

describe("authorization parity with the web client", () => {
  it("a bearer token grants access to that user's data only", async () => {
    const { alice, bob } = await makeTwoUsers();
    const aliceTask = await makeTask(alice.id, { title: "Alice private" });

    const bobTokens = await issueTokens(bob.id);
    const claims = await verifyAccessToken(bobTokens.accessToken);

    // The token resolves to Bob, and every repository call is scoped by that id,
    // so the existing isolation tests cover the rest.
    expect(claims?.userId).toBe(bob.id);
    expect(claims?.userId).not.toBe(alice.id);

    const visibleToBob = await db.task.count({ where: { id: aliceTask.id, userId: claims!.userId } });
    expect(visibleToBob).toBe(0);
  });

  it("deleting a user revokes their tokens and devices", async () => {
    const { alice } = await makeTwoUsers();
    const tokens = await issueTokens(alice.id, { installId: "install-xyz98765" });
    await db.device.create({
      data: { userId: alice.id, installId: "install-xyz98765", platform: "ios" },
    });

    await db.user.delete({ where: { id: alice.id } });

    expect(await db.refreshToken.count({ where: { userId: alice.id } })).toBe(0);
    expect(await db.device.count({ where: { userId: alice.id } })).toBe(0);
    await expect(refreshTokens(tokens.refreshToken)).rejects.toThrow(AppError);
  });
});

describe("idempotent execution", () => {
  const envelope = (actions: unknown[]) => JSON.stringify({ summary: "Test plan", actions });

  it("replays the stored result when the same key retries", async () => {
    const { alice } = await makeTwoUsers();
    const provider = new FakeProvider([envelope([{ type: "create_task", title: "Call Mom" }])]);
    const plan = await planCommand(alice.id, "remind me to call mom", provider);

    const first = await executePlan(alice.id, plan.planId!, false, "key-abc12345");
    // A dropped response, then the client retries with the same key.
    const replay = await executePlan(alice.id, plan.planId!, false, "key-abc12345");

    expect(replay.executed).toBe(first.executed);
    expect(replay.created[0]?.id).toBe(first.created[0]?.id);
    // Crucially, the work happened exactly once.
    expect(await db.task.count({ where: { userId: alice.id, title: "Call Mom" } })).toBe(1);
  });

  it("still refuses a genuine re-run with a different key", async () => {
    const { alice } = await makeTwoUsers();
    const provider = new FakeProvider([envelope([{ type: "create_task", title: "Once only" }])]);
    const plan = await planCommand(alice.id, "add once only", provider);

    await executePlan(alice.id, plan.planId!, false, "key-first0001");
    await expect(executePlan(alice.id, plan.planId!, false, "key-second002")).rejects.toThrow(
      AppError,
    );
    expect(await db.task.count({ where: { title: "Once only" } })).toBe(1);
  });

  it("does not let one user replay another user's plan", async () => {
    const { alice, bob } = await makeTwoUsers();
    const provider = new FakeProvider([envelope([{ type: "create_task", title: "Alice only" }])]);
    const plan = await planCommand(alice.id, "add alice only", provider);
    await executePlan(alice.id, plan.planId!, false, "shared-key-01");

    await expect(executePlan(bob.id, plan.planId!, false, "shared-key-01")).rejects.toMatchObject({
      status: 404,
    });
  });
});
