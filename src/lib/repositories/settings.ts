import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import {
  palette as paletteSchema,
  type Palette,
  type UpdateSettingsInput,
} from "@/lib/validation/settings";

/**
 * User settings.
 *
 * Every field here is read by something: the timezone decides which day a
 * habit tick lands on, the week start decides where a weekly streak begins,
 * the currency formats money, the palette tints the product and `aiEnabled`
 * is checked before any AI request is planned.
 *
 * Settings changes are audited. Someone finding their week suddenly starting on
 * Sunday should be able to see that they changed it, and when.
 */

export type Settings = Awaited<ReturnType<typeof getSettings>>;

const DEFAULTS = {
  theme: "system",
  palette: "rose",
  timezone: "UTC",
  weekStartsOn: 1,
  currency: "INR",
  aiEnabled: true,
} as const;

export async function getSettings(userId: string) {
  const [settings, user] = await Promise.all([
    db.userSettings.findUnique({
      where: { userId },
      select: {
        theme: true,
        palette: true,
        timezone: true,
        weekStartsOn: true,
        currency: true,
        aiEnabled: true,
      },
    }),
    db.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
  ]);

  return {
    ...DEFAULTS,
    ...(settings ?? {}),
    name: user?.name ?? "",
    email: user?.email ?? "",
  };
}

/**
 * Applies a partial update.
 *
 * `upsert` rather than `update`: a settings row is created at registration, but
 * an account that predates that (or one restored from an older backup) should
 * be able to set a timezone rather than hit a foreign-key error.
 */
export async function updateSettings(userId: string, patch: UpdateSettingsInput) {
  const { name, ...rest } = patch;

  if (name !== undefined) {
    await db.user.update({
      where: { id: userId },
      // An empty name is stored as null so the greeting falls back rather than
      // rendering "Good evening, ."
      data: { name: name.trim() || null },
    });
  }

  const fields = Object.fromEntries(
    Object.entries(rest).filter(([, value]) => value !== undefined),
  );

  if (Object.keys(fields).length > 0) {
    await db.userSettings.upsert({
      where: { userId },
      create: { userId, ...fields },
      update: fields,
    });
  }

  const changed = Object.keys(patch).filter(
    (key) => patch[key as keyof UpdateSettingsInput] !== undefined,
  );

  await recordAudit({
    userId,
    action: "SETTINGS_CHANGE",
    summary: `Updated settings: ${changed.join(", ") || "nothing"}`,
    entityType: "UserSettings",
    entityId: userId,
    // The keys, not the values: an audit log records that someone touched
    // their settings, not a second copy of what they contain.
    metadata: { changed },
  });

  return getSettings(userId);
}

/**
 * The palette the shell should render, resolved once on the server.
 *
 * A plain read of the stored choice. Setup seeds that choice — see
 * `completeOnboarding` — but nothing derives it at render time, so changing it
 * in Settings is the last word.
 */
export async function getPalette(userId: string): Promise<Palette> {
  const settings = await db.userSettings.findUnique({
    where: { userId },
    select: { palette: true },
  });
  // The column is a plain string, so it can hold a palette that has since been
  // removed, or nothing at all on an account that predates the setting.
  const stored = paletteSchema.safeParse(settings?.palette);
  return stored.success ? stored.data : "rose";
}
