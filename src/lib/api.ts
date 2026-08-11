import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  AppError,
  badRequest,
  internal,
  rateLimited,
  unauthenticated,
  validationFailed,
} from "@/lib/errors";
import { consumeRateLimit, type RateLimitOptions } from "@/lib/rate-limit";
import { verifyAccessToken } from "@/lib/mobile-auth";
import { corsHeaders, resolveAllowedOrigin } from "@/lib/cors";

/**
 * The single entry point for every API route.
 *
 * Authentication, rate limiting, body validation and error mapping all happen
 * here so an individual route cannot forget one. A route that needs the signed
 * in user receives it as an argument; there is no way to write a handler that
 * accidentally runs unauthenticated while declaring `auth: true`.
 *
 * Error mapping is the security-relevant part: AppError instances carry
 * client-safe messages and are returned as-is, while anything else becomes a
 * generic 500. A Prisma error, a stack trace, or a connection string can never
 * reach a client through this path.
 *
 * Two authentication methods are accepted: an Auth.js session cookie (web) and
 * an `Authorization: Bearer` access token (mobile). Both resolve to a plain
 * userId before the handler runs, so nothing downstream branches on which was
 * used and there is only one authorization path to audit.
 */

export function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

interface RouteContext {
  params: Promise<Record<string, string | string[]>>;
}

export type AuthMethod = "cookie" | "bearer" | "none";

interface HandlerArgs<TBody, TQuery> {
  request: Request;
  userId: string;
  /** Which credential proved the identity. For auditing, never for access decisions. */
  authMethod: AuthMethod;
  body: TBody;
  query: TQuery;
  params: Record<string, string | string[]>;
}

interface RouteOptions<TBody, TQuery> {
  /** Defaults to true. Only auth-free endpoints (register) may set this false. */
  auth?: boolean;
  rateLimit?: RateLimitOptions;
  /**
   * A second, finer limit applied AFTER the body is validated, keyed on
   * something inside it (an email, say).
   *
   * Anonymous endpoints cannot identify a caller before parsing, and the coarse
   * pre-parse bucket is shared, so it must stay generous or a handful of junk
   * requests locks out every legitimate one. This is where the real per-actor
   * limit belongs.
   */
  identityRateLimit?: {
    options: RateLimitOptions;
    key: (body: TBody) => string | null;
  };
  body?: z.ZodType<TBody>;
  query?: z.ZodType<TQuery>;
  handler: (args: HandlerArgs<TBody, TQuery>) => Promise<Response | unknown>;
}

/**
 * Client address for anonymous rate limiting.
 *
 * X-Forwarded-For is attacker-controlled unless a trusted proxy overwrites it:
 * a client can simply send its own header and get a fresh quota per request,
 * which defeats rate limiting on the endpoints that need it most (signup runs
 * bcrypt). It is therefore only consulted when TRUST_PROXY_HEADERS is on,
 * which an operator sets once they have a proxy that actually rewrites it.
 *
 * When untrusted, every anonymous request shares one bucket. That is
 * deliberately conservative: a shared limit that holds beats a per-IP limit
 * that anyone can sidestep.
 */
const TRUST_PROXY = process.env.TRUST_PROXY_HEADERS === "true";

function clientIp(request: Request): string {
  if (!TRUST_PROXY) return "anonymous";
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

/**
 * Responses vary by BOTH credentials.
 *
 * Without this, a cache keyed only on URL can serve one user's response to
 * another: a mobile request authenticated by header looks identical to an
 * unauthenticated one to any intermediary that ignores the Authorization header.
 */
const VARY = "Authorization, Cookie, Origin";

/**
 * Applies the Vary header and, for an allowed browser origin, the CORS headers.
 * Origin is part of Vary so a cache cannot hand a response prepared for one
 * origin to another.
 */
function finalize(response: Response, request: Request): Response {
  response.headers.set("Vary", VARY);
  const origin = resolveAllowedOrigin(request);
  for (const [k, v] of Object.entries(corsHeaders(origin))) response.headers.set(k, v);
  return response;
}

/** Resolves the caller from a bearer token, falling back to a session cookie. */
async function resolveUser(request: Request): Promise<{ userId: string; method: AuthMethod }> {
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    const claims = await verifyAccessToken(header.slice(7).trim());
    if (!claims) throw unauthenticated("Your session has expired. Please sign in again.");
    return { userId: claims.userId, method: "bearer" };
  }

  const session = await auth();
  if (!session?.user?.id) throw unauthenticated();
  return { userId: session.user.id, method: "cookie" };
}

function errorResponse(error: AppError) {
  return Response.json(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    },
    {
      status: error.status,
      headers:
        error.code === "RATE_LIMITED"
          ? {
              "Retry-After": String(
                (error.details as { retryAfterSeconds: number }).retryAfterSeconds,
              ),
            }
          : undefined,
    },
  );
}

export function defineRoute<TBody = undefined, TQuery = undefined>(
  options: RouteOptions<TBody, TQuery>,
) {
  const requireAuth = options.auth !== false;

  return async function handle(request: Request, context?: RouteContext) {
    try {
      let userId = "";
      let authMethod: AuthMethod = "none";

      if (requireAuth) {
        const resolved = await resolveUser(request);
        userId = resolved.userId;
        authMethod = resolved.method;
      }

      const path = new URL(request.url).pathname;

      if (options.rateLimit) {
        // Authenticated traffic is keyed per user, which is both accurate and
        // unspoofable. Anonymous traffic falls back to the shared bucket.
        const key = `${path}:${userId || clientIp(request)}`;
        const result = await consumeRateLimit(key, options.rateLimit);
        if (!result.allowed) throw rateLimited(result.retryAfterSeconds);
      }

      let body = undefined as TBody;
      if (options.body) {
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          throw badRequest("Request body must be valid JSON");
        }
        const parsed = options.body.safeParse(raw);
        if (!parsed.success) throw validationFailed(z.treeifyError(parsed.error));
        body = parsed.data;
      }

      if (options.identityRateLimit) {
        const identity = options.identityRateLimit.key(body);
        if (identity) {
          const result = await consumeRateLimit(
            `${path}:id:${identity}`,
            options.identityRateLimit.options,
          );
          if (!result.allowed) throw rateLimited(result.retryAfterSeconds);
        }
      }

      let query = undefined as TQuery;
      if (options.query) {
        const raw = Object.fromEntries(new URL(request.url).searchParams);
        const parsed = options.query.safeParse(raw);
        if (!parsed.success) throw validationFailed(z.treeifyError(parsed.error));
        query = parsed.data;
      }

      // Next.js 16: route params are a Promise and must be awaited.
      const params = context ? await context.params : {};

      const result = await options.handler({ request, userId, authMethod, body, query, params });
      return finalize(result instanceof Response ? result : json(result ?? { ok: true }), request);
    } catch (error) {
      if (error instanceof AppError) return finalize(errorResponse(error), request);

      // Anything unrecognised is a bug. Log the detail server-side; tell the
      // client nothing beyond "something went wrong".
      //
      // Logged as a flat string rather than an object: Next's dev logger
      // serialises nested objects to "{}", which turns every 500 into an
      // unreadable dead end.
      const detail =
        error instanceof Error
          ? `${error.name}: ${error.message}\n${error.stack ?? ""}`
          : `non-Error thrown: ${JSON.stringify(error)}`;
      console.error(`[api] unhandled error at ${new URL(request.url).pathname}\n${detail}`);
      return finalize(errorResponse(internal()), request);
    }
  };
}
