"use client";

import type { BurnResult, HistoryEntry } from "@/lib/repositories/fitness";

/**
 * Browser-side client for the fitness endpoints.
 *
 * It exists so no component ever writes `fetch` inline. Two things happen here
 * that are easy to forget at a call site and awful to get wrong:
 *
 *  - Every failure becomes an Error carrying a message written for a person.
 *    The API already returns one; a network failure has none, so this supplies
 *    it. A component only has to render `error.message`.
 *
 *  - A non-JSON response (a proxy error page, an HTML redirect) is caught and
 *    reported as a problem rather than throwing a parse error nobody can act on.
 */

const GENERIC = "Something went wrong. Please try again.";
const OFFLINE = "Couldn't reach the server. Check your connection and try again.";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    });
  } catch {
    throw new Error(OFFLINE);
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Body was not JSON. On a failure that is expected; on a success it is a bug.
    if (response.ok) throw new Error(GENERIC);
  }

  if (!response.ok) {
    // A signed-out user cannot fix anything from here, and an inline "you must
    // be signed in" is a dead end — the page they are on is the one that no
    // longer works. Send them to the form that resolves it, remembering where
    // they were. Happens when a session outlives its account, or simply expires
    // in a tab left open overnight.
    //
    // A full page load rather than router.push: the credential backing every
    // cached RSC payload in this tab is invalid, and a client-side navigation
    // would carry that cache across. This is also a plain module rather than a
    // component, so there is no router to reach for.
    if (response.status === 401 && typeof window !== "undefined") {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = `/login?next=${next}`;
    }

    const message = (payload as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(message ?? GENERIC);
  }

  return payload as T;
}

/**
 * Saves the onboarding answers.
 *
 * This deliberately does not go through a Server Action. An action re-renders
 * the route it was called from, and this route redirects away as soon as the
 * profile is complete — so saving would navigate off the completion screen
 * before anyone saw it. A plain request has no such side effect.
 */
export interface SetupSummary {
  firstName: string;
  plan: { name: string; daysPerWeek: number; rationale: string; sessions: number } | null;
  goalsCreated: number;
  habitsCreated: number;
}

export function saveProfile(profile: unknown) {
  return request<SetupSummary>("/api/fitness/profile", {
    method: "PUT",
    body: JSON.stringify(profile),
  });
}

/** One tap: everything else comes from the plan. */
export function logPlannedSession(sessionId: string) {
  return request<{ activityName: string; durationMinutes: number; caloriesBurned: number }>(
    "/api/fitness/plan/log",
    { method: "POST", body: JSON.stringify({ sessionId }) },
  );
}

export interface DurationInput {
  hours: number;
  minutes: number;
}

export function calculateBurn(activityId: string, duration: DurationInput) {
  return request<BurnResult>("/api/fitness/calculate", {
    method: "POST",
    body: JSON.stringify({ activityId, duration }),
  });
}

export function saveWorkout(activityId: string, duration: DurationInput) {
  return request<HistoryEntry>("/api/fitness/history", {
    method: "POST",
    body: JSON.stringify({ activityId, duration }),
  });
}

export function deleteWorkout(id: string) {
  return request<{ ok: true }>(`/api/fitness/history/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
