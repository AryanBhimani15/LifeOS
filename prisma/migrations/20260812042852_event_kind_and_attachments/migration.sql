-- CreateEnum
CREATE TYPE "EventKind" AS ENUM ('EVENT', 'EXAM', 'CLASS', 'MEETING', 'DEADLINE');

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "eventId" TEXT;

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "kind" "EventKind" NOT NULL DEFAULT 'EVENT';

-- CreateIndex
CREATE INDEX "documents_eventId_idx" ON "documents"("eventId");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
