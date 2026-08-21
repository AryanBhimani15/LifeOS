# Calendar — Phase 4

## Existing data pipeline (kept)

Calendar is a projection, not a database. The server route reads URL-backed
`view`, `date`, and `kinds` state, resolves the user's timezone and week-start
setting, then asks `calendarItems()` only for the visible window. The repository
maps the original `Task`, `Event`/`EXAM`, `Goal`, logged `WorkoutEntry`, and (on
request) Habit schedule into small `CalendarItem` pointers. Each pointer keeps
its original id and detail URL, so Calendar never owns a duplicate task or
event. The Home seven-day preview consumes the same item vocabulary.

Date boundaries are calculated in the user's timezone. All-day tasks and
events intentionally have no invented midnight time; timed events retain their
start/end instants. The existing explicit Move action updates the source object
and preserves a timed event's duration.

## Phase 4 scope

The work in this phase improves the visual projection and the Calendar-only
event/exam entry flow. Month remains the planning overview, Week becomes a
time-grid with an all-day band and collision-safe timed blocks, Day becomes an
all-day area plus timeline, and Agenda groups readable dates. URL state,
repository queries, and the connected Event/Task architecture remain unchanged.

Schedule load is a transparent deterministic planning aid. It uses distinct
weights for exams, events, task deadlines (with priority), goal deadlines,
workouts, and habits, with a small duration adjustment for timed commitments.
Its labels describe calendar density only; they are not a stress or wellbeing
measurement. The pure calculation is covered by tests so its weights can be
adjusted later without changing persisted data.

Drag-to-reschedule is deliberately deferred: the existing explicit Move action
is safe and edits the original item, while a drag interaction would need
additional robust timezone and overlap handling before it can be introduced.
