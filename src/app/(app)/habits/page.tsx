import { NotBuiltYet } from "@/components/NotBuiltYet";

export const metadata = { title: "LifeOS — Habits" };

export default function HabitsPage() {
  return (
    <NotBuiltYet
      title="Habits"
      what="Habit management, history and streak analytics"
      schemaReady="the habits and habit_completions tables — habit ticking already works on Today"
    />
  );
}
