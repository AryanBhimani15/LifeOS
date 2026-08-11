# Development

## Prerequisites

- Node 20+ (developed on 25)
- PostgreSQL 14+ running locally
- Optional: a Gemini API key for AI features

## Setup

```bash
npm install
cp .env.example .env      # fill in DATABASE_URL, DATABASE_URL_TEST, AUTH_SECRET
createdb lifeos_dev && createdb lifeos_test
npm run db:migrate
npm run db:migrate:test
npm run dev
```

`AUTH_SECRET`: `openssl rand -base64 32`.

## Checks

Run all four before committing. CI-equivalent:

```bash
npm test          # 63 tests, needs lifeos_test
npm run typecheck
npm run lint
npm run build
```

## Testing

Integration tests run against a **real Postgres**, not a mock, because the
behaviour under test includes constraints, cascades, and transaction semantics
that a mock would not reproduce.

`tests/setup.ts` refuses to run unless `DATABASE_URL_TEST` names a database
ending in `_test`, so a misconfiguration cannot truncate development data.
Files run serially (`fileParallelism: false`) since they share one database.

| File | Covers |
|---|---|
| `tests/authz.test.ts` | Cross-user isolation |
| `tests/ai.test.ts` | AI trust boundary, confirmation, injection |
| `tests/review-regressions.test.ts` | Round-one review findings |
| `tests/review-regressions-2.test.ts` | Round-two review findings |

### Writing a security test that is worth having

A test that cannot fail is worse than no test, because it looks like coverage.
Two habits guard against it:

**Assert rejection explicitly.** Putting assertions only inside `.catch()` means
they never run if the call succeeds — the test passes while the vulnerability is
live. Assert that the promise rejects first, then inspect the error.

**Mutation-test the control.** Disable the protection and confirm the tests fail.
Both isolation and concurrency guarantees here were verified that way; the
results are recorded in the commit messages.

## Conventions

- Repositories take `userId` first and scope every query with it.
- Any id from a request body goes through `src/lib/authz.ts` before a write.
- Never pass user-supplied ids into a Prisma nested `connect`; assign scalar
  foreign keys instead.
- Route handlers stay thin: name a schema, call a repository.
- Comments explain *why*, especially where the obvious approach is wrong.

## Gemini free-tier limits

Worth knowing before wiring AI into a loop:

- **Pro models report `limit: 0`** on free-tier keys — permanently unusable
  without billing. Flash models work.
- **20 requests per minute**, shared across the key.
- Gemini 3.x models are served only on the **`v1alpha`** endpoint; `v1beta`
  returns 404 for them.

The app makes one request per command, so it fits comfortably. Agentic tooling
that makes many calls per invocation does not.

## Next.js 16 notes

- `middleware.ts` is now `proxy.ts`, exporting `proxy`. Node runtime only.
- `cookies()`, `headers()`, `params`, and `searchParams` are async-only.
- `next lint` was removed; use `eslint` directly.
- Bundled docs live in `node_modules/next/dist/docs/`.
