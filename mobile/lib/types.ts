/**
 * Shapes returned by the LifeOS API.
 *
 * These MIRROR the server contract — they do not define it. The server is the
 * source of truth for what an action means, which fields are destructive, and
 * how references resolve. Nothing here re-implements a rule; if a shape drifts,
 * the fix belongs on the server first.
 *
 * Kept hand-written rather than generated because the surface the mobile app
 * touches is deliberately tiny: plan, execute, me. A generator would be more
 * machinery than the four types below justify.
 */

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}

export interface LoginResponse extends AuthTokens {
  user: SessionUser;
}

export interface MeResponse {
  user: SessionUser;
  /** The zone the server interprets "tomorrow at 6pm" in. */
  timezone: string;
  aiEnabled: boolean;
  counts: { overdue: number; dueNext24h: number };
  authMethod: "cookie" | "bearer" | "none";
}

/** One step in a plan. The server decides what these mean. */
export interface PlanAction {
  type: string;
  title?: string;
  name?: string;
  description?: string;
  taskTitle?: string;
  dueAt?: string;
  priority?: string;
  amount?: number;
  currency?: string;
  subtasks?: string[];
  milestones?: { title: string }[];
  kind?: string;
}

export interface Ambiguity {
  query: string;
  candidates: { id: string; label: string }[];
}

export interface QueryAnswer {
  kind: string;
  headline: string;
  items: { id: string; label: string; detail?: string }[];
}

/**
 * The plan receipt.
 *
 * `planId === null` means nothing was planned — read `clarification`. That is
 * the server refusing to guess, which is a feature, not an error.
 */
export interface Plan {
  planId: string | null;
  summary: string;
  actions: PlanAction[];
  /** True when the plan deletes something. The server enforces this regardless. */
  needsConfirm: boolean;
  clarification?: string | null;
  ambiguities?: Ambiguity[] | null;
}

export interface ExecutionOutcome {
  executed: number;
  created: { type: string; id: string; label: string }[];
  notes: string[];
  answers: QueryAnswer[];
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
