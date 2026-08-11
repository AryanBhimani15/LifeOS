# Architecture decisions

Each entry records what was decided, why, what was rejected, and — where an
independent model influenced the outcome — exactly what it said and whether it
was followed.

The multi-model workflow used here is: **Gemini** advises on architecture before
implementation, **Claude** implements, **Codex** reviews adversarially after.
Recommendations from either were evaluated, not adopted automatically. Several
were rejected, and those rejections are recorded too.

---

## ADR-001 — Tags use one join table per entity, not a polymorphic table

**Decision.** A `Tag` table plus six composite-primary-key join tables
(`TaskTag`, `NoteTag`, `ProjectTag`, `ExpenseTag`, `GoalTag`, `JournalTag`).

**Rejected: `entityType` + `entityId`.** Prisma cannot express polymorphic
relations, so this forfeits foreign keys and cascade deletes entirely. Deleting
a task would leave dangling tag rows that only application code could clean up.

**Rejected: one wide table with six nullable FKs ("exclusive arc").** This was
the original design. It needed a raw-SQL CHECK constraint, six unique indexes in
which most entries were NULL padding, and produced Prisma types where five of
six relations were always `null`.

**Gemini's contribution.** Asked to critique the exclusive arc, Gemini argued it
"fails at 7 columns" and recommended per-pair join tables, noting the sparse
types and index bloat. **Followed.** Its supporting claim that
`@@unique([tagId, taskId])` was a "false guarantee" because Postgres treats
NULLs as distinct was **rejected as incorrect** — the constraint that matters
for a note link is `@@unique([tagId, noteId])`, where both columns are non-null
and uniqueness holds normally. The index-bloat half of the argument was right;
the correctness half was not.

**Consequence.** "Everything tagged X" is six indexed lookups run in parallel
rather than a six-way LEFT JOIN over a sparse table. Adding a seventh taggable
entity costs one new table instead of a column plus a constraint rewrite.

Smaller links with two or three targets (`NoteLink`, `Milestone`) still use an
exclusive arc, with CHECK constraints enforcing exactly one parent. At that
width the arc's costs do not materialise.

---

## ADR-002 — Recurrence stores a rule and materialises lazily

**Decision.** A `RecurrenceRule` row, a template task flagged `isTemplate`, and
instances materialised on demand and linked by `seriesId`.
`@@unique([seriesId, occurrenceOn])` makes expansion idempotent under
concurrency. Rules carry an IANA timezone and `atMinutes` so a 09:00 task stays
at 09:00 local across a DST transition.

**Rejected: materialising all future instances.** Unbounded row growth, and
editing a series means rewriting every future row.

**Rejected: pure read-time expansion.** Per-instance completion state has
nowhere to live, and "what is due this week" has to expand every rule in
application code on every query.

**Gemini found two real defects in the first version of this design:**

1. `Task.seriesId` used `onDelete: Cascade`, so deleting a recurrence template
   would delete every completed historical instance. **Followed** — changed to
   `SetNull`.
2. Nothing recorded a deleted occurrence, so lazy expansion would resurrect an
   instance the user had removed. **Followed** — added `RecurrenceException`
   as a tombstone table.

**Gemini's background-worker recommendation was rejected.** It proposed an
eager 30-day rolling materialisation worker. That adds infrastructure whose own
failure mode — which Gemini itself named, "future recurring tasks vanish once
the window expires" — is worse than the problem it solves at personal scale.

---

## ADR-003 — Authorization is enforced in the application, with defence in depth

**Decision.** Every row carries `userId`. Every query is scoped to the session
user. Every foreign key arriving from a request is verified through
`src/lib/authz.ts` before any write.

**Rejected as the primary control: Postgres row-level security.** RLS is the
stronger guarantee — the database enforces it regardless of application bugs —
but it requires a per-request `SET LOCAL`, which fights connection pooling.
Adopting it half-heartedly would give the appearance of database enforcement
without the reality. It remains the recommended hardening step; see
`docs/security.md`.

**Gemini identified the hole that shaped the final design.** Scoping only the
top-level `where` clause is not enough, because Prisma nested writes accept
foreign ids the filter never inspects:

