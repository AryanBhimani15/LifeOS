-- LifeOS is currently tailored for Indian college students. INR is the sole
-- money surface, including existing account preferences.
ALTER TABLE "user_settings" ALTER COLUMN "currency" SET DEFAULT 'INR';
ALTER TABLE "expenses" ALTER COLUMN "currency" SET DEFAULT 'INR';
ALTER TABLE "budgets" ALTER COLUMN "currency" SET DEFAULT 'INR';
UPDATE "user_settings" SET "currency" = 'INR' WHERE "currency" <> 'INR';
