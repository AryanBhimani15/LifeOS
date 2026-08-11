"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { loginAction, type FormState } from "../actions";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next") ?? "/today";
  const [state, formAction, pending] = useActionState<FormState, FormData>(loginAction, {});

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark">✦</span> LifeOS
        </div>
        <h1>Welcome back</h1>
        <p className="auth-sub">Sign in to your command center.</p>

        <form action={formAction} className="auth-form">
          <input type="hidden" name="next" value={next} />

          <label>
            <span>Email</span>
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              autoFocus
              placeholder="you@example.com"
            />
          </label>

          <label>
            <span>Password</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="••••••••••••"
            />
          </label>

          {state.error && (
            <p className="auth-error" role="alert">
              {state.error}
            </p>
          )}

          <button type="submit" className="auth-submit" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="auth-alt">
          No account yet? <Link href="/register">Create one</Link>
        </p>
      </div>
    </main>
  );
}
