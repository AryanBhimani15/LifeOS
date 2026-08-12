# API

JSON over HTTP. All routes except registration and the Auth.js endpoints require
a session cookie.

## Conventions

**Errors** share one shape:

```json
{ "error": { "code": "NOT_FOUND", "message": "Task not found", "details": {} } }
```

| Code | Status | Meaning |
|---|---|---|
| `BAD_REQUEST` | 400 | Malformed request |
| `UNAUTHENTICATED` | 401 | No valid session |
| `NOT_FOUND` | 404 | Missing **or not yours** — see below |
| `CONFLICT` | 409 | Duplicate |
| `AI_AMBIGUOUS` | 409 | Reference matched several rows |
| `CONFIRMATION_REQUIRED` | 409 | Destructive plan needs `confirmed: true` |
| `VALIDATION_FAILED` | 422 | Zod rejected the payload; `details` is a field tree |
| `RATE_LIMITED` | 429 | Includes a `Retry-After` header |
| `AI_UNAVAILABLE` | 503 | Provider unreachable, rate limited, or unconfigured |
| `INTERNAL` | 500 | Logged server-side; no detail returned |

A resource belonging to another user returns **404, not 403**, so the API cannot
be used to discover which ids exist.

## Auth

| Method | Path | Body |
|---|---|---|
| `POST` | `/api/auth/register` | `{ name, email, password, timezone? }` → 201 |
| `POST` | `/api/auth/callback/credentials` | Auth.js sign-in |
| `POST` | `/api/auth/signout` | Auth.js sign-out |

Passwords must be at least 12 characters. Registration is limited to 5 per hour
per email address.

## Tasks

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/tasks` | Filter, search, sort, cursor paginate |
| `POST` | `/api/tasks` | Create, optionally with recurrence |
| `GET` | `/api/tasks/:id` | |
| `PATCH` | `/api/tasks/:id` | Partial update |
| `DELETE` | `/api/tasks/:id` | Subtasks cascade |
| `POST` | `/api/tasks/reorder` | Kanban drag-and-drop |
| `GET` | `/api/tasks/:id/detail` | Task plus subtasks, reminders and any linked event |

**Query parameters** — `status`, `priority` (comma-separated), `projectId`,
`parentId`, `tagId`, `search`, `dueBefore`, `dueAfter`, `includeSubtasks`,
`sort` (`dueAt|priority|createdAt|boardOrder|title`), `dir`, `limit`, `cursor`.

```jsonc
// POST /api/tasks
{
  "title": "Finish Azure assignment",
  "priority": "HIGH",
  "dueAt": "2026-08-14T18:00:00+01:00",
  "projectId": "clx…",          // must be yours, verified server-side
  "tagIds": ["clx…"],           // all must be yours
  "recurrence": {
    "freq": "WEEKLY",
    "byWeekday": [2, 4, 6],
    "timezone": "Europe/London",
    "atMinutes": 540,
    "startsOn": "2026-08-11"
  }
}
```

`completedAt` is derived from `status` and never accepted from a client.

**Capture.** Every task created from something a person typed or said goes
through `captureTask` (src/lib/repositories/tasks.ts), which reads a date out of
the sentence with `src/lib/nlp/parse-capture.ts` and then calls `createTask`.
The parser is regular expressions, not a model, for one reason above all: asked
to extract a date from "call dad", a model will sometimes answer "today". A
regex that finds nothing returns nothing, every time. Unspecified stays
unspecified.

**Deadlines are not events.** `dueAt` with `dueHasTime = false` is "by Friday";
`dueHasTime = true` is "at 6pm on Friday". An exam that *runs* 10:00–11:30 is an
`Event`, which already carries `taskId`, so a task can point at one without a
second calendar model.

## Fitness

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/fitness/profile` | The onboarding answers, or `null` |
| `PUT` | `/api/fitness/profile` | Replaces them wholesale |
| `GET` | `/api/fitness/activities` | The activity catalogue |
| `POST` | `/api/fitness/calculate` | Works out a burn **without saving it** |
| `GET` | `/api/fitness/history` | Saved workouts, newest first (`?limit=`) |
| `POST` | `/api/fitness/history` | Saves one |
| `DELETE` | `/api/fitness/history/:id` | 404 for an id that is not yours |
| `GET` | `/api/fitness/stats` | Today and the current week |
| `POST` | `/api/fitness/plan/log` | Logs a planned session — `{ sessionId }` and nothing else |

```jsonc
// PUT /api/fitness/profile — units are converted server-side
{
  "firstName": "Aryan",
  "age": 24,
  "sex": "MALE",
  "height": { "unit": "cm", "cm": 178 },     // or { unit: "ftin", feet, inches }
  "weight": { "unit": "kg", "value": 72 },   // or { unit: "lb", value }
  "activityLevel": "MODERATELY_ACTIVE",
  "lifeContext": "STUDENT_AND_WORKING",      // what their week is built around
  "primaryGoal": "BUILD_STRENGTH"            // what the plan is built towards
}
```

