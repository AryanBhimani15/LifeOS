# LifeOS architecture map

This is the implementation map for the existing LifeOS application. It is a
map of what is currently in the repository, not a promise that an external
provider has been tested in the live deployment.

## Product boundary

LifeOS is a personal operating system built around one loop:

```text
capture → understand when it matters → connect related information
        → surface it in context → remind when necessary
```

The product has a deliberately calm, editorial UI: warm white canvas, white
cards, restrained blush-pink accents, charcoal text, refined sans for controls,
and display type only for major headings. Home uses the cherry-blossom asset in
`public/images/home-sakura-banner.png`; light mode is the reference theme.

## Runtime layers

```text
App Router page / client component
        ↓ server action or API route
validation + authenticated user identity
        ↓
repository (user-scoped query + ownership validation)
        ↓
Prisma 7 transaction / PostgreSQL constraint
        ↓
optional storage or AI boundary
```

| Layer | Main locations | Responsibility |
|---|---|---|
| Page shell | `src/app/(app)`, `src/components/AppShell.tsx`, `TopBar.tsx` | Navigation, theme, profile controls, command entry point |
| UI features | `src/components/{tasks,events,home,calendar,fitness,money,...}` | Focused view state and accessible interaction |
| Server actions | `src/app/(app)/**/actions.ts` | Mutation entry points for web UI |
| API | `src/app/api/**/route.ts`, `src/lib/api.ts` | Authenticated, validated contract for web/mobile clients |
| Domain repositories | `src/lib/repositories/**` | User scoping, authorization and persistence |
| Shared services | `src/lib/nlp`, `src/lib/ai`, `src/lib/storage`, `src/lib/dates` | Parsing, plans, files and timezone rules |
| Data | `prisma/schema.prisma`, `prisma/migrations` | Referential integrity and durable history |

All external IDs received from a client are checked with `src/lib/authz.ts`
before a repository writes them. API routes use `defineRoute` in `src/lib/api.ts`
so authentication, validation, error mapping and rate limiting are not
reimplemented per endpoint.

## Canonical task creation

Normal task creation is intentionally not a collection of screen-specific
writes:

```text
typed / spoken task
  → captureTask (deterministic date parsing + explicit user choices win)
  → createTaskInTransaction (ownership, recurrence, board order, project activity)
  → Task + optional Reminder commit atomically
```

`createTask` is the structured API wrapper around the same canonical
transactional writer. The AI executor calls `createTaskInTransaction` inside
its already-atomic confirmed-plan transaction, preserving exactly-once plan
execution rather than creating a second task behavior.

| Entry point | Path to canonical writer |
|---|---|
| Add Something / Add Task | `AddTask` → server action → `captureTask` |
| Today’s to-do list | `TodayTodoList` action → `captureTask` |
| Command / direct capture / mobile voice | `/api/capture` → `capture` → `captureTask` |
| Event preparation task | event action → `captureTask` |
| Structured task API | `/api/tasks` → `createTask` → `createTaskInTransaction` |
| Confirmed AI action | executor transaction → `createTaskInTransaction` |

The parser at `src/lib/nlp/parse-capture.ts` is deterministic for simple
phrases such as “call dad”, “renew domain tomorrow”, and “submit DBMS CIA 2 on
September 11 at 10am”. A parsed date is shown as detected; an explicit picker
choice overrides it. Time remains optional.

## Connected object model

```text
User
 ├─ Task ── Project / Goal / parent Task / Tags / Reminders / Documents
 │    └─ Event (optional event or exam linked to the preparation task)
 ├─ Event / Exam ── Project / Tags / Reminders / Documents
 ├─ Note ── Project / Folder / Tags / NoteLink(Task | Project | Goal)
 ├─ Habit / Goal / Fitness profile / Workout history
 └─ Expense / Income / Category / Budget / Recurring expense
```

- Tasks retain status, priority, optional due date/time, subtasks, recurrence,
  drag rank, reminders, tags and attachments.
- Events use their own time range and all-day semantics; exams are events with
  an exam kind, rather than deadlines disguised as tasks.
- Documents can attach to either a task or an event. The server generates the
  storage key and the authenticated download route authorizes the document row
  before bytes are served.
- Notes are currently generic notes plus safe `NoteLink` relationships to a
  task, project or goal. A first-class contextual-note surface remains the
  next relationship-layer enhancement.
- The calendar reads task due dates and event ranges as views of the original
  records; it is not a duplicate event store.

## Existing functional areas

| Area | Current foundation |
|---|---|
| Home | Sakura hero, quick note side tab, notes workspace, today list, upcoming agenda, habits and goals. It is being simplified around useful daily decisions rather than a metric dashboard. |
| Tasks | Unified capture, board/list, detail view, visible complete control, status/priority/date/reminder/note support. |
| Events & exams | Event and exam records, task links, preparation tasks, tags, reminders, resource attachments and detail pages. |
| Calendar | Month/day agenda surfaces original task and event data. |
| Notes | Create/read/delete notes, folders/tags/pinning, Home quick note separate from full Notes. |
| Fitness | Workout logging, history, activity rates and weekly burn/streak summaries in the shared light editorial system. |
| Money | INR-only student money model: income/pocket money, expenses, recurring expense plans, savings targets, actual saving deposits, monthly runway and safe-to-spend guidance. Monetary values use integer minor units. |
| Goals & habits | Goals, milestones/progress, habits, streak/completion history. |
| AI & command | Validated AI plan/confirm/execute flow, deterministic direct capture fallback, command UI. |
| Mobile | Auth/device/mobile API contracts and a partial companion client. |

## Storage and external integrations

`src/lib/storage` is a small provider seam (`put`, `get`, `remove`). Local
storage supports development. The Azure Blob driver is selected with
`STORAGE_DRIVER=azure`, creates/uses a private container, uses opaque
server-generated keys, and serves files only after authenticated database
authorization.

**Current verification boundary:** the Azure code and environment wiring are
present, but this document does not mark Azure as live-verified. A genuine
Azure upload → login-protected download → deletion test must be performed in
the deployed environment before calling that integration verified. Likewise,
reminders are stored and rendered but have no confirmed background delivery
worker yet; Google Classroom and Google Calendar imports are planned rather
than represented as completed integrations.

## Delivery status and sequencing

1. **Tasks:** canonical pipeline audited; normal UI, capture, event-prep and
   API paths reuse it. Regression coverage includes date parsing, no-date
   capture, ownership, board ordering, priority and reminder persistence.
2. **Home:** visual foundation and separate quick-note/notes workflows exist;
   continue reducing clutter and prioritize daily planning.
3. **Relationship layer:** task/event documents, tags and note links exist;
   contextual notes and stronger automatic relationship suggestions remain.
4. **Events/exams and Calendar:** core records and surfaces exist; expand the
   event detail workspace before inventing alternate calendar stores.
5. **Attachments:** application-level safety is in place; live Azure
   verification and recovery UX remain required.
6. **Reminders, search, inbox and external services:** storage/query
   foundations exist in parts, but real delivery, unified inbox and Google
   integrations are future phases—not features to imply as complete.

## Verification rules

- Unit/integration tests use a real isolated PostgreSQL database and are run
  serially by Vitest.
- Relevant migrations must be applied to the test database before tests.
- Type-check, lint and production build supplement behavioral tests.
- Visual work requires manual browser verification at desktop and mobile
  breakpoints.
- External claims require an external round trip; code review and mocks are not
  a substitute for Azure or notification delivery testing.
