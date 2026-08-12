import { redirect } from "next/navigation";
import { requireUserId } from "@/lib/session";
import { getProfile } from "@/lib/repositories/fitness";
import { AppShell } from "@/components/AppShell";

/**
 * Layout for every signed-in route.
 *
 * `requireUserId` runs before any child renders, so no page in this group can
 * be reached without a verified session. `src/proxy.ts` also redirects, but it
 * only checks that a cookie exists — this is the check that actually holds.
 *
 * Setup is enforced in the same place, for the same reason: doing it per-page
 * means the one page someone deep-links to is the one that forgot.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const userId = await requireUserId();
  const profile = await getProfile(userId);
  if (!profile?.completedAt) redirect("/onboarding");

  // Resolved on the server and rendered into the markup, so the tint is correct
  // on the first paint rather than flipping once the client hydrates.
  return (
    <AppShell palette={profile.sex === "FEMALE" ? "rose" : "forest"}>{children}</AppShell>
  );
}
