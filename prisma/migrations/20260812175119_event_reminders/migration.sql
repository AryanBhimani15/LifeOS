-- AlterTable
ALTER TABLE "reminders" ADD COLUMN     "eventId" TEXT,
ALTER COLUMN "taskId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "reminders_eventId_idx" ON "reminders"("eventId");

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exclusive arc.
--
-- Dropping NOT NULL from "taskId" above is what makes an event reminder
-- possible; it is also what would allow a reminder attached to nothing at all.
-- Prisma cannot express "exactly one of these", so the database enforces it —
-- the same approach the other arcs in this schema take.
ALTER TABLE "reminders"
  ADD CONSTRAINT "reminders_exactly_one_target"
  CHECK (("taskId" IS NOT NULL)::int + ("eventId" IS NOT NULL)::int = 1);
