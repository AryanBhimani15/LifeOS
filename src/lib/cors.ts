/**
 * Cross-origin access for browser-based clients.
 *
 * The native app needs none of this — CORS is a browser policy. It exists so the
 * Expo **web** build, served from :8081, can call the API on :3000 while you
 * test speech recognition on a laptop.
 *
 * Rules this deliberately follows:
 *
 *  - Never `Access-Control-Allow-Origin: *`. The echoed value is always a
 *    specific origin from the allowlist, so an arbitrary site cannot read
 *    responses.
 *  - Off in production unless CORS_ALLOWED_ORIGINS is set explicitly. A
 *    permissive default that survives to deployment is how this becomes a real
 *    vulnerability.
 *  - `Vary: Origin` on everything, so a cache cannot serve a response prepared
 *    for one origin to another.
 *  - Credentials are NOT allowed. This API authenticates browser clients with a
 *    Bearer token, which JavaScript attaches deliberately; allowing credentials
 *    would let cookies ride along automatically and reintroduce CSRF.
 */

const DEV_DEFAULTS = [
  "http://localhost:8081",
  "http://127.0.0.1:8081",
  "http://localhost:19006",
];

function allowedOrigins(): string[] {
  const configured = process.env.CORS_ALLOWED_ORIGINS?.split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  if (configured?.length) return configured;
  // Only development gets a default. Production must opt in.
  return process.env.NODE_ENV === "production" ? [] : DEV_DEFAULTS;
}

/** The origin to echo back, or null when the request must not be granted access. */
export function resolveAllowedOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null; // same-origin or a non-browser client

  const allowed = allowedOrigins();
  if (allowed.includes(origin)) return origin;

  // In development also accept the LAN address Expo prints, so testing from
  // another machine on the network does not need reconfiguring.
  if (process.env.NODE_ENV !== "production" && /^http:\/\/\d+\.\d+\.\d+\.\d+:(8081|19006)$/.test(origin)) {
    return origin;
  }
  return null;
}

export function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    // ngrok-skip-browser-warning is listed so a tunnelled browser client can
    // send it. ngrok's free tier serves an HTML interstitial for plain GETs,
    // which carries no CORS headers and so is blocked — POSTs escape it because
    // their preflight passes through. Allowing the header lets the client opt
    // out. Harmless anywhere else: servers ignore unknown request headers.
    "Access-Control-Allow-Headers": "Content-Type, Authorization, ngrok-skip-browser-warning",
    "Access-Control-Max-Age": "600",
  };
}

/** Preflight response. Returns null when the origin is not allowed. */
export function preflightResponse(request: Request): Response | null {
  const origin = resolveAllowedOrigin(request);
  if (!origin) return null;
  return new Response(null, {
    status: 204,
    headers: { ...corsHeaders(origin), Vary: "Origin, Access-Control-Request-Headers" },
  });
}
