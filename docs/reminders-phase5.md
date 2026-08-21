# Phase 5 — reliable reminders and in-app notifications

## Before this phase

LifeOS stored one absolute `Reminder` row against either a task or an event.
Task and event pages could create, change, or delete that row, and calendar
event creation could create one from a minutes-before choice.  The row had no
delivery state, worker, notification history, notification API, or useful bell;
the bell was a decorative button with a permanent dot.  No service worker,
web-push subscription, VAPID credentials, or background-job setup existed.

User timezone settings already drive calendar wall-clock to instant conversion.
The app is deployable to Vercel or as a container, so delivery logic cannot be
owned by a browser tab or a framework-local timer.

## Chosen architecture

`Reminder` remains the scheduling instruction.  It now tracks a delivery
state, attempts, retry time, version, and (for event-relative reminders) an
offset in minutes. `Notification` is a separate in-app alert history record
with a source deep link. If its source is later deleted, the copied message is
kept while the optional reminder relation is set to null.

A scheduler calls the secured internal reminder route.  The route contains no
business logic: it invokes the directly testable server repository worker.
Vercel Cron may call it in a Vercel deployment; a container deployment can call
the exact same route from its platform scheduler.  The scheduler authenticates
with the server-only `CRON_SECRET`.

The delivery transaction inserts the notification and marks the reminder
delivered together.  The unique `(reminderId, deliveryVersion)` key prevents
overlapping worker executions from producing duplicates.  Updating a reminder
increments its delivery version and re-arms it.  Relative event reminders are
recomputed whenever an event moves; task reminders stay independent of task
due dates.

## Browser notifications

Browser push is deliberately deferred.  This deployment does not yet have the
required service worker, Push API subscription persistence, or VAPID server
credentials.  The Settings UI reports that honestly; it never presents a fake
enable switch or claims notifications can reach a closed browser.
