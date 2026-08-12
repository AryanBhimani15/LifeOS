import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { todayInZone } from "@/lib/dates";
import { MoneyWorkspace } from "@/components/money/MoneyWorkspace";

export const metadata = { title: "LifeOS — Money" };

export default async function MoneyPage() {
  const userId = await requireUserId();
  const settings = await db.userSettings.findUnique({ where: { userId }, select: { currency: true, timezone: true } });
  const zone = settings?.timezone ?? "UTC";
  const currency = "INR";
  const month = todayInZone(zone).slice(0, 7);
  const monthStart = new Date(`${month}-01T00:00:00.000Z`);
  const nextMonth = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));

  const [categories, expenses, budgets, recurring] = await Promise.all([
    db.expenseCategory.findMany({ where: { userId }, select: { id: true, name: true, color: true }, orderBy: { name: "asc" } }),
    db.expense.findMany({
      where: { userId, spentOn: { gte: monthStart, lt: nextMonth } },
      select: { id: true, description: true, amountMinor: true, kind: true, spentOn: true, categoryId: true, category: { select: { name: true, color: true } } },
      orderBy: [{ spentOn: "desc" }, { createdAt: "desc" }],
      take: 80,
    }),
    db.budget.findMany({
      where: { userId, periodStart: { lte: nextMonth }, periodEnd: { gte: monthStart } },
      select: { id: true, name: true, limitMinor: true, savedMinor: true, categoryId: true, category: { select: { name: true, color: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.recurringExpense.findMany({ where: { userId, active: true }, select: { id: true, description: true, amountMinor: true, intervalDays: true, category: { select: { name: true, color: true } } }, orderBy: { createdAt: "desc" } }),
  ]);

  return <MoneyWorkspace currency={currency} categories={categories} expenses={expenses.map((entry) => ({ ...entry, spentOn: entry.spentOn.toISOString() }))} budgets={budgets} recurring={recurring} />;
}
