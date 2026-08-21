"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { updateSettingsAction } from "@/app/(app)/settings/actions";
import { useToast } from "@/components/ToastProvider";
import { NotificationStatus } from "@/components/settings/NotificationStatus";

/**
 * Settings.
 *
 * Every control here changes something observable. The columns that exist but
 * nothing reads — reduced motion, the email digest — are deliberately absent
 * rather than rendered as switches that quietly do nothing.
 */

export interface SettingsValues {
  name: string;
  email: string;
  timezone: string;
  weekStartsOn: number;
  currency: string;
  palette: string;
  aiEnabled: boolean;
}

const WEEK_STARTS = [
  { value: 1, label: "Monday" },
  { value: 0, label: "Sunday" },
  { value: 6, label: "Saturday" },
];

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD", "JPY"];

const PALETTES = [
  { value: "rose", label: "Blush", hint: "Pink, like the Home screen." },
  { value: "blue", label: "Azure", hint: "The same design, rotated to blue." },
  { value: "forest", label: "Forest", hint: "Deep green, warmer paper." },
];

/** Every zone the runtime knows, with a fallback for older browsers. */
function timezones(current: string): string[] {
  const supported =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : ["UTC", "Asia/Kolkata", "Europe/London", "America/New_York"];
  return supported.includes(current) ? supported : [current, ...supported];
}

export function SettingsForm({ initial }: { initial: SettingsValues }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState(initial);

  const zones = useMemo(() => timezones(initial.timezone), [initial.timezone]);
  const dirty = useMemo(
    () => (Object.keys(form) as (keyof SettingsValues)[]).some((key) => form[key] !== initial[key]),
    [form, initial],
  );

  const set = <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  /** A preview of what the timezone actually means, so it can be sanity-checked. */
  const localNow = useMemo(() => {
    try {
      return new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: form.timezone,
      }).format(new Date());
    } catch {
      return null;
    }
  }, [form.timezone]);

  function save(event: React.FormEvent) {
    event.preventDefault();
    if (pending || !dirty) return;

    startTransition(async () => {
      const result = await updateSettingsAction({
        name: form.name,
        timezone: form.timezone,
        weekStartsOn: form.weekStartsOn,
        currency: form.currency,
        palette: form.palette,
        aiEnabled: form.aiEnabled,
      });

      if (result.error) {
        setError(result.error);
        return;
      }
      setError(null);
      setSaved(true);
      toast("Settings saved.");
      router.refresh();
    });
  }

  return (
    <form className="settings-form" onSubmit={save}>
      <section className="goal-panel">
        <header>
          <h2>You</h2>
        </header>
        <div className="goal-field-row">
          <label className="goal-field">
            <span>Display name</span>
            <input
              value={form.name}
              onChange={(event) => set("name", event.target.value)}
              placeholder="Your name"
              maxLength={80}
            />
          </label>
          <label className="goal-field">
            <span>Email</span>
            {/* Read-only: changing the address someone signs in with needs a
                verification flow, and this app has no email delivery. */}
            <input value={form.email} readOnly disabled />
          </label>
        </div>
        <p className="settings-note">
          Your email is what you sign in with. Changing it needs a verification email, which
          LifeOS cannot send yet.
        </p>
      </section>

      <section className="goal-panel">
        <header>
          <h2>Dates and money</h2>
        </header>

        <div className="goal-field-row">
          <label className="goal-field">
            <span>Time zone</span>
            <select
              value={form.timezone}
              onChange={(event) => set("timezone", event.target.value)}
            >
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="goal-field">
            <span>Week starts on</span>
            <select
              value={form.weekStartsOn}
              onChange={(event) => set("weekStartsOn", Number(event.target.value))}
            >
              {WEEK_STARTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {localNow && (
          <p className="settings-note">
            It is <b>{localNow}</b> there. This decides which day a habit tick lands on and
            where a weekly streak begins.
          </p>
        )}

        <label className="goal-field settings-narrow">
          <span>Currency</span>
          <select value={form.currency} onChange={(event) => set("currency", event.target.value)}>
            {(CURRENCIES.includes(form.currency)
              ? CURRENCIES
              : [form.currency, ...CURRENCIES]
            ).map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="goal-panel">
        <header>
          <h2>Appearance</h2>
        </header>
        <div className="goal-field">
          <span>Palette</span>
          <div className="goal-mode-picker settings-palettes">
            {PALETTES.map((option) => (
              <button
                type="button"
                key={option.value}
                className={form.palette === option.value ? "is-selected" : ""}
                aria-pressed={form.palette === option.value}
                onClick={() => set("palette", option.value)}
              >
                <b>{option.label}</b>
                <em>{option.hint}</em>
                <i className={`settings-swatch is-${option.value}`} />
              </button>
            ))}
          </div>
        </div>
        <p className="settings-note">
          Light and dark live in the switch at the top of every page.
        </p>
      </section>

      <section className="goal-panel">
        <header>
          <h2>AI</h2>
        </header>
        <label className="settings-switch">
          <input
            type="checkbox"
            checked={form.aiEnabled}
            onChange={(event) => set("aiEnabled", event.target.checked)}
          />
          <span>
            <b>Allow AI commands</b>
            <em>
              When off, the command bar refuses AI requests outright rather than sending
              anything anywhere.
            </em>
          </span>
        </label>
      </section>

      <NotificationStatus />

      {error && (
        <p className="goal-form-error" role="alert">
          {error}
        </p>
      )}

      <div className="settings-actions">
        <button type="submit" className="goal-primary-button" disabled={pending || !dirty}>
          {pending ? <Loader2 size={15} className="spin" /> : saved ? <Check size={15} /> : null}
          {pending ? "Saving…" : saved && !dirty ? "Saved" : "Save changes"}
        </button>
        {dirty && !pending && <span className="settings-dirty">Unsaved changes</span>}
      </div>
    </form>
  );
}
