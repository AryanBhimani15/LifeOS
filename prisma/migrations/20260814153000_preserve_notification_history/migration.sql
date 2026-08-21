-- A delivered notification is history, not a child row that should disappear
-- when someone later deletes its source reminder/task/event. The deep link and
-- copied message remain useful even after the source no longer exists.
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_reminderId_fkey";
ALTER TABLE "notifications" ALTER COLUMN "reminderId" DROP NOT NULL;
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_reminderId_fkey"
  FOREIGN KEY ("reminderId") REFERENCES "reminders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
