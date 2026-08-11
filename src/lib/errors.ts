/**
 * Typed application errors.
 *
 * Every error carries an HTTP status and a client-safe message. The route
 * wrapper in src/lib/api.ts is the only place that turns these into responses,
 * so an internal error can never leak a stack trace or a database message to a
 * client by accident.
 */

export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION_FAILED"
  | "RATE_LIMITED"
  | "AI_UNAVAILABLE"
  | "AI_AMBIGUOUS"
  | "CONFIRMATION_REQUIRED"
  | "INTERNAL";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, status: number, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message = "Invalid request", details?: unknown) =>
  new AppError("BAD_REQUEST", 400, message, details);

export const unauthenticated = (message = "You must be signed in") =>
  new AppError("UNAUTHENTICATED", 401, message);

/**
 * Deliberately reported as 404, not 403.
 *
 * Returning 403 for a resource that belongs to another user confirms that the
 * id exists, which turns any list endpoint into an enumeration oracle. From an
 * unauthorized caller's perspective the resource does not exist.
 */
export const notFound = (what = "Resource") =>
  new AppError("NOT_FOUND", 404, `${what} not found`);

export const forbidden = (message = "Not allowed") =>
  new AppError("FORBIDDEN", 403, message);

export const conflict = (message: string, details?: unknown) =>
  new AppError("CONFLICT", 409, message, details);

export const validationFailed = (details: unknown, message = "Validation failed") =>
  new AppError("VALIDATION_FAILED", 422, message, details);

export const rateLimited = (retryAfterSeconds: number) =>
  new AppError("RATE_LIMITED", 429, "Too many requests. Please slow down.", {
    retryAfterSeconds,
  });

export const aiUnavailable = (message = "The AI service is unavailable right now") =>
  new AppError("AI_UNAVAILABLE", 503, message);

export const ambiguousReference = (details: unknown) =>
  new AppError(
    "AI_AMBIGUOUS",
    409,
    "That could refer to more than one item. Please pick one.",
    details,
  );

export const confirmationRequired = (details: unknown) =>
  new AppError(
    "CONFIRMATION_REQUIRED",
    409,
    "This action needs to be confirmed before it runs.",
    details,
  );

export const internal = (message = "Something went wrong") =>
  new AppError("INTERNAL", 500, message);
