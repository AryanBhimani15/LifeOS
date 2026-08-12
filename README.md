# LifeOS

An AI-powered personal command center: tasks, projects, calendar, goals, habits,
notes, journal, and expenses in one application, with a natural-language command
bar that turns a sentence into structured, confirmed actions.

> **Status: web app and mobile companion working; several sections still stubs.**
> Auth, onboarding, the Today view, the Kanban board, task capture, events with
> file attachments, the calorie burn tracker and the AI command centre all work
> end to end against Postgres, covered by 198 server tests plus browser and API
> contract suites. Projects, Calendar, Goals, Habits,
> Notes, Journal and Money have schema and pages but no APIs yet, and say so on
> screen rather than showing sample data. See [Status](#status) for the breakdown.

## What works today

- **Authentication** — registration, sign-in, sessions, protected routes.
- **Cross-user isolation** — enforced in two independent layers and verified by
  mutation testing.
- **Tasks** — full CRUD, subtasks, recurrence rules, tags, projects, filtering,
  cursor pagination, and fractional-rank ordering for drag-and-drop.
- **Onboarding that builds something** — a guided, one-question-at-a-time setup
  every new account completes, each step with its own animation. It asks what
  their week is built around and what they are working towards, then generates a
  weekly training plan, two starter goals with milestones, and two habits. The
  answers are used, not filed.
- **Effortless capture** — today's planned session is logged with one tap, and a
  task is one field and Enter. Neither needs a form. Dates are read from the
  sentence by a deterministic parser that never invents one.
- **Events and exams** — an event *happens* between two times rather than being
  *due* at one, and gets its own page: the note the lecturer actually gave,
  preparation tasks, and file attachments. Every relationship is optional.
- **Calorie burn** — an activity catalogue in Postgres, a calculator that prices
  every result server-side, saved history with delete, and daily/weekly totals
  bucketed by the user's own calendar.
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
`TRUST_PROXY_HEADERS`, and `STORAGE_DRIVER` (`local` by default; `azure` needs
`AZURE_STORAGE_CONNECTION_STRING` and `AZURE_STORAGE_CONTAINER`).

## Mobile companion

`mobile/` holds a voice-first iPhone app: launch, tap the mic, speak, review the
plan, confirm. It is deliberately not a small dashboard — it shares the web app's
database, authentication and AI command pipeline, and contains no business logic
of its own.

```bash
cd ~/LifeOS && npm run dev        # the backend
cd mobile && npm start            # the app
```

See [docs/mobile.md](docs/mobile.md) for the API contract, the token auth model,
and the honest list of what does not work yet (push delivery needs an Apple
Developer account; nothing has run on physical hardware).

## Documentation

| Document | Contents |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Layers, request lifecycle, module map |
| [docs/database.md](docs/database.md) | Schema, relationships, indexes, constraints |
| [docs/api.md](docs/api.md) | Endpoints, payloads, error codes |
| [docs/security.md](docs/security.md) | Controls, verification, known limitations |
| [docs/decisions.md](docs/decisions.md) | Architecture decisions and why |
| [docs/mobile.md](docs/mobile.md) | Mobile companion: contract, auth, limitations |
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
- Tasks API, one capture pipeline, deterministic date parsing
- Events API and file attachments (storage driver: local or Azure Blob)
- Fitness API (profile, activities, calculate, history, stats)
- AI command centre (plan, resolve, confirm, execute, query)
- Audit logging, money handling, timezone-correct dates

- Web UI — login/register, onboarding, Today, Kanban board with drag-and-drop,
  calorie burn calculator with history and weekly chart, ⌘K command bar
- Mobile companion — voice capture, plan receipt, confirm (see docs/mobile.md)
- Token auth for native clients, alongside cookie sessions for the browser

**Not yet built**

- Personalised calorie formulas. The calculator uses each activity's flat
  published rate; the onboarding profile is stored and shown but deliberately not
  applied, because presenting an invented health number as a real one is worse
  than presenting an obviously generic one.
- API routes for projects, notes, goals, habits, journal, expenses, documents
  (schema and the repository pattern exist; those routes do not). Their pages
  render an explicit "not built yet" state rather than fake rows.
- Recurrence materialisation job
- Analytics endpoints and charts
- Global search endpoint
- Push notification delivery (registration works; APNs credentials do not exist)
- Nothing has been run on physical iOS hardware

## Licence

Unlicensed personal project.
