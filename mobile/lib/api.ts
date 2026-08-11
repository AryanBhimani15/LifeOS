import Constants from "expo-constants";
import {
  clearTokens,
  getAccessToken,
  getInstallId,
  getRefreshToken,
  saveAccessToken,
  saveTokens,
} from "./auth";
import { markSignedIn, markSignedOut } from "./session-store";
import type {
  ApiErrorBody,
  ExecutionOutcome,
  LoginResponse,
  MeResponse,
  Plan,
} from "./types";

/**
 * The only place this app talks to LifeOS.
 *
 * It is a transport, not a brain: it attaches credentials, refreshes an expired
 * access token once, and surfaces typed errors. Every decision about what a
 * command means, whether it is destructive, and which rows it touches is made
 * by the server. Adding a rule here would mean two implementations to keep in
 * step, and the mobile one would be the stale one.
 */

/**
 * Resolved from app config so a simulator can hit a laptop over the LAN.
 * `localhost` inside the iOS simulator refers to the simulator itself, which is
 * the single most common reason a first run appears to hang.
 */
export const API_BASE_URL: string =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
  process.env.EXPO_PUBLIC_API_URL ??
  "http://localhost:3000";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Thrown when the refresh token is gone or rejected; the UI must sign out. */
export class SessionExpiredError extends ApiError {
  constructor() {
    super(
      "SESSION_EXPIRED",
      "Your session has expired. Please sign in again.",
      401,
    );
    this.name = "SessionExpiredError";
  }
}

async function parse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // A non-JSON body means something upstream answered instead of the API —
    // a proxy, a captive portal, or the wrong base URL entirely.
    throw new ApiError(
      "BAD_RESPONSE",
      "The server sent something unexpected. Check the API address.",
      response.status,
    );
  }

  if (!response.ok) {
    const err = (body as ApiErrorBody)?.error;
    throw new ApiError(
      err?.code ?? "UNKNOWN",
      err?.message ?? "Something went wrong.",
      response.status,
      err?.details,
    );
  }
  return body as T;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Set for endpoints that authenticate with the refresh token itself. */
  skipAuth?: boolean;
  signal?: AbortSignal;
}

/**
 * Refreshes the access token, de-duplicated.
 *
 * Several requests can 401 at once when a token expires mid-screen; without a
 * shared promise each would fire its own refresh, and with rotation enabled
 * they would invalidate one another. Rotation is off server-side, but sharing
 * still avoids a thundering herd.
 */
let refreshInFlight: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = await getRefreshToken();
    if (!refreshToken) throw new SessionExpiredError();

    const response = await fetch(`${API_BASE_URL}/api/mobile/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      await clearTokens();
      markSignedOut();
      throw new SessionExpiredError();
    }

    const tokens = (await response.json()) as { accessToken: string };
    await saveAccessToken(tokens.accessToken);
    return tokens.accessToken;
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

/**
 * ngrok's free tier answers plain GET requests with an HTML interstitial that
 * carries no CORS headers, so a browser blocks them — POSTs escape it because
 * their preflight passes through. This header opts out.
 *
 * Sent only for ngrok hosts: it means nothing elsewhere and has no business on
 * production traffic. The server allows it in Access-Control-Allow-Headers,
 * which is required because adding it makes an otherwise simple GET preflighted.
 */
const TUNNEL_HEADERS: Record<string, string> = /ngrok/i.test(API_BASE_URL)
  ? { "ngrok-skip-browser-warning": "1" }
  : {};

async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const send = async (token: string | null) =>
    fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...TUNNEL_HEADERS,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });

  if (options.skipAuth) return parse<T>(await send(null));

  const token = await getAccessToken();
  let response = await send(token);

  // One retry, only on 401, only if a refresh token exists. Retrying more would
  // turn a revoked session into a loop.
  if (response.status === 401) {
    const fresh = await refreshAccessToken();
    response = await send(fresh);
  }

  return parse<T>(response);
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export async function login(
  email: string,
  password: string,
  deviceName: string,
) {
  const installId = await getInstallId();
  const result = await request<LoginResponse>("/api/mobile/auth/login", {
    method: "POST",
    skipAuth: true,
    body: {
      email,
      password,
      device: { name: deviceName, installId, platform: "ios" },
    },
  });
  await saveTokens(result, result.user);
  // Publish so the auth gate re-evaluates; without this the gate keeps its
  // mount-time answer and bounces a freshly signed-in user back to /login.
  markSignedIn();
  return result;
}

export async function logout() {
  const refreshToken = await getRefreshToken();
  if (refreshToken) {
    // Best effort: a failed revoke must not trap the user in a signed-in shell.
    await request("/api/mobile/auth/revoke", {
      method: "POST",
      skipAuth: true,
      body: { refreshToken },
    }).catch(() => undefined);
  }
  await clearTokens();
  markSignedOut();
}

export const fetchMe = () => request<MeResponse>("/api/mobile/me");

/** Turns a spoken sentence into a plan. Never mutates. */
export const planCommand = (input: string, signal?: AbortSignal) =>
  request<Plan>("/api/ai/command", { method: "POST", body: { input }, signal });

/**
 * Runs a plan.
 *
 * `idempotencyKey` matters most here: mobile networks drop responses, and
 * without it a retry reports failure for work that succeeded.
 */
export const executePlan = (
  planId: string,
  confirmed: boolean,
  idempotencyKey: string,
) =>
  request<ExecutionOutcome>(`/api/ai/plans/${planId}/execute`, {
    method: "POST",
    body: { confirmed, idempotencyKey },
  });

export const rejectPlan = (planId: string) =>
  request<{ ok: true }>(`/api/ai/plans/${planId}/reject`, { method: "POST" });

export async function registerDevice(
  pushToken: string | null,
  appVersion?: string,
) {
  const installId = await getInstallId();
  return request<{ pushDeliveryEnabled: boolean }>("/api/mobile/devices", {
    method: "POST",
    body: { installId, platform: "ios", pushToken, appVersion },
  });
}

/** Random enough to distinguish retries of one confirmation from a new one. */
export function newIdempotencyKey(): string {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
