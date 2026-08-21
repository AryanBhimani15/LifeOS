-- Turn the former one-event/one-task pointer into an explicit preparation
-- relationship. The copy is intentionally first: every existing relationship
-- survives this migration before the obsolete scalar is removed.
CREATE TABLE "event_preparation_tasks" (
  "eventId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "event_preparation_tasks_pkey" PRIMARY KEY ("eventId", "taskId")
);

INSERT INTO "event_preparation_tasks" ("eventId", "taskId")
SELECT "id", "taskId"
FROM "events"
WHERE "taskId" IS NOT NULL
ON CONFLICT ("eventId", "taskId") DO NOTHING;

ALTER TABLE "event_preparation_tasks"
  ADD CONSTRAINT "event_preparation_tasks_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "event_preparation_tasks"
  ADD CONSTRAINT "event_preparation_tasks_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "event_preparation_tasks_taskId_idx"
  ON "event_preparation_tasks"("taskId");

ALTER TABLE "notes" ADD COLUMN "eventId" TEXT;

ALTER TABLE "notes"
  ADD CONSTRAINT "notes_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "notes_userId_eventId_idx" ON "notes"("userId", "eventId");

ALTER TABLE "events" DROP COLUMN "taskId";
