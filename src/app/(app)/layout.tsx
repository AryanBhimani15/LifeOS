import { requireUserId } from "@/lib/session";
import { AppShell } from "@/components/AppShell";

/**
 * Layout for every signed-in route.
 *
 * `requireUserId` runs before any child renders, so no page in this group can
 * be reached without a verified session. `src/proxy.ts` also redirects, but it
 * only checks that a cookie exists — this is the check that actually holds.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  await requireUserId();
  return <AppShell>{children}</AppShell>;
}
