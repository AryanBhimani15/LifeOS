# LifeOS

An AI-powered personal command center: tasks, projects, calendar, goals, habits,
notes, journal, and expenses in one application, with a natural-language command
bar that turns a sentence into structured, confirmed actions.

> **Status: backend complete and tested; web UI not yet built.** The data model,
> API, authentication, authorization, and AI command pipeline are implemented and
> covered by 63 passing tests. There is no dashboard or task board yet — the app
> is currently driven through its HTTP API. See [Status](#status) for the honest
> breakdown.

## What works today

- **Authentication** — registration, sign-in, sessions, protected routes.
- **Cross-user isolation** — enforced in two independent layers and verified by
  mutation testing.
- **Tasks** — full CRUD, subtasks, recurrence rules, tags, projects, filtering,
  cursor pagination, and fractional-rank ordering for drag-and-drop.
- **AI command centre** — natural language becomes a validated, resolved plan;
  destructive actions require server-enforced confirmation; read-only questions
  are answered from the database.
- **Database integrity** — 35 tables with foreign keys, cascade rules, CHECK
  constraints, trigram search indexes, and partial indexes for dashboard queries.

## Quick start

Requires **Node 20+** and **PostgreSQL 14+** running locally.

```bash
git clone <your-remote> LifeOS && cd LifeOS
npm install

cp .env.example .env
# Fill in DATABASE_URL, DATABASE_URL_TEST, and AUTH_SECRET.
# Generate a secret with: openssl rand -base64 32

createdb lifeos_dev
createdb lifeos_test

npm run db:migrate        # apply migrations to the dev database
npm run db:migrate:test   # and to the test database

npm run dev               # http://localhost:3000
```

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm test` | Full test suite (needs `lifeos_test`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:migrate` | Apply migrations to dev |
| `npm run db:migrate:test` | Apply migrations to the test database |
| `npm run db:studio` | Prisma Studio |

## Environment variables

Every variable is documented in [`.env.example`](.env.example). Required:
`DATABASE_URL`, `DATABASE_URL_TEST`, `AUTH_SECRET`. Optional: `GEMINI_API_KEY`
(AI features return a clear error without it), `AI_MODEL`,
`TRUST_PROXY_HEADERS`.

## Documentation

| Document | Contents |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Layers, request lifecycle, module map |
| [docs/database.md](docs/database.md) | Schema, relationships, indexes, constraints |
| [docs/api.md](docs/api.md) | Endpoints, payloads, error codes |
| [docs/security.md](docs/security.md) | Controls, verification, known limitations |
| [docs/decisions.md](docs/decisions.md) | Architecture decisions and why |
| [docs/development.md](docs/development.md) | Local setup, testing, conventions |

## The AI command centre

The design principle is that the model is an untrusted input source.

```
"finish my Azure assignment tomorrow at 6pm"
        │
        ▼
   Gemini parses ──► JSON envelope
        │
        ▼
   Zod validates ──► closed union of named actions; anything else is discarded
        │
        ▼
   Server resolves ──► text descriptors become ids, scoped to YOUR rows only
        │
        ▼
   Plan persisted ──► nothing has mutated yet
        │
        ▼
   Confirmation ──► destructive plans need `confirmed: true` on a second request
        │
        ▼
   Execute ──► one transaction, claimed atomically, exactly once
```

The model cannot emit SQL, and it cannot emit database ids at all — it has no
vocabulary for referring to another user's row. Ambiguous references stop the
plan and ask a question rather than guessing.

## Status

**Implemented and tested**

- Prisma schema, migrations, integrity constraints
- Auth (registration, login, sessions, route protection)
- Request pipeline (auth, rate limiting, validation, error mapping)
- Ownership enforcement and cross-user isolation
- Tasks API
- AI command centre (plan, resolve, confirm, execute, query)
- Audit logging, money handling, timezone-correct dates

**Not yet built**

- Web UI — no dashboard, task board, calendar, or command bar interface
- API routes for projects, notes, goals, habits, journal, expenses, documents
  (the schema and repositories patterns exist; the routes do not)
- Recurrence materialisation job
- Analytics endpoints and charts
- Global search endpoint
- Daily brief generation

## Licence

Unlicensed personal project.
