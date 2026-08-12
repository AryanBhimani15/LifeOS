import { requireUserId } from "@/lib/session";
import { getSettings } from "@/lib/repositories/settings";
import { SettingsForm } from "@/components/settings/SettingsForm";

export const metadata = { title: "LifeOS — Settings" };

export default async function SettingsPage() {
  const userId = await requireUserId();
  const settings = await getSettings(userId);

  return (
    <>
      <header className="topbar goals-topbar">
        <div>
          <p className="eyebrow">PREFERENCES</p>
          <h1>Settings</h1>
          <p className="goals-subtitle">How LifeOS behaves, and who it thinks you are.</p>
        </div>
      </header>

      <SettingsForm
        initial={{
          name: settings.name,
          email: settings.email,
          timezone: settings.timezone,
          weekStartsOn: settings.weekStartsOn,
          currency: settings.currency,
          palette: settings.palette,
          aiEnabled: settings.aiEnabled,
        }}
      />
    </>
  );
}
