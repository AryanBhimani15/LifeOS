CREATE TABLE "recurring_expenses" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT,
    "description" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "intervalDays" INTEGER NOT NULL DEFAULT 1,
    "startsOn" DATE NOT NULL,
    "lastLoggedOn" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "recurring_expenses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "recurring_expenses_userId_active_idx" ON "recurring_expenses"("userId", "active");
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "expense_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_amount_non_negative" CHECK ("amountMinor" >= 0);
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_interval_valid" CHECK ("intervalDays" > 0);
