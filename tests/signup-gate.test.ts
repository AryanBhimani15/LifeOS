import { afterEach, describe, expect, it } from "vitest";
import { inviteAccepted, invitesRequired } from "@/lib/signup";

/**
 * The invite gate.
 *
 * A deployment reached by URL alone is one forwarded message away from
 * strangers signing up into the same database as its owner. These tests pin
 * both halves of the rule: unset means open, set means the code has to match
 * exactly — no near misses, no empty string sneaking through.
 */

const original = process.env.SIGNUP_INVITE_CODE;

afterEach(() => {
  if (original === undefined) delete process.env.SIGNUP_INVITE_CODE;
  else process.env.SIGNUP_INVITE_CODE = original;
});

describe("when no code is configured", () => {
  it("is open, and accepts anything including nothing", () => {
    delete process.env.SIGNUP_INVITE_CODE;
    expect(invitesRequired()).toBe(false);
    expect(inviteAccepted(undefined)).toBe(true);
    expect(inviteAccepted("")).toBe(true);
    expect(inviteAccepted("whatever")).toBe(true);
  });

  /** Whitespace is not a configuration. */
  it("treats a blank code as no code", () => {
    process.env.SIGNUP_INVITE_CODE = "   ";
    expect(invitesRequired()).toBe(false);
    expect(inviteAccepted(undefined)).toBe(true);
  });
});

describe("when a code is configured", () => {
  it("accepts only the exact code", () => {
    process.env.SIGNUP_INVITE_CODE = "let-me-in-2026";
    expect(invitesRequired()).toBe(true);
    expect(inviteAccepted("let-me-in-2026")).toBe(true);
    expect(inviteAccepted(" let-me-in-2026 ")).toBe(true); // trimmed
  });

  it("refuses anything else, including a prefix and an empty submission", () => {
    process.env.SIGNUP_INVITE_CODE = "let-me-in-2026";
    expect(inviteAccepted("let-me-in")).toBe(false);
    expect(inviteAccepted("let-me-in-2026-extra")).toBe(false);
    expect(inviteAccepted("LET-ME-IN-2026")).toBe(false);
    expect(inviteAccepted("")).toBe(false);
    expect(inviteAccepted(undefined)).toBe(false);
    expect(inviteAccepted(null)).toBe(false);
  });
});
