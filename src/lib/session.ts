import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

/**
 * Session access for Server Components and Server Actions.
 *
 * This is the authorization entry point for everything that is not an API
 * route — the counterpart to `defineRoute` in src/lib/api.ts. A page or action
 * that calls this cannot render or run without a real session.
 *
 * `src/proxy.ts` also redirects signed-out users, but that check only looks for
 * a cookie's presence and is not a security control. This one resolves and
 * verifies the session properly, and it is what actually protects the data.
 */

export async function getUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

/** Redirects to /login when there is no valid session. Never returns null. */
export async function requireUserId(): Promise<string> {
  const userId = await getUserId();
  if (!userId) redirect("/login");
  return userId;
}

export async function getSessionUser() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session.user;
}
