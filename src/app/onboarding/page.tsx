import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { getProfile } from "@/lib/repositories/fitness";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";

export const metadata = { title: "LifeOS — Set up" };

/**
 * The first screen a new account sees, and the way to change those answers later.
 *
 * Deliberately outside the `(app)` group: the sidebar, command bar and nav are
 * all noise during setup, and the layout in that group redirects here anyway,
 * which would be a loop.
 */
export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  const user = await getSessionUser();
  const profile = user.id ? await getProfile(user.id) : null;
  const editing = (await searchParams).edit === "1";

  // Nothing to set up twice. Someone who lands here with a finished profile is
  // sent on, unless they asked to change it.
  if (profile?.completedAt && !editing) redirect("/fitness");

  return (
    <OnboardingFlow
      // Their own answer wins over the name on the account: it is the one they
      // chose to be greeted by.
      suggestedName={profile?.firstName ?? (user.name ?? "").trim().split(/\s+/)[0] ?? ""}
      existing={
        profile
          ? {
              age: profile.age,
              sex: profile.sex,
              heightMm: profile.heightMm,
              heightUnit: profile.heightUnit,
              weightGrams: profile.weightGrams,
              weightUnit: profile.weightUnit,
              activityLevel: profile.activityLevel,
              lifeContext: profile.lifeContext,
              primaryGoal: profile.primaryGoal,
            }
          : null
      }
    />
  );
}
