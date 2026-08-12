import { redirect } from "next/navigation";
import { getUserId } from "@/lib/session";

/**
 * Layout for the signed-out screens.
 *
 * Sending an already-signed-in user away from the login form used to happen in
 * `src/proxy.ts`, which can only see that *a* cookie exists. A cookie naming a
 * deleted user passes that test, so the proxy bounced them to `/today`, the app
 * layout found no valid session and bounced them back — a redirect loop with no
 * way out except clearing cookies by hand.
 *
 * This runs the real session check, so a stale cookie simply lands on the login
 * form, which is the one page that can fix it.
 */
export default async function AuthLayout({ children }: LayoutProps<"/">) {
  if (await getUserId()) redirect("/today");
  return children;
}
