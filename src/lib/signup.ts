import { timingSafeEqual } from "node:crypto";

/**
 * Who is allowed to create an account.
 *
 * LifeOS holds someone's tasks, notes, journal and money. A deployment reached
 * by URL alone is one forwarded message away from strangers signing up into the
 * same database, so `SIGNUP_INVITE_CODE` gates registration to people who were
 * actually invited.
 *
 * Unset means open, which keeps local development and a genuinely public
 * instance working unchanged. The decision is the operator's; what this file
 * refuses to do is make it silently.
 */

export function invitesRequired(): boolean {
  return Boolean(process.env.SIGNUP_INVITE_CODE?.trim());
}

/**
 * Compared in constant time.
 *
 * A short code checked with `===` leaks its length and its matching prefix
 * through timing. It is a small risk for a two-person deployment and a free one
 * to remove.
 */
export function inviteAccepted(supplied: string | undefined | null): boolean {
  const expected = process.env.SIGNUP_INVITE_CODE?.trim();
  if (!expected) return true;

  const given = Buffer.from((supplied ?? "").trim());
  const target = Buffer.from(expected);
  if (given.length !== target.length) return false;
  return timingSafeEqual(given, target);
}

export const INVITE_REJECTED = "That invite code is not valid.";
