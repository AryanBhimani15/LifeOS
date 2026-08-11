import { beforeAll, describe, expect, it } from "vitest";
import {
  ApiError,
  executePlan,
  fetchMe,
  login,
  logout,
  newIdempotencyKey,
  planCommand,
  registerDevice,
} from "../lib/api";
import { getAccessToken, getRefreshToken, saveAccessToken } from "../lib/auth";

/**
 * Integration tests for the mobile API client.
 *
 * These run the client's REAL code against a REAL running LifeOS server — only
 * the iOS Keychain is stubbed. A mocked server would only prove my mock matches
 * my assumptions, which is the bug class these exist to catch.
 *
 * Sign-in happens ONCE. The server throttles authentication to 8 attempts per
 * 15 minutes per email address, and a test that logs in per case exhausts that
 * and then fails for the wrong reason. Reusing one session is also closer to how
 * the app behaves — it signs in once and refreshes thereafter.
 *
 * Requires the server running (`npm run dev`) and `npm run db:seed`.
 */

const BASE = process.env.LIFEOS_API ?? "http://localhost:3000";
const PASSWORD = "vitest-throwaway-password";

/**
 * A fresh account per run.
 *
 * Sign-in is throttled to 8 attempts per 15 minutes PER EMAIL, so a suite tied
 * to one fixed account fails on its second run of the day for a reason that has
 * nothing to do with the code. A new address each run gets its own budget and
 * makes the suite repeatable.
 */
const EMAIL = `vitest-${Date.now()}@example.test`;

beforeAll(async () => {
  const reachable = await fetch(`${BASE}/login`).then(
    (r) => r.ok,
    () => false,
  );
  if (!reachable) throw new Error(`LifeOS is not running at ${BASE}. Start it with: npm run dev`);

  const registered = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Vitest",
      email: EMAIL,
      password: PASSWORD,
      timezone: "Europe/London",
    }),
  });
  if (!registered.ok) {
    throw new Error(`Could not create a test account: ${registered.status} ${await registered.text()}`);
  }

  await login(EMAIL, PASSWORD, "vitest");
}, 60_000);

describe("authentication", () => {
  it("stores both tokens after signing in", async () => {
    expect(await getAccessToken()).toBeTruthy();
    expect(await getRefreshToken()).toBeTruthy();
  });

  it("refreshes automatically when the access token is stale", async () => {
    // Simulate an expired access token while the refresh token stays valid.
    // A correct client recovers without the caller noticing.
    await saveAccessToken("clearly.not.a.valid.token");

    const me = await fetchMe();
    expect(me.user.email).toBe(EMAIL);
    expect(await getAccessToken()).not.toBe("clearly.not.a.valid.token");
  });

  it("rejects a wrong password", async () => {
    // A distinct address so this does not spend the demo account's login budget.
    await expect(
      login(`nobody-${Date.now()}@example.test`, "definitely-not-right", "vitest"),
    ).rejects.toThrow(ApiError);
  });
});

describe("bootstrap", () => {
  it("returns identity and the timezone the server plans in", async () => {
    const me = await fetchMe();
    expect(me.authMethod).toBe("bearer");
    expect(typeof me.timezone).toBe("string");
    expect(me.counts).toHaveProperty("overdue");
  });

  it("registers a device and is told push is not actually enabled", async () => {
    const result = await registerDevice("ExponentPushToken[test]", "1.0.0");
    // The server says so plainly so a client cannot mistake registration for
    // delivery. Asserting it keeps that honesty from silently regressing.
    expect(result.pushDeliveryEnabled).toBe(false);
  });
});

describe("command pipeline", () => {
  /**
   * These call a live model, so they assert what the CLIENT must do, not what
   * the model must say. Whether the pipeline turns a given sentence into the
   * right actions is covered deterministically server-side with a fake provider;
   * duplicating that here would just import the model's flakiness into the
   * mobile suite.
   */
  it("plans a command, or surfaces a typed error if the model misbehaves", async () => {
    try {
      const plan = await planCommand("create a task to water the plants");
      expect(plan.summary).toBeTruthy();
      if (plan.planId) expect(Array.isArray(plan.actions)).toBe(true);
    } catch (e) {
      // A rejected plan is the schema guard working. What matters here is that
      // the client turned it into a typed error rather than crashing.
      expect(e).toBeInstanceOf(ApiError);
      expect(["AI_UNAVAILABLE", "RATE_LIMITED"]).toContain((e as ApiError).code);
    }
  }, 60_000);

  it("executes a plan and replays on retry with the same key", async () => {
    const plan = await planCommand("create a task called vitest smoke check").catch(
      () => null,
    );
    if (!plan?.planId) return; // model hiccup, declined, or ambiguous

    const key = newIdempotencyKey();
    const first = await executePlan(plan.planId, plan.needsConfirm, key);
    const replay = await executePlan(plan.planId, plan.needsConfirm, key);

    // A dropped response must not read as failure for work that succeeded.
    expect(replay.executed).toBe(first.executed);
    expect(replay.created[0]?.id).toBe(first.created[0]?.id);
  }, 90_000);
});

describe("sign out", () => {
  // Last, because it deliberately destroys the shared session.
  it("clears credentials and then refuses authenticated calls", async () => {
    await logout();

    expect(await getAccessToken()).toBeNull();
    expect(await getRefreshToken()).toBeNull();

    // No credentials at all: the client must surface a typed error rather than
    // looping on refresh forever.
    await expect(fetchMe()).rejects.toThrow(ApiError);
  });
});
