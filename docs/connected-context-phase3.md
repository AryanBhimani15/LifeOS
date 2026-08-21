# Connected context — Phase 3

## Model before this phase

- `Task` and `Event` were user-owned, but an `Event` could only point to one
  legacy `taskId`. Additional preparation work was being represented as a
  subtask of that one task, which made the relationship incomplete and
  misleading.
- `Document` already belongs directly to one optional `Event` or `Task`. Its
  private Azure key and authenticated download flow are retained as-is.
- `Reminder` already belongs to exactly one task or event, enforced by an
  exclusive-arc database check.
- `Note` was standalone (optionally in a project/folder). `NoteLink` covers
  task/project/goal links, but not events. Event descriptions were a separate
  structured detail field, not saved notes.
- Calendar is an aggregation of source records. It deliberately has no table:
  tasks and events retain distinct ids and links. Home reads those same source
  records through bounded, user-scoped queries.

## Model after this phase

- `EventPreparationTask` is an explicit event-to-task junction. It supports
  any number of normal tasks per event and allows a task to be connected to
  more than one event when useful. Deleting or unlinking an event never deletes
  the task; deleting a task only removes the junction rows.
- A `Note` may optionally have one `eventId`. Event deletion sets that field to
  `NULL`, preserving the standalone note. A related note is therefore exactly
  the same persisted note in the Notes library and on the Event page.
- Event `description` remains **Important details** (the event's own structured
  context); related notes remain separately-authored saved notes. They are not
  copies of each other.
- Document and Reminder ownership and storage semantics are unchanged. All new
  relationship writes check both records against the signed-in user on the
  server before changing a foreign key or junction row.