```ts
db.task.update({
  where: { id: myTaskId, userId: me },       // checked
  data:  { project: { connect: { id: X } } } // NOT checked
})
```

This attaches another user's project to your own task. **Followed.**
Repositories now assign scalar foreign keys rather than nested `connect`, and
every client-supplied id is verified first.

Gemini's alternative — a recursive AST validator over nested write payloads —
was **rejected** as more machinery than the problem needs. Not accepting nested
writes from user input at all is simpler and has no bypass.

**Verification.** 14 cross-user isolation tests. Their value was confirmed by
mutation testing: disabling `requireOwned` fails exactly the 8 tests that depend
on it, while the 6 covering where-clause scoping still pass, so the two
enforcement layers are independently proven.

---

## ADR-004 — The AI never emits SQL or database ids

**Decision.** The model returns a Zod-validated discriminated union of named
actions. To reference an existing record it emits a descriptor
(`{query: "workout"}`), never an id. The server resolves descriptors against
rows the signed-in user owns.

**Why this shape.** It makes a whole class of attack structurally impossible
rather than merely filtered. The model has no vocabulary for expressing another
user's row, so a hallucinated or prompt-injected reference resolves to nothing
instead of to someone else's data.

**Supporting rules.**

- Ambiguous references block the entire plan and return a disambiguation
  question. Executing the unambiguous half of an unconfirmed command is worse
  than asking once.
- Destructive actions are classified in code (`DESTRUCTIVE` in
  `src/lib/ai/actions.ts`), never by asking the model whether it considers
  itself destructive — an injected payload would simply answer "no".
- Planning never mutates. Execution is a separate request carrying
  `confirmed: true`, and destructiveness is recomputed from the stored actions,
  so a tampered `needsConfirm` column changes nothing.
- Read-only questions are answered from the database, not by the model, so a
  deadline cannot be hallucinated.

**Provider abstraction.** All of this sits behind `AiProvider`, so CI exercises
the full parse → validate → resolve → confirm → execute chain against fixtures
with no network calls. The security-critical logic is tested deterministically
rather than depending on a live model behaving well.

---

## ADR-005 — Money is stored as integer minor units

**Decision.** `amountMinor: Int`, with a non-negative CHECK constraint.
Direction lives in `kind` (EXPENSE/INCOME), not in the sign.

Binary floating point cannot represent `0.10`, so `0.1 + 0.2 !== 0.3` and a sum
of a few hundred expenses drifts by real money.

Conversion rounds rather than truncates: `Math.trunc(1.15 * 100)` is `114`,
because `1.15` is stored as `1.14999…`, which silently loses a cent on roughly
every eighth value.

**Codex found two follow-on defects.** The AI executor converted every amount as
if it were USD, so ¥100 stored as `10000` and three-decimal currencies (BHD,
KWD) used the wrong exponent entirely; and a large amount in a three-decimal
currency could overflow the 32-bit column, surfacing as an opaque driver error.
**Both followed** — currency now drives the exponent, and amounts are
range-checked with an actionable 400 rather than a 500.

---

## ADR-006 — Rate limiting is two-stage, and forwarded headers are not trusted

This decision was rewritten twice, and the intermediate version was worse than
where it started. Recorded in full because the failure is instructive.

**Original.** Key anonymous requests on the first `X-Forwarded-For` value.

**Codex, round one.** That value is attacker-controlled unless a proxy
overwrites it. A client sends its own header and gets a fresh quota per request,
which defeats rate limiting on exactly the endpoints that need it — signup runs
bcrypt. **Followed:** forwarded headers ignored unless `TRUST_PROXY_HEADERS` is
set; anonymous callers share one bucket.

**Codex, round two — the fix was a regression.** With a shared bucket and a
5-per-hour signup limit, five malformed requests lock out signup for everyone on
the instance for an hour. A trivially triggered global denial of service, worse
than the spoofing it replaced. **Followed.**

**Final design.** Two stages:

1. A generous shared bucket (240/hour) bounds total anonymous abuse.
2. A per-identity limit applied *after* body validation, keyed on the email
   address in the request. This is the control that actually stops targeted
   abuse, and unlike an IP it cannot be forged by a header.

