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
