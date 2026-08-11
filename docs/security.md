# Security

What is implemented, how it is verified, and what is deliberately not done yet.

## Threat model

LifeOS is single-tenant-per-user: everyone sees only their own rows. The primary
risk is therefore **cross-user data access**, and the secondary risk is the
**AI command surface**, where untrusted model output reaches a database.

## Authentication

- Passwords hashed with bcrypt, cost factor 12 (~250 ms per hash).
- Sign-in runs a bcrypt comparison against a dummy hash even when no user
  matches, so response timing does not reveal which addresses are registered.
- Sessions are JWT (required by Auth.js for the Credentials provider), signed
  with `AUTH_SECRET`. The app refuses to start if that variable is unset.
- Password policy is length-based (12 characters minimum, 200 maximum). Character
  class rules push people toward `Password1!` and are worse in practice; the
  upper bound exists so a large body cannot be fed to bcrypt as a DoS.
- Failed and successful sign-ins are both audit logged.

## Authorization

Two independent layers, both tested:

1. **Query scoping.** Every query filters on the session user's `userId`.
2. **Foreign-key ownership.** Every id arriving in a request body is verified
   through `src/lib/authz.ts` before any write.

The second layer exists because the first is not sufficient on its own. Prisma
nested writes accept foreign ids that the top-level `where` clause never
inspects, so `data: { project: { connect: { id: <victim's> } } }` would attach
another user's project to your own task. Repositories therefore assign scalar
foreign keys and never pass user-supplied ids into nested writes.

**Rule for new features:** if an id came from a request body, it goes through
`requireOwned` / `requireAllOwned` before it reaches the database.

Foreign resources return **404, not 403**. A 403 confirms the id exists, which
turns any endpoint into an enumeration oracle.

`src/proxy.ts` performs redirect-only session checks. It inspects cookie
presence, not signature, and is **not** an authorization control — it exists so
signed-out users land on the login page. Real enforcement is in `defineRoute`
and the repositories.

### Verification

14 cross-user isolation tests cover direct access, list leakage, foreign-key
hijacking on both create and update, partial-batch id checks, and account
deletion blast radius.

Their value was confirmed by **mutation testing**: disabling `requireOwned`
fails exactly the 8 tests that depend on it, while the 6 covering where-clause
scoping still pass. The two layers are independently proven rather than assumed.

## AI command surface

The model is treated as an untrusted input source throughout.

| Control | Mechanism |
|---|---|
| No SQL generation | The model returns a closed Zod union of named actions; nothing else validates |
| No database ids | The model emits text descriptors; the server resolves them against user-owned rows only |
| No silent guessing | Ambiguous references block the whole plan and return a disambiguation question |
| Destructive classification | Declared in code, never asked of the model |
| Confirmation | Enforced server-side; a second request must carry `confirmed: true` |
| Tamper resistance | Destructiveness recomputed from stored actions, so a modified `needsConfirm` column changes nothing |
| Exactly-once | The plan is claimed with a conditional UPDATE inside the transaction |
| Atomicity | All actions run in one transaction; a partial failure rolls back |
| Freshness | Plans expire after 10 minutes |
| Grounded answers | Read-only questions are answered from the database, never by the model |

Prompt injection is covered by tests in which the model *complies* with the
injected instruction and emits both an out-of-schema action and a reference to
another user's row. Both are stopped — the first at schema validation, the
second at resolution.

## Input validation

Every request body and query string is validated with Zod at the single route
entry point (`defineRoute`). Client-side validation is a convenience, never a
control.

Dates are checked for real calendar validity, because `2026-02-30` passes a
regex and both `new Date` and `Date.parse` roll it into March rather than
rejecting it.

## Error handling

`defineRoute` is the only place errors become responses. Typed `AppError`
instances carry client-safe messages; everything else becomes a generic 500 with
the detail logged server-side. A Prisma error, stack trace, or connection string
cannot reach a client through this path.

## Rate limiting

Two stages — see ADR-006 for why a single stage failed twice.

| Bucket | Limit | Keyed on |
|---|---|---|
| Anonymous (coarse) | 240/hour | shared |
| Register (identity) | 5/hour | email in body |
| Sign-in | 8/15 min | email |
| Reads | 300/min | user |
| Writes | 120/min | user |
| AI commands | 20/hour | user |

`X-Forwarded-For` is ignored unless `TRUST_PROXY_HEADERS=true`, because a client
can otherwise forge it and receive a fresh quota per request. Set it only behind
a proxy that overwrites the header.

## Audit logging

Authentication events, deletions, exports, settings changes, and every AI plan
and execution are recorded with actor, action, entity, and timestamp. Audit
writes are best-effort: a logging failure must never roll back the operation it
was recording. Credential-shaped metadata keys are scrubbed before storage.

Recorded IP addresses are prefixed `unverified:` unless a trusted proxy is
configured, so nobody later mistakes them for proof.

## Secrets

- `.env` is gitignored; `.env.example` documents every variable with no values.
- No secrets are hardcoded. `AUTH_SECRET` and `DATABASE_URL` are required at
  startup and the app fails loudly without them.
- The AI provider never includes its request URL in an error path, because the
  API key travels as a query parameter.

## Database integrity

Constraints the application cannot bypass, applied in migration SQL:

- Exclusive-arc CHECKs on `note_links` and `milestones` (exactly one parent).
- Range CHECKs on mood, productivity, and goal progress.
- Ordering CHECKs on events and budget periods.
- Non-negative CHECKs on all monetary amounts.
- Self-reference guards on tasks.
- `ON DELETE CASCADE` from `User` throughout, so account deletion leaves no
  orphans — verified by test.

## Known limitations

These are real and deliberately not hidden:

1. **Rate limit store is in-process.** Correct for one instance; counters are not
   shared across a scaled deployment and reset on restart. Swap in a Redis
   implementation of `RateLimitStore` before scaling out.
2. **No Postgres row-level security.** Enforcement is application-level. RLS
   would be a stronger guarantee and is the recommended next hardening step; it
   was not adopted because per-request `SET LOCAL` fights connection pooling and
   a half-implemented version would look like database enforcement without being
   it.
3. **No CSRF token on API routes.** Auth.js protects its own endpoints. The API
   is JSON-only and same-origin, but a token would be needed before exposing it
   to third-party origins.
4. **No email verification or password reset flow.** Registration trusts the
   address given.
5. **No 2FA.**
6. **Session revocation is limited.** JWT sessions cannot be invalidated
   server-side before expiry; a database session strategy would be required.
