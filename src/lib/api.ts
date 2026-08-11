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
 */

export function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

interface RouteContext {
  params: Promise<Record<string, string | string[]>>;
}

interface HandlerArgs<TBody, TQuery> {
  request: Request;
  userId: string;
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

      if (requireAuth) {
        const session = await auth();
        if (!session?.user?.id) throw unauthenticated();
        userId = session.user.id;
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

      const result = await options.handler({ request, userId, body, query, params });
      return result instanceof Response ? result : json(result ?? { ok: true });
    } catch (error) {
      if (error instanceof AppError) return errorResponse(error);

      // Anything unrecognised is a bug. Log the detail server-side; tell the
      // client nothing beyond "something went wrong".
      console.error("[api] unhandled error", {
        url: request.url,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return errorResponse(internal());
    }
  };
}
