import { NotBuiltYet } from "@/components/NotBuiltYet";

export const metadata = { title: "LifeOS — Settings" };

export default function SettingsPage() {
  return (
    <NotBuiltYet
      title="Settings"
      what="Profile, theme, notifications, AI settings and data export"
      schemaReady="the user_settings table, created for every new account at signup"
    />
  );
}
