# Deployment

What it takes to put LifeOS somewhere a second person can reach it. Written for
a small private instance — you and a friend — not a public launch.

## Before anything else

LifeOS holds tasks, notes, journal entries and money. Two things follow from
that: the database is the product, and anyone who can create an account is
inside it with you. The checklist below is mostly about those two facts.

## 1. A Postgres you do not lose

Any managed Postgres works — Neon, Supabase, Azure Database for PostgreSQL,
Railway. What matters:

- **Backups are on.** Every managed provider offers them; not all default to on.
- **It is not the free tier that sleeps**, if you want the app to answer on the
  first click rather than the third.
- `DATABASE_URL` uses the pooled connection string if the provider offers one.

`DATABASE_URL_TEST` is only used by `npm test`. It has no place in production
and should not be set there — `tests/setup.ts` refuses to run against a database
whose name does not end in `_test`, which is a guard, not a licence to point it
somewhere real.

## 2. Environment

Required:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `AUTH_SECRET` | **Generate a fresh one**: `openssl rand -base64 32`. Never the development value. |
| `AUTH_URL` | The full public origin, e.g. `https://lifeos.example.com` |
| `CRON_SECRET` | Long random secret used only by the reminder scheduler. Generate with `openssl rand -base64 32`; never expose it to the browser. |

Strongly recommended:

| Variable | Why |
|---|---|
| `SIGNUP_INVITE_CODE` | Without it, anyone with the URL can create an account in your database. Set it to anything unguessable and give it only to people you mean to invite. |
| `TRUST_PROXY_HEADERS=true` | Only behind a proxy that overwrites `X-Forwarded-For` (Vercel, Azure Container Apps, Fly). Without it every anonymous request shares one rate-limit bucket. **Do not set it if the app is exposed directly** — the header is then attacker-controlled and per-IP limits become meaningless. |
| `STORAGE_DRIVER` | `vercel-blob` on Vercel, `azure` with `AZURE_STORAGE_CONNECTION_STRING` and `AZURE_STORAGE_CONTAINER` elsewhere. Not optional in production — see below. |

Optional: `GEMINI_API_KEY` (AI features return a clear error without it),
`AI_MODEL`.

## 3. File storage — the one that loses data quietly

The default driver writes uploads to local disk. On almost every host that
filesystem is thrown away on the next deploy and every restart, so attachments
disappear while their database rows remain, pointing at nothing.

The app refuses to start in production with `STORAGE_DRIVER=local` for that
reason. Pick one:

- **`STORAGE_DRIVER=vercel-blob`** — the answer on Vercel. Connect a Blob store
  to the project and Vercel sets `BLOB_READ_WRITE_TOKEN` itself; there is nothing
  else to configure. Blobs are written private and streamed back through the
  authenticated download route, so a blob URL never reaches a browser.
- **`STORAGE_DRIVER=azure`** with a Blob container, per the variables above.
- **`STORAGE_ALLOW_LOCAL=true`** *and* a real persistent volume mounted at
  `STORAGE_LOCAL_DIR`. Only that combination — the flag alone is how attachments
  disappear.

Verify with `node scripts/storage-check.mjs`.

## 4. Migrations

Run them as a one-off step **before** the new version starts serving, not from
the app's boot sequence — a host that starts two instances would otherwise run
the same migration twice:

```bash
DATABASE_URL='...' npx prisma migrate deploy
```

Never `prisma migrate dev` against production: it can reset the database.

## 5. Build and run

**Vercel** — connect the repo; it detects Next.js. Set the environment variables
above. Vercel's filesystem is ephemeral, so a real storage driver is required
rather than optional: add a Blob store to the project and set
`STORAGE_DRIVER=vercel-blob`.

**Any container host** — the repo has a `Dockerfile`:

```bash
docker build -t lifeos .
docker run -p 3000:3000 --env-file .env.production lifeos
```

It builds the standalone output, runs as a non-root user, and exposes
`/api/health`, which returns 503 when the database is unreachable rather than a
misleading 200.

## 6. Reminder scheduler

The app persists reminders and creates **in-app** notification records through
`GET` or `POST /api/internal/reminders/process`. The route rejects every request
unless `Authorization: Bearer $CRON_SECRET` (or `X-Cron-Secret`) matches the
server-only secret.

- **Vercel:** `vercel.json` runs this route once a day, at 03:00. That is not a
  schedule for reminders — it is the most the Hobby plan allows, which caps cron
  jobs at once per day. On Pro, change it to `*/5 * * * *` and you can drop the
  workflow below. Set `CRON_SECRET` in the project; Vercel Cron sends it as the
  bearer token.
- **GitHub Actions:** `.github/workflows/reminders.yml` calls the same route
  every five minutes, which is what actually makes reminders punctual. It needs
  a repository **variable** `LIFEOS_URL` (the deployment origin) and a
  repository **secret** `CRON_SECRET` (the same value as in Vercel).

  Running both is deliberate and safe. `processDueReminders` re-checks each
  reminder inside its transaction and treats the unique-notification collision
  as "another worker won", so an overlap delivers once. The daily Vercel job is
  the backstop for the workflow being disabled — GitHub suspends schedules on
  repositories with no activity for 60 days — so the failure mode is "late",
  not "never".
- **Container hosts:** configure the platform scheduler to make the same
  authenticated request every five minutes. Do not put the secret in a browser
  client, a public URL, or source control.

The worker is deliberately in `src/lib/repositories/notifications.ts`, not the
route, so scheduler configuration can change without changing delivery logic.
Browser push is not configured yet: there is no service worker, persisted Push
API subscription, or VAPID credentials. A reminder can therefore become an
in-app notification even while the browser is closed, but the browser cannot
show an operating-system notification until that separate infrastructure exists.

## 7. After the first deploy

1. Open `/api/health` — expect `{"status":"ok"}`.
2. Register the first account. If `SIGNUP_INVITE_CODE` is set, the form asks for
   it; confirm a wrong code is refused.
3. Complete setup. The timezone is captured from the browser at registration —
   check it under **Settings**, since it decides which day habit ticks and
   streaks land on.
4. Upload a file to an event, redeploy, and confirm it still downloads. This is
   the check that catches an ephemeral-storage mistake before it matters.

## Known limitations to accept or fix first

These are real, and they are the reason this document says "small private
instance" rather than "production".

- **Rate limiting is in-process memory.** It resets on restart and does not hold
  across multiple instances. Fine for one instance; swap in a shared store via
  `setRateLimitStore` before scaling out. See `src/lib/rate-limit.ts`.
- **No email delivery.** So: no email verification, no password reset, no way to
  change the address you sign in with. A forgotten password needs a manual
  database edit.
- **Browser push is not configured.** Reminders are processed into in-app
  notifications by the secured scheduler; service-worker/VAPID web push remains
  intentionally unavailable until it can be implemented and verified end to end.
- **Recurring tasks and events are not materialised.** The schema supports
  recurrence; no job expands it.
- **Projects and Journal are still placeholders**, and say so on screen.
- **One shared `GEMINI_API_KEY`.** Every user's AI usage bills the same key.
