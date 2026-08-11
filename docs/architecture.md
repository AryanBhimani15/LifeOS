# Architecture

## Stack

| Layer | Choice | Note |
|---|---|---|
| Framework | Next.js 16 (App Router) | `middleware` is renamed `proxy`; request APIs are async-only |
| Language | TypeScript (strict) | |
| Database | PostgreSQL 14+ | |
| ORM | Prisma 7 | URL comes from `prisma.config.ts` + a `pg` driver adapter, not the schema |
| Auth | Auth.js v5 | JWT sessions, required by the Credentials provider |
| Validation | Zod 4 | Every body and query string |
| Tests | Vitest | Integration tests run serially against a real Postgres |
| AI | Google Gemini via REST | Behind an `AiProvider` interface |

## Layers

```
  HTTP route  (src/app/api/**/route.ts)
      │        thin: names a schema and calls a repository
      ▼
  defineRoute (src/lib/api.ts)
      │        auth → rate limit → validate → dispatch → map errors
      ▼
  Repository  (src/lib/repositories/**)
      │        userId scoping + foreign-key ownership checks
      ▼
  Prisma      (src/lib/db.ts)
      │
      ▼
  PostgreSQL  constraints the application cannot bypass
```

Each layer assumes the one above it may be wrong. Route handlers cannot skip
authentication, because `defineRoute` performs it and hands the handler a
`userId` it did not choose. Repositories re-verify ownership even for ids the
planner already resolved. The database enforces integrity even if both fail.

## Request lifecycle

1. `src/proxy.ts` redirects signed-out users away from app routes. **Redirect
   convenience only — not an authorization control.**
2. `defineRoute` resolves the session and throws 401 without one.
3. Rate limiting, keyed per user when authenticated, per shared bucket otherwise.
4. Zod parses the body; a second identity-keyed rate limit may apply afterwards.
5. The handler runs with `{ userId, body, query, params }`.
6. Errors become responses in exactly one place, so internals cannot leak.

## Module map

| Path | Responsibility |
|---|---|
| `src/lib/api.ts` | The single route entry point |
| `src/lib/auth.ts` | Auth.js configuration |
| `src/lib/password.ts` | Hashing, kept free of Auth.js so tests can import it |
| `src/lib/authz.ts` | Foreign-key ownership enforcement |
| `src/lib/errors.ts` | Typed errors with client-safe messages |
| `src/lib/rate-limit.ts` | Two-stage limiting behind a swappable store |
| `src/lib/audit.ts` | Best-effort audit trail |
| `src/lib/dates.ts` | Calendar validation and timezone-aware day boundaries |
| `src/lib/money.ts` | Integer minor units |
| `src/lib/repositories/**` | Persistence, scoping, ownership |
| `src/lib/validation/**` | Zod schemas |
| `src/lib/ai/actions.ts` | The validated action union — the AI trust boundary |
| `src/lib/ai/provider.ts` | LLM abstraction + `FakeProvider` for tests |
| `src/lib/ai/resolver.ts` | Deterministic reference resolution |
| `src/lib/ai/planner.ts` | Parse → validate → resolve → persist a plan |
| `src/lib/ai/executor.ts` | Confirmation gate, atomic claim, transactional execution |
| `src/lib/ai/queries.ts` | Read-only answers, computed from the database |

## Why the AI is split into four modules

The boundary between untrusted model output and the database is the part most
worth keeping legible. Splitting parse, resolve, plan, and execute means each
step can be tested in isolation, and the confirmation gate lives in exactly one
place rather than being spread through request handling.
