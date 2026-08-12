"use client";

import { useActionState, useEffect, useRef } from "react";
import Link from "next/link";
import { registerAction, type FormState } from "@/app/(auth)/actions";

/**
 * The registration form.
 *
 * `inviteRequired` is resolved on the server so the field only appears on a
 * deployment that actually gates signups. Its presence is not the control —
 * the server checks the code regardless of what the form sends.
 */
export function RegisterForm({ inviteRequired }: { inviteRequired: boolean }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(registerAction, {});
  const timezoneRef = useRef<HTMLInputElement>(null);

  // Captured from the browser so recurrence and "today" land on the user's
  // calendar day rather than the server's. Written straight to the input rather
  // than into state: the DOM is the external system being synchronised, and
  // setState here would trigger a cascading render for a value nothing displays.
  useEffect(() => {
    if (timezoneRef.current) {
      timezoneRef.current.value = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    }
  }, []);

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark">✦</span> LifeOS
        </div>
        <h1>Create your account</h1>
        <p className="auth-sub">One place for everything you are working on.</p>

        <form action={formAction} className="auth-form">
          <input type="hidden" name="timezone" defaultValue="UTC" ref={timezoneRef} />

          <label>
            <span>Name</span>
            <input
              name="name"
              required
              autoFocus
              placeholder="Aryan"
              autoComplete="name"
              defaultValue={state.values?.name ?? ""}
            />
            <FieldError errors={state.fieldErrors?.name} />
          </label>

          <label>
            <span>Email</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              defaultValue={state.values?.email ?? ""}
            />
            <FieldError errors={state.fieldErrors?.email} />
          </label>

          <label>
            <span>Password</span>
            <input
              name="password"
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
              placeholder="At least 12 characters"
            />
            <FieldError errors={state.fieldErrors?.password} />
            <small className="auth-hint">
              {state.error
                ? "Type your password again — it is never sent back to the browser."
                : "12 characters minimum. Length matters more than symbols."}
            </small>
          </label>

          {inviteRequired && (
            <label>
              <span>Invite code</span>
              <input
                name="invite"
                required
                autoComplete="off"
                placeholder="From whoever invited you"
                defaultValue={state.values?.invite ?? ""}
              />
              <FieldError errors={state.fieldErrors?.invite} />
              <small className="auth-hint">
                This instance is invite-only. Ask the person who runs it for the code.
              </small>
            </label>
          )}

          {state.error && (
            <p className="auth-error" role="alert">
              {state.error}
            </p>
          )}

          <button type="submit" className="auth-submit" disabled={pending}>
            {pending ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="auth-alt">
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </div>
    </main>
  );
}

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return <small className="auth-field-error">{errors[0]}</small>;
}