Authenticated traffic is keyed per user throughout, which is both accurate and
unspoofable.

**Known limitation.** The default store is in-process memory: correct for a
single instance, not shared across a horizontally scaled deployment. The
`RateLimitStore` interface is deliberately small so a Redis implementation is a
drop-in. Documented in `docs/security.md` rather than left as a surprise.

---

## ADR-007 — Dates are validated against the calendar and resolved in the user's timezone

**Decision.** `YYYY-MM-DD` input is checked for real calendar validity, and
"today" is computed in the user's IANA timezone.

A regex is not enough: `2026-02-30` matches the pattern, and both `new Date` and
`Date.parse` silently roll it over to 2 March rather than rejecting it. That is
an unvalidated path from model output to persisted data.

**Codex found the timezone half.** Default dates used the server's UTC date, so
a habit completed at 00:30 in `Asia/Kolkata` was recorded against the previous
day and broke streaks. **Followed.** Day boundaries are computed through `Intl`
rather than a fixed offset, because offsets change with DST and a fixed one
breaks twice a year. Both sides of the `Europe/London` transition are asserted
in the test suite.

---

## ADR-008 — Expo/React Native for the mobile companion, not native Swift

**Decision.** Expo (React Native) in `mobile/`, talking to the existing API.

**Gemini was consulted and recommended native Swift/SwiftUI.** Its reasoning was
good: a single-screen voice app is ~200 lines of SwiftUI with `SFSpeechRecognizer`
and no third-party dependencies, whereas `expo-speech-recognition` needs a custom
development build that slows iteration. It also correctly named the failure mode
either way — an unhandled `AVAudioSession` interruption leaving the mic dead.

**Rejected, for a reason Gemini could not know.** Swift cannot be built, run or
tested in the environment this was developed in. There is no Xcode automation, no
compile step, no test run. Choosing Swift meant shipping several hundred lines
verified by nothing but confidence. With Expo the app typechecks, lints, bundles
for iOS through Hermes, and its API client is covered by integration tests
against the live server. Verifiability beat ergonomics.

Two supporting reasons:

- **Type sharing is worth more here than Gemini allowed.** The plan receipt is a
  discriminated union that is still changing. Hand-mirroring it into Swift
  `Decodable` structs is precisely where drift appears, and drift in that type
  means the confirmation screen misrepresents what is about to happen.
- **The cost of being wrong is low.** The requirement was that a future native
  client can use the same API. Since the contract is plain HTTP and JSON with
  bearer auth, that holds regardless of what the first client is written in.
  Choosing Expo now does not close the Swift door.

**Accepted from Gemini unchanged:**

- **Transcribe on-device, send text.** Streaming audio would spend the AI quota
  on transcription rather than understanding, and put a recording of a personal
  task list on the wire. Only the final transcript is sent, because firing a
  request per interim result would exhaust 20 requests/minute in one sentence.
- **`Vary: Authorization, Cookie` on every response.** Without it a cache keyed
  on URL can serve one user's response to another, since a bearer-authenticated
  request looks identical to an anonymous one to an intermediary that ignores the
  header. This would have been missed.
- **No refresh-token rotation.** Its failure case is convincing: the server
  rotates, the response drops on a flaky link, and the client holds an
  invalidated token — permanently logged out with no recovery. For a personal
  app, per-device revocation covers the realistic threat.
- **Revoke only the calling device**, so signing out on the phone does not end
  the browser session.

**Partially rejected:** Gemini proposed allowing execution of expired plans
within ~30 minutes to survive a user confirming after a signal drop. That defeats
why expiry exists — the ids a plan resolved may no longer be the rows the user
was shown. The client re-plans from the stored transcript instead, which recovers
the same situation without weakening the guarantee.

**Sharpened:** Gemini flagged duplicate execution from a retried request. That was
already impossible, because the plan is claimed with a conditional UPDATE. The
real defect was subtler — a retry after a dropped response reported an *error*
for work that had succeeded. So idempotency here means replaying the stored
result, not preventing the mutation.
