import { NotBuiltYet } from "@/components/NotBuiltYet";

export const metadata = { title: "LifeOS — Money" };

export default function MoneyPage() {
  return (
    <NotBuiltYet
      title="Money"
      what="Transactions, budgets and spending analytics"
      schemaReady="the expenses, expense_categories and budgets tables — spending already shows on Today, and ⌘K can log an expense"
    />
  );
}
