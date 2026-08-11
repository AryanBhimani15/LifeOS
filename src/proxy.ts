import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Route protection at the edge of the app.
 *
 * Next.js 16 renamed `middleware` to `proxy`; the runtime is always nodejs and
 * cannot be configured.
 *
 * IMPORTANT: this is a redirect convenience, NOT an authorization control. It
 * only checks that a session cookie is present — it does not verify the
 * signature, and a forged cookie would pass. Real enforcement lives in
 * `defineRoute` (401 without a valid session) and in the per-query `userId`
 * scoping in the repositories. Treat this file as UX, never as security.
 */

const PUBLIC_PATHS = ["/", "/login", "/register"];

/**
 * Auth.js v5 names the session cookie `authjs.session-token`, prefixed with
 * `__Secure-` when served over HTTPS.
 */
const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // API routes must never be redirected. They authenticate themselves in
  // `defineRoute` and answer with 401 JSON; redirecting them to an HTML login
  // page hands `fetch` a document where it expects JSON, so the client sees a
  // parse error instead of "you are signed out".
  if (pathname.startsWith("/api/")) return NextResponse.next();

  const isPublic =
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon");

  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));

  if (!isPublic && !hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Preserve where they were heading so login can send them back.
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  // Signed-in users have no reason to see the auth screens.
  if (hasSession && (pathname === "/login" || pathname === "/register")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except static assets and image optimisation.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
