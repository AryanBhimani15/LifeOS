CREATE TABLE "event_tags" (
  "eventId" TEXT NOT NULL,
  "tagId" TEXT NOT NULL,
  CONSTRAINT "event_tags_pkey" PRIMARY KEY ("eventId", "tagId")
);

CREATE INDEX "event_tags_tagId_idx" ON "event_tags"("tagId");

ALTER TABLE "event_tags"
  ADD CONSTRAINT "event_tags_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "event_tags"
  ADD CONSTRAINT "event_tags_tagId_fkey"
  FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