`PUT /api/fitness/profile` is not just a write. It generates a weekly training
plan, and — only for an account with none — two starter goals with milestones
and two habits, all in one transaction. The response is a summary of what was
created, which is what the completion screen shows:

```jsonc
{
  "firstName": "Aryan",
  "plan": { "name": "Strength block", "daysPerWeek": 4, "rationale": "…", "sessions": 4 },
  "goalsCreated": 2,
  "habitsCreated": 2
}
```

The plan is rebuilt only when `primaryGoal`, `activityLevel` or `lifeContext`
changes; correcting a weight leaves the training week alone. The previous plan
is archived rather than deleted, because saved workouts point at its sessions.

`POST /api/fitness/plan/log` takes a session id alone — activity, duration and
calories all come from the plan, so marking a workout done is one request with
nothing to fill in.

Height and weight are stored as integer millimetres and grams; the unit the user
typed in is kept only to echo their answer back in the same terms.

```jsonc
// POST /api/fitness/calculate  and  POST /api/fitness/history
{ "activityId": "act_running", "duration": { "hours": 1, "minutes": 30 } }
```

Neither the rate nor the calorie total is accepted from a client. Both are read
from the catalogue and recomputed server-side, so a tampered request cannot
write a 50,000 kcal entry into the statistics. A saved row keeps its own copy of
the activity's name and rate, so editing the catalogue never rewrites history.

Duration is validated as a pair and as a total: 0 minutes, negatives, more than
59 minutes in the minutes field, and anything over 24 hours are all rejected with
a message written to be shown to the user.

The profile is *stored and displayed only*. Calories are the activity's flat
published rate prorated by time — see `calculateBurn` in `src/lib/fitness.ts` for
why no personalised formula is applied.

**`GET /api/fitness/stats`** buckets by the user's own calendar and week start,
so a workout at 23:30 counts against that evening rather than the next UTC day.

## Events and attachments

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/events` | Upcoming, nearest first |
| `POST` | `/api/events` | Create |
| `GET` | `/api/events/:id` | Event plus preparation tasks and attachments |
| `PATCH` | `/api/events/:id` | Partial update |
| `DELETE` | `/api/events/:id` | Attachments and their bytes go with it |
| `POST` | `/api/events/:id/attachments` | Multipart, field name `files`, up to 10 |
| `DELETE` | `/api/attachments/:id` | |
| `GET` | `/api/attachments/:id/download` | Streams the bytes |

An event **happens** between `startAt` and `endAt`; a task is **due** at
`dueAt`. `Event.kind` (`EXAM`, `CLASS`, `MEETING`, `DEADLINE`, `EVENT`) decides
how it is presented — an exam reads "Exam · 10:00 AM – 11:30 AM", never "Due".

**Uploads are per-file, not per-batch.** The response carries both outcomes:

```jsonc
{ "attachments": [ /* saved */ ], "failed": [ { "name": "x.exe", "reason": "…" } ] }
```

One rejected file therefore never discards the ones that worked, and never
touches the event. Types are an **allow-list** — `text/html` is refused, because
a page served back from our own origin is stored XSS. 20 MB per file.

Downloads stream through the app rather than from a public URL: that is what
makes them private, since the query is scoped to the signed-in user. They are
sent `Content-Disposition: attachment` with `X-Content-Type-Options: nosniff`,
so an uploaded file can never render as a document on this origin.

**Storage** is behind a three-method interface (`src/lib/storage`). `local`
writes to disk and needs no configuration; `azure` uses the Blob container this
deployment already has. Adding S3 or Supabase is one file and one `case` — no
route, repository or component knows where a file lives. Storage keys are always
server-generated, so a filename can never become a path.

## AI command centre

| Method | Path | Body |
|---|---|---|
| `POST` | `/api/ai/command` | `{ input }` → a plan; **never mutates** |
| `POST` | `/api/ai/plans/:id/execute` | `{ confirmed }` |
| `POST` | `/api/ai/plans/:id/reject` | — |

**Plan response:**

```jsonc
{
  "planId": "clx…",
  "summary": "Create a task to finish the Azure assignment tomorrow at 6pm",
  "actions": [ /* resolved actions with real ids */ ],
  "needsConfirm": false,
  "clarification": null,   // set when the command could not be resolved
  "ambiguities": null      // candidates when a reference matched several rows
}
```

When `planId` is `null`, nothing was planned — read `clarification`.

When `needsConfirm` is `true`, execution requires `{ "confirmed": true }`.
Sending `false` returns `CONFIRMATION_REQUIRED`; this is enforced server-side and
is not bypassable by a client that skips the dialog.

Plans expire after 10 minutes and execute at most once.

Read-only `query` actions return an `answers` array computed from the database.

**Rate limit:** 20 AI commands per hour per user.
