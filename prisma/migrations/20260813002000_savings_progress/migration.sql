ALTER TABLE "budgets" ADD COLUMN "savedMinor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_saved_non_negative" CHECK ("savedMinor" >= 0);
