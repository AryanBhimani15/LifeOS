ALTER TABLE "documents" ADD COLUMN "taskId" TEXT;

ALTER TABLE "documents"
  ADD CONSTRAINT "documents_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "documents_taskId_idx" ON "documents"("taskId");
